import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  onAuthStateChanged,
} from 'firebase/auth'
import type { User as FirebaseUser } from 'firebase/auth'
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { auth, db } from '../firebase/config'
import { subscribeToPush } from '../utils/webPush'
import type { AppUser } from '../types'

interface AuthContextType {
  currentUser: FirebaseUser | null
  userProfile: AppUser | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  resetPassword: (email: string) => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null)
  const [userProfile, setUserProfile] = useState<AppUser | null>(null)
  const [loading, setLoading] = useState(true)
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)

  async function updatePresence(uid: string, firstLogin = false) {
    const updates: Record<string, unknown> = { lastSeen: serverTimestamp() }
    if (firstLogin) updates.hasLoggedIn = true
    await updateDoc(doc(db, 'users', uid), updates)
  }

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user: FirebaseUser | null) => {
      setCurrentUser(user)
      if (user) {
        const snap = await getDoc(doc(db, 'users', user.uid))
        if (snap.exists()) {
          const data = snap.data()
          setUserProfile({ uid: user.uid, ...data } as AppUser)
          // lastSeen aktualisieren; beim ersten Login hasLoggedIn setzen
          const firstLogin = !data.hasLoggedIn
          await updatePresence(user.uid, firstLogin)
          // FCM-Token bei jedem Start auffrischen, wenn Benachrichtigungen
          // bereits erlaubt sind. Überschreibt veraltete/rotierte Tokens
          // automatisch (Self-Healing – behebt z.B. alte Roh-Web-Push-Einträge,
          // die FCM mit 400 ablehnt). Löst keine Berechtigungsabfrage aus, da
          // nur bei bereits erteilter Erlaubnis aufgerufen.
          if ('Notification' in window && Notification.permission === 'granted') {
            void subscribeToPush(user.uid)
          }
          // Heartbeat alle 2 Minuten
          heartbeatRef.current = setInterval(() => {
            updatePresence(user.uid)
          }, 2 * 60 * 1000)
        }
      } else {
        setUserProfile(null)
        if (heartbeatRef.current) {
          clearInterval(heartbeatRef.current)
          heartbeatRef.current = null
        }
      }
      setLoading(false)
    })
    return () => {
      unsub()
      if (heartbeatRef.current) clearInterval(heartbeatRef.current)
    }
  }, [])

  async function login(email: string, password: string) {
    await signInWithEmailAndPassword(auth, email, password)
  }

  async function logout() {
    await signOut(auth)
  }

  async function resetPassword(email: string) {
    await sendPasswordResetEmail(auth, email)
  }

  return (
    <AuthContext.Provider value={{ currentUser, userProfile, loading, login, logout, resetPassword }}>
      {!loading && children}
    </AuthContext.Provider>
  )
}
