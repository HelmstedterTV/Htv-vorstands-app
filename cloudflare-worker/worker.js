/**
 * HTV Vorstands-App – Cloudflare Worker als FCM-Sender
 *
 * Speichert FCM-Registrierungs-Tokens und verschickt Benachrichtigungen über
 * die Firebase Cloud Messaging HTTP v1 API. Die gesamte Verschlüsselung
 * übernimmt FCM – hier wird nichts mehr selbst verschlüsselt.
 *
 * Umgebungsvariablen (in Cloudflare als Secrets setzen):
 *   FIREBASE_PROJECT_ID    – z.B. "htv-vorstands-app"
 *   FIREBASE_CLIENT_EMAIL  – client_email aus der Service-Account-JSON
 *   FIREBASE_PRIVATE_KEY   – private_key aus der Service-Account-JSON
 *                            (inkl. "-----BEGIN PRIVATE KEY-----", \n erlaubt)
 *   NOTIFY_SECRET          – beliebiges Passwort (schützt /notify und /unsubscribe)
 *   VAPID_PUBLIC           – eigener VAPID-Public-Key (base64url) für iOS-Web-Push
 *   VAPID_PRIVATE          – eigener VAPID-Private-Key (base64url, d-Wert)
 *                            -> per ./setup-vapid.sh erzeugen und setzen
 *
 * Zwei Sende-Wege (sendPush wählt automatisch):
 *   - Android/Desktop: FCM-Token              -> FCM HTTP v1 API (sendFcm)
 *   - iOS/iPadOS:      Web-Push-Abo (JSON)     -> direktes VAPID-Web-Push (sendWebPush)
 *
 * KV Namespace:
 *   PUSH_SUBS              – speichert Token/Abo (key = sub_<uid>)
 */

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging'

// ─── Base64url-Helfer ────────────────────────────────────────────────────────

function toB64url(buf) {
  let bin = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function b64urlFromString(s) {
  return toB64url(new TextEncoder().encode(s))
}

function b64urlToBytes(s) {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/')
  while (s.length % 4) s += '='
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function concatBytes(...arrs) {
  let total = 0
  for (const a of arrs) total += a.length
  const out = new Uint8Array(total)
  let off = 0
  for (const a of arrs) { out.set(a, off); off += a.length }
  return out
}

// ─── Service-Account-Private-Key (PEM PKCS8) importieren ─────────────────────

function pemToArrayBuffer(pem) {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\\n/g, '')
    .replace(/\s+/g, '')
  const bin = atob(body)
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
  return buf.buffer
}

// ─── Google OAuth2 Access-Token via Service-Account-JWT (RS256) ──────────────

let cachedToken = null // { token, exp }

async function getAccessToken(env) {
  const now = Math.floor(Date.now() / 1000)
  if (cachedToken && cachedToken.exp - 60 > now) return cachedToken.token

  const header  = b64urlFromString(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = b64urlFromString(JSON.stringify({
    iss:   env.FIREBASE_CLIENT_EMAIL,
    scope: FCM_SCOPE,
    aud:   GOOGLE_TOKEN_URL,
    iat:   now,
    exp:   now + 3600,
  }))
  const sigInput = `${header}.${payload}`

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(env.FIREBASE_PRIVATE_KEY),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(sigInput)
  )
  const jwt = `${sigInput}.${toB64url(sig)}`

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })
  if (!res.ok) {
    throw new Error(`OAuth-Token fehlgeschlagen: ${res.status} ${await res.text()}`)
  }
  const json = await res.json()
  cachedToken = { token: json.access_token, exp: now + (json.expires_in || 3600) }
  return cachedToken.token
}

// ─── Eine FCM-Nachricht senden ───────────────────────────────────────────────

