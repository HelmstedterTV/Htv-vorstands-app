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

/** Zeigt eine Browser-Benachrichtigung via Service Worker. */
export function showNotification(title: string, body: string) {
  if (!notificationsGranted()) return
  if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) return
  navigator.serviceWorker.controller.postMessage({
    type: 'SHOW_NOTIFICATION',
    title,
    body,
  })
}
