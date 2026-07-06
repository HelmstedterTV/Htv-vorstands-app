/* Service Worker – Firebase Cloud Messaging (Hintergrund) + Icon-Badge
 *
 * FCM liefert Push-Nachrichten verschlüsselt aus; die Compat-SDK übernimmt
 * Entschlüsselung und ruft onBackgroundMessage auf. Wir zeigen dort die
 * Benachrichtigung und setzen das Homescreen-Badge (iOS/iPadOS 16.4+).
 */

importScripts('https://www.gstatic.com/firebasejs/12.15.0/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/12.15.0/firebase-messaging-compat.js')

firebase.initializeApp({
  apiKey: 'AIzaSyDbXzuiyhLSvbchvbE95jIVX0XGxWk3hhE',
  authDomain: 'htv-vorstands-app.firebaseapp.com',
  projectId: 'htv-vorstands-app',
  messagingSenderId: '291659147396',
  appId: '1:291659147396:web:3b9607bb2dc6b6bdbb7ad1',
})

const messaging = firebase.messaging()

const ICON = self.location.origin + '/Htv-vorstands-app/icon-192.png'
const APP_URL = 'https://helmstedtertv.github.io/Htv-vorstands-app/'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))

// ── FCM-Hintergrundnachrichten (App geschlossen oder im Hintergrund) ─────────
// Wir senden vom Worker reine data-Nachrichten, damit wir Titel/Body/Badge
// selbst steuern können.
messaging.onBackgroundMessage(() => {
  // Die ANZEIGE der Benachrichtigung übernimmt der FCM-Service-Worker bereits
  // automatisch aus dem webpush.notification-Block (siehe Worker). Würden wir
  // hier zusätzlich showNotification aufrufen, erschienen ZWEI Banner.
  // Das Icon-Badge setzen wir bewusst NICHT hier, sondern im push-Listener
  // unten – dort können wir per event.waitUntil den Worker am Leben halten,
  // bis setAppBadge fertig ist (sonst wird er oft vorher beendet → kein Badge).
})

// ── Eingehender Push: Banner (nur iOS) + Icon-Badge (alle), via waitUntil ─────
self.addEventListener('push', event => {
  let payload = {}
  try { payload = event.data ? event.data.json() : {} } catch { /* unlesbar */ }

  // iOS-Roh-Web-Push: { title, body, count } an oberster Ebene.
  // FCM (Android/Mac): { notification, data, ... } – Banner zeigt Firebase.
  const isRawWebPush =
    payload && typeof payload.title === 'string' && !payload.notification && !payload.data
  const count = Number(isRawWebPush ? payload.count : (payload && payload.data && payload.data.count)) || 1

  event.waitUntil((async () => {
    // Diagnose-Beacon: bestätigt im Live-Log, dass der SW beim Push aufwacht.
    try {
      await fetch('https://htv-push-worker.vorstand-htv.workers.dev/ping', {
        method: 'POST',
        mode: 'no-cors',
        body: 'sw-push raw=' + isRawWebPush + ' ' + (self.navigator.userAgent || ''),
      })
    } catch { /* egal */ }

    // iOS: Banner selbst anzeigen (für Roh-Web-Push gibt es kein FCM-Auto-Banner).
    if (isRawWebPush) {
      await self.registration.showNotification(payload.title || 'HTV Vorstands-App', {
        body: payload.body || 'Neue Nachricht',
        icon: ICON,
        badge: ICON,
        tag: 'new-message',
        renotify: true,
      })
    }

    if (self.navigator.setAppBadge) {
      await self.navigator.setAppBadge(count).catch(() => {})
    }
  })())
})

// ── Nachrichten vom App-Hauptthread (Badge setzen/löschen) ───────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SET_BADGE') {
    const count = event.data.count ?? 0
    if (count > 0) {
      self.navigator.setAppBadge?.(count)
    } else {
      self.navigator.clearAppBadge?.()
    }
  }
})

// ── Klick auf Benachrichtigung → App in den Vordergrund, Badge löschen ───────
self.addEventListener('notificationclick', event => {
  event.notification.close()
  self.navigator.clearAppBadge?.().catch(() => {})
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes('Htv-vorstands-app') && 'focus' in client) {
          return client.focus()
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(APP_URL)
      }
    })
  )
})