async function sendFcm(token, title, body, count, accessToken, env) {
  const url = `https://fcm.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/messages:send`

  const ICON = 'https://helmstedtertv.github.io/Htv-vorstands-app/icon-192.png'
  const APP_URL = 'https://helmstedtertv.github.io/Htv-vorstands-app/'

  const message = {
    message: {
      token,
      // data: steuert Titel/Body/Count im Service Worker (push-Listener),
      //       u.a. für das Icon-Badge via setAppBadge.
      data: {
        title: String(title),
        body:  String(body),
        count: String(count || 1),
      },
      // webpush.notification: Firebase zeigt daraus automatisch den Banner an
      // (Android/Samsung + macOS). Das Icon-Badge setzt unser push-Listener im
      // Service Worker separat (mit waitUntil). Zusammen: ein Banner + Badge.
      webpush: {
        headers: { Urgency: 'high', TTL: '86400' },
        notification: {
          title: String(title),
          body:  String(body),
          icon:  ICON,
          badge: ICON,
          tag:   'new-message',
        },
        fcm_options: { link: APP_URL },
      },
    },
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(message),
  })
  let error = null
  if (res.status !== 200) {
    try { error = await res.text() } catch { /* ignore */ }
  }
  return { status: res.status, error }
}

// ─── Web-Push (RFC 8291 / aes128gcm + VAPID) – für iOS-Abos ──────────────────
// iOS erhält Push NICHT zuverlässig über FCM, sondern als direktes VAPID-Web-
// Push an den Apple-Endpunkt. Solche Abos sind als JSON gespeichert:
//   { "endpoint": "...", "keys": { "p256dh": "...", "auth": "..." } }
// Erfordert die Secrets VAPID_PUBLIC und VAPID_PRIVATE (eigenes Schlüsselpaar,
// NICHT der Firebase-VAPID-Key).

async function hkdf(salt, ikm, info, len) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8)
  return new Uint8Array(bits)
}

// VAPID-Signierschlüssel (ECDSA P-256) aus VAPID_PUBLIC (x,y) + VAPID_PRIVATE (d)
async function importVapidSigningKey(env) {
  const pub = b64urlToBytes(env.VAPID_PUBLIC)        // 0x04 | x(32) | y(32)
  const jwk = {
    kty: 'EC', crv: 'P-256',
    x: toB64url(pub.slice(1, 33)),
    y: toB64url(pub.slice(33, 65)),
    d: env.VAPID_PRIVATE,
    ext: true,
  }
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
}

async function vapidAuthHeader(endpoint, env) {
  const aud = new URL(endpoint).origin
  const now = Math.floor(Date.now() / 1000)
  const header  = b64urlFromString(JSON.stringify({ alg: 'ES256', typ: 'JWT' }))
  const payload = b64urlFromString(JSON.stringify({
    aud, exp: now + 12 * 3600, sub: 'mailto:p.schinnerling@gmail.com',
  }))
  const signingInput = `${header}.${payload}`
  const key = await importVapidSigningKey(env)
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(signingInput))
  const jwt = `${signingInput}.${toB64url(sig)}`
  return `vapid t=${jwt}, k=${env.VAPID_PUBLIC}`
}

async function encryptWebPush(plaintext, p256dhB64, authB64) {
  const uaPublicRaw = b64urlToBytes(p256dhB64)       // 65 Bytes, uncompressed
  const authSecret  = b64urlToBytes(authB64)         // 16 Bytes
  const asKeyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const asPublicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', asKeyPair.publicKey))
  const uaPublicKey = await crypto.subtle.importKey('raw', uaPublicRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const sharedBits = await crypto.subtle.deriveBits({ name: 'ECDH', public: uaPublicKey }, asKeyPair.privateKey, 256)
  const ecdhSecret = new Uint8Array(sharedBits)

  const keyInfo = concatBytes(new TextEncoder().encode('WebPush: info\0'), uaPublicRaw, asPublicRaw)
  const ikm   = await hkdf(authSecret, ecdhSecret, keyInfo, 32)
  const salt  = crypto.getRandomValues(new Uint8Array(16))
  const cek   = await hkdf(salt, ikm, new TextEncoder().encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, new TextEncoder().encode('Content-Encoding: nonce\0'), 12)

  const rec = concatBytes(new TextEncoder().encode(plaintext), new Uint8Array([0x02]))
  const cipherKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, cipherKey, rec))

  const rs = new Uint8Array([0, 0, 0x10, 0])         // record size 4096
  const header = concatBytes(salt, rs, new Uint8Array([65]), asPublicRaw)
  return concatBytes(header, ct)
}

