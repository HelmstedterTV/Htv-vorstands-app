import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getMessaging, isSupported, type Messaging } from 'firebase/messaging'

export const firebaseConfig = {
  apiKey: "AIzaSyDbXzuiyhLSvbchvbE95jIVX0XGxWk3hhE",
  authDomain: "htv-vorstands-app.firebaseapp.com",
  projectId: "htv-vorstands-app",
  messagingSenderId: "291659147396",
  appId: "1:291659147396:web:3b9607bb2dc6b6bdbb7ad1",
}

const app = initializeApp(firebaseConfig)

export const auth = getAuth(app)
export const db = getFirestore(app)

/**
 * Firebase Cloud Messaging – nur wenn der Browser es unterstützt.
 * Gibt die Messaging-Instanz zurück oder null (z.B. nicht installierte PWA,
 * fehlende Service-Worker-Unterstützung, iOS < 16.4).
 */
export async function getMessagingIfSupported(): Promise<Messaging | null> {
  try {
    if (!(await isSupported())) return null
    return getMessaging(app)
  } catch {
    return null
  }
}

export default app
