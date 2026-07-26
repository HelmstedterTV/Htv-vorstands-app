/**
 * Browser-Benachrichtigungen via Notification API + Service Worker
 * Kein externer Dienst, kein API-Key erforderlich.
 */

/** Fragt den Nutzer nach Erlaubnis für Benachrichtigungen. Gibt true zurück wenn erlaubt. */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  const result = await Notification.requestPermission()
  return result === 'granted'
}

/** Gibt zurück ob Benachrichtigungen aktuell erlaubt sind. */
export function notificationsGranted(): boolean {
  return 'Notification' in window && Notification.permission === 'granted'
}

/**
 * Zeigt eine Browser-Benachrichtigung.
 *
 * Bewusst NICHT über navigator.serviceWorker.controller: Nach einem Hard-Reload
 * (Cmd+Shift+R) ist die Seite nicht vom Service Worker kontrolliert, controller
 * ist dann null und die Benachrichtigung fiele ersatzlos aus. `ready` liefert
 * dagegen immer die aktive Registrierung.
 */
export async function showNotification(title: string, body: string) {
  if (!notificationsGranted()) return

  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.ready
      await reg.showNotification(title, {
        body,
        icon: import.meta.env.BASE_URL + 'icon-192.png',
        badge: import.meta.env.BASE_URL + 'icon-192.png',
        tag: 'new-message',
      })
      return
    } catch {
      /* Fallback unten */
    }
  }

  // Fallback ohne Service Worker (z.B. Desktop-Browser ohne SW-Unterstützung)
  try {
    new Notification(title, { body, icon: import.meta.env.BASE_URL + 'icon-192.png' })
  } catch {
    /* nicht kritisch */
  }
}