async function sendWebPush(subscription, title, body, count, env) {
  if (!env.VAPID_PUBLIC || !env.VAPID_PRIVATE) {
    return { status: 0, error: 'VAPID-Schlüssel nicht konfiguriert (VAPID_PUBLIC/VAPID_PRIVATE)' }
  }
  const payload = JSON.stringify({
    title: String(title), body: String(body), count: String(count || 1),
  })
  const bodyBytes = await encryptWebPush(payload, subscription.keys.p256dh, subscription.keys.auth)
  const auth = await vapidAuthHeader(subscription.endpoint, env)
  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      'Authorization': auth,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'TTL': '86400',
      'Urgency': 'high',
    },
    body: bodyBytes,
  })
  let error = null
  if (res.status < 200 || res.status >= 300) {
    try { error = await res.text() } catch { /* ignore */ }
  }
  return { status: res.status, error }
}

// Router: gespeichertes Abo entscheidet über den Weg.
// JSON-Objekt ({"endpoint":...}) -> Web-Push (iOS); sonst FCM-Token (Android/Mac).
async function sendPush(token, title, body, count, accessToken, env) {
  const trimmed = (token || '').trim()
  if (trimmed.startsWith('{')) {
    let sub
    try { sub = JSON.parse(trimmed) } catch { return { status: 400, error: 'Abo nicht lesbar' } }
    if (!sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
      return { status: 400, error: 'Abo unvollständig' }
    }
    return sendWebPush(sub, title, body, count, env)
  }
  return sendFcm(token, title, body, count, accessToken, env)
}

