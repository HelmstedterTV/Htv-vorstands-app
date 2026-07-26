/**
 * Push-Benachrichtigungen über Firebase Cloud Messaging (FCM).
 *
 * FCM übernimmt die komplette Web-Push-Verschlüsselung (RFC 8291) – wir holen
 * nur ein Registrierungs-Token und schicken es an unseren Cloudflare-Worker,
 * der es speichert und später über die FCM-API benachrichtigt.
 *
 * In .env.local (nicht committen!):
 *   VITE_FCM_VAPID_KEY=<Web-Push-Zertifikat aus der Firebase Console>
 *   VITE_WORKER_URL=https://htv-push-worker.<subdomain>.workers.dev
 *   VITE_NOTIFY_SECRET=<geheimes Passwort, identisch zum Worker-Secret>
 *
 * Den VITE_FCM_VAPID_KEY findest du in der Firebase Console unter
 * Projekteinstellungen → Cloud Messaging → "Web Push certificates" → Schlüsselpaar.
 */

import { getToken, deleteToken, onMessage } from 'firebase/messaging'
import { getMessagingIfSupported } from '../firebase/config'

const FCM_VAPID_KEY = import.meta.env.VITE_FCM_VAPID_KEY as string
const WORKER_URL    = import.meta.env.VITE_WORKER_URL as string
const NOTIFY_SECRET = import.meta.env.VITE_NOTIFY_SECRET as string
// Eigener VAPID-Public-Key für den direkten Web-Push-Weg auf iOS
const VAPID_PUBLIC  = import.meta.env.VITE_VAPID_PUBLIC as string

/** Gibt true zurück, wenn Push grundsätzlich unterstützt wird. */
export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

/**
 * iOS/iPadOS-Erkennung. iPadOS meldet sich oft als "MacIntel" – daher die
 * Touch-Heuristik. Auf iOS erreicht FCM den Push nicht zuverlässig; dort nutzen
 * wir direkten VAPID-Web-Push an den Apple-Endpunkt.
 */
function isApplePush(): boolean {
  const nav = navigator as Navigator & { maxTouchPoints: number }
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && nav.maxTouchPoints > 1)
  )
}

/** base64url (VAPID-Public) -> Uint8Array für applicationServerKey. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

/** Holt die Service-Worker-Registrierung der App (mit korrektem Scope). */
async function getRegistration(): Promise<ServiceWorkerRegistration | undefined> {
  if (!('serviceWorker' in navigator)) return undefined
  return navigator.serviceWorker.ready
}

/**
 * iOS: erstellt (oder verwendet) ein VAPID-Web-Push-Abo am Apple-Endpunkt und
 * gibt es als JSON-String zurück. Stimmt ein vorhandenes Abo nicht mehr mit
 * unserem aktuellen VAPID-Key überein, wird es erneuert.
 */
async function getApplePushToken(
  registration: ServiceWorkerRegistration | undefined,
): Promise<string | null> {
  if (!registration || !VAPID_PUBLIC) return null
  const desiredKey = urlBase64ToUint8Array(VAPID_PUBLIC)

  let sub = await registration.pushManager.getSubscription()
  if (sub) {
    const existing = new Uint8Array(sub.options.applicationServerKey ?? new ArrayBuffer(0))
    const sameKey =
      existing.length === desiredKey.length &&
      existing.every((b, i) => b === desiredKey[i])
    if (!sameKey) {
      await sub.unsubscribe().catch(() => {})
      sub = null
    }
  }
  if (!sub) {
    sub = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: desiredKey as unknown as BufferSource,
    })
  }
  return JSON.stringify(sub)
}

/**
 * Registriert das Gerät für Push beim Cloudflare-Worker.
 * - iOS/iPadOS: direktes VAPID-Web-Push-Abo (Apple-Endpunkt).
 * - Android/Desktop: FCM-Token.
 * Gibt true zurück, wenn erfolgreich.
 */