// ─── Request-Handler ─────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    const corsHeaders = {
      'Access-Control-Allow-Origin': 'https://helmstedtertv.github.io',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }

    // ── POST /ping ───────────────────────────────────────────────────────────
    // Diagnose: der Service Worker meldet sich hier, wenn er beim Push aufwacht.
    // Im Live-Log (wrangler tail) sehen wir Gerät/Zeitpunkt.
    if (url.pathname === '/ping' && request.method === 'POST') {
      let txt = ''
      try { txt = await request.text() } catch { /* ignore */ }
      console.log('PING', new Date().toISOString(), txt)
      return new Response('ok', { headers: corsHeaders })
    }

    // ── POST /subscribe ──────────────────────────────────────────────────────
    // Body: { uid: string, token: string }
    if (url.pathname === '/subscribe' && request.method === 'POST') {
      let body
      try { body = await request.json() } catch { return new Response('Bad JSON', { status: 400, headers: corsHeaders }) }
      const { uid, token } = body
      if (!uid || !token) {
        return new Response('uid und token erforderlich', { status: 400, headers: corsHeaders })
      }
      await env.PUSH_SUBS.put(`sub_${uid}`, token)
      return new Response('OK', { status: 200, headers: corsHeaders })
    }

    // ── POST /unsubscribe ────────────────────────────────────────────────────
    // Body: { uid: string, secret: string }
    if (url.pathname === '/unsubscribe' && request.method === 'POST') {
      let body
      try { body = await request.json() } catch { return new Response('Bad JSON', { status: 400, headers: corsHeaders }) }
      if (body.secret !== env.NOTIFY_SECRET) {
        return new Response('Unauthorized', { status: 401, headers: corsHeaders })
      }
      await env.PUSH_SUBS.delete(`sub_${body.uid}`)
      return new Response('OK', { status: 200, headers: corsHeaders })
    }

    // ── GET /debug?secret=... ────────────────────────────────────────────────
    // Diagnose: zeigt, welche Tokens gespeichert sind (gekürzt, ohne Geheimnis
    // preiszugeben). Nur mit korrektem Secret.
    if (url.pathname === '/debug' && request.method === 'GET') {
      if (url.searchParams.get('secret') !== env.NOTIFY_SECRET) {
        return new Response('Unauthorized', { status: 401, headers: corsHeaders })
      }
      const list = await env.PUSH_SUBS.list({ prefix: 'sub_' })
      const subs = []
      for (const key of list.keys) {
        const token = await env.PUSH_SUBS.get(key.name)
        subs.push({
          uid: key.name.replace('sub_', ''),
          tokenLen: token ? token.length : 0,
          tokenPreview: token ? token.slice(0, 12) + '…' : null,
        })
      }
      const pk = env.FIREBASE_PRIVATE_KEY || ''
      const email = env.FIREBASE_CLIENT_EMAIL || ''
      const config = {
        projectId: env.FIREBASE_PROJECT_ID || '(fehlt)',
        clientEmail: email
          ? email.replace(/^(.{6}).*(@.*)$/, '$1…$2')
          : '(fehlt)',
        clientEmailValid: /@[^.]+\.iam\.gserviceaccount\.com$/.test(email),
        privateKeyPresent: pk.length > 0,
        privateKeyLen: pk.length,
        privateKeyHeaderOk: pk.includes('BEGIN PRIVATE KEY'),
      }
      return new Response(JSON.stringify({ count: subs.length, subs, config }, null, 2), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── POST /test ───────────────────────────────────────────────────────────
    // Body: { secret, uid? }
    // Diagnose: sendet eine Test-Push an EINEN uid (oder an alle), OHNE den
    // Absender auszuschließen, und gibt den echten FCM-Status + Fehlertext zurück.
    if (url.pathname === '/test' && request.method === 'POST') {
      let body
      try { body = await request.json() } catch { return new Response('Bad JSON', { status: 400, headers: corsHeaders }) }
      if (body.secret !== env.NOTIFY_SECRET) {
        return new Response('Unauthorized', { status: 401, headers: corsHeaders })
      }

      let accessToken
      try {
        accessToken = await getAccessToken(env)
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Token-Fehler: ' + e.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const keys = body.uid
        ? [{ name: `sub_${body.uid}` }]
        : (await env.PUSH_SUBS.list({ prefix: 'sub_' })).keys

      const results = []
      for (const key of keys) {
        const uid = key.name.replace('sub_', '')
        const token = await env.PUSH_SUBS.get(key.name)
        if (!token) { results.push({ uid, error: 'kein Token gespeichert' }); continue }
        try {
          const { status, error } = await sendPush(token, 'Test', 'Test-Benachrichtigung', 1, accessToken, env)
          results.push({ uid, status, ...(error ? { error } : {}) })
        } catch (e) {
          results.push({ uid, error: e.message })
        }
      }

      return new Response(JSON.stringify({ tested: results.length, results }, null, 2), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── POST /notify ─────────────────────────────────────────────────────────
    // Body: { senderUid, channelName, authorName, recipientUids, secret }
    // recipientUids: UIDs der tatsächlichen Empfänger (Channel-/Projekt-Mitglieder
    // bzw. DM-Partner). Es wird NUR an diese UIDs gesendet – nicht an alle
    // registrierten Geräte – damit z.B. Nicht-Mitglieder eines Projekt-Channels
    // ("Pickleball" etc.) keine Push-Benachrichtigung erhalten.
    if (url.pathname === '/notify' && request.method === 'POST') {
      let body
      try { body = await request.json() } catch { return new Response('Bad JSON', { status: 400, headers: corsHeaders }) }

      if (body.secret !== env.NOTIFY_SECRET) {
        return new Response('Unauthorized', { status: 401, headers: corsHeaders })
      }

      const { senderUid, channelName, authorName, recipientUids } = body
      const title = authorName ? `${authorName}` : 'Neue Nachricht'
      const notifBody = channelName ? `#${channelName}` : 'Neue Nachricht'

      if (!Array.isArray(recipientUids) || recipientUids.length === 0) {
        return new Response(JSON.stringify({ sent: 0, results: [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      let accessToken
      try {
        accessToken = await getAccessToken(env)
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const results = []
      const targetUids = new Set(recipientUids.filter(uid => uid !== senderUid))

      for (const uid of targetUids) {
        const token = await env.PUSH_SUBS.get(`sub_${uid}`)
        if (!token) continue

        try {
          const { status, error } = await sendPush(token, title, notifBody, 1, accessToken, env)
          results.push({ uid, status, ...(error ? { error } : {}) })
          // Ungültiges/abgemeldetes Token entfernen:
          // 404/410 = Abo abgelaufen/abgemeldet (FCM & Web-Push/Apple),
          // 403 = unauthorized, 400 mit Token-Hinweis = kaputtes FCM-Token.
          const invalidToken =
            status === 404 ||
            status === 410 ||
            status === 403 ||
            (status === 400 && /registration token/i.test(error || ''))
          if (invalidToken) {
            await env.PUSH_SUBS.delete(`sub_${uid}`)
          }
        } catch (e) {
          results.push({ uid, error: e.message })
        }
      }

      return new Response(JSON.stringify({ sent: results.length, results }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response('Not found', { status: 404, headers: corsHeaders })
  },
}