// Diagnose: meldet den Anmelde-Verlauf an /ping (im wrangler-tail sichtbar).
// TODO: nach iOS-Debugging wieder entfernen.
async function pingDiag(stage: string): Promise<void> {
  if (!WORKER_URL) return
  try {
    await fetch(`${WORKER_URL}/ping`, {
      method: 'POST',
      mode: 'no-cors',
      body: `subscribe[${stage}] apple=${isApplePush()} vapid=${VAPID_PUBLIC ? 'set' : 'MISSING'} ${navigator.userAgent}`,
    })
  } catch { /* egal */ }
}

export async function subscribeToPush(uid: string): Promise<boolean> {
  if (!pushSupported() || !WORKER_URL) return false
  await pingDiag('start')

  try {
    const registration = await getRegistration()
    let token: string | null = null

    if (isApplePush()) {
      // iOS: direktes Web-Push (FCM erreicht iOS nicht zuverlässig)
      token = await getApplePushToken(registration)
      await pingDiag('apple-token=' + (token ? 'ok' : 'null'))
    } else {
      // Android/Desktop: FCM
      if (!FCM_VAPID_KEY) return false
      const messaging = await getMessagingIfSupported()
      if (!messaging) return false
      token = await getToken(messaging, {
        vapidKey: FCM_VAPID_KEY,
        serviceWorkerRegistration: registration,
      })
    }

    if (!token) { await pingDiag('no-token'); return false }

    const res = await fetch(`${WORKER_URL}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid, token }),
    })

    await pingDiag('posted status=' + res.status)
    return res.ok
  } catch (err) {
    await pingDiag('error ' + (err instanceof Error ? err.name + ':' + err.message : String(err)))
    console.warn('Push-Subscription fehlgeschlagen:', err)
    return false
  }
}

/**
 * Hebt die Push-Registrierung auf (beim Ausloggen).
 */
export async function unsubscribeFromPush(uid: string): Promise<void> {
  if (!WORKER_URL) return

  try {
    const messaging = await getMessagingIfSupported()
    if (messaging) {
      await deleteToken(messaging).catch(() => {})
    }

    await fetch(`${WORKER_URL}/unsubscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid, secret: NOTIFY_SECRET }),
    })
  } catch (err) {
    console.warn('Unsubscribe fehlgeschlagen:', err)
  }
}

/**
 * Vordergrund-Nachrichten: zeigt eine Benachrichtigung, während die App offen
 * ist (FCM liefert diese nicht automatisch an den Service Worker).
 * Einmalig nach dem Login aufrufen.
 */
export async function listenForegroundMessages(): Promise<void> {
  const messaging = await getMessagingIfSupported()
  if (!messaging) return

  onMessage(messaging, payload => {
    const title = payload.data?.title || 'Neue Nachricht'
    const body  = payload.data?.body  || ''
    if (Notification.permission === 'granted') {
      new Notification(title, {
        body,
        icon: import.meta.env.BASE_URL + 'icon-192.png',
      })
    }
  })
}

/**
 * Benachrichtigt die tatsächlichen Empfänger (Channel-/Projekt-Mitglieder bzw.
 * DM-Partner) über eine neue Nachricht. Wird beim Senden einer Nachricht aufgerufen.
 *
 * WICHTIG: recipientUids muss die UIDs enthalten, die diese Nachricht sehen dürfen
 * (z.B. Mitglieder eines Projekt-Channels). Der Worker verschickt Push NUR an
 * diese UIDs – so bekommen z.B. bei einem "Pickleball"-Projekt-Channel nicht mehr
 * alle registrierten Geräte eine Benachrichtigung, sondern nur die Mitglieder.
 */
export async function notifyOthers(params: {
  senderUid: string
  authorName: string
  channelName?: string
  recipientUids: string[]
}): Promise<void> {
  if (!WORKER_URL || !NOTIFY_SECRET) return
  if (params.recipientUids.length === 0) return

  try {
    await fetch(`${WORKER_URL}/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        senderUid:     params.senderUid,
        authorName:    params.authorName,
        channelName:   params.channelName ?? '',
        recipientUids: params.recipientUids,
        secret:        NOTIFY_SECRET,
      }),
    })
  } catch (err) {
    // Nicht blockierend – Push-Fehler sollen Nachrichtensenden nicht verhindern
    console.warn('Push notify fehlgeschlagen:', err)
  }
}
