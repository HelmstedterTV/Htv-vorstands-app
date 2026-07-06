import { useEffect, useState } from 'react'
import {
  collection,
  onSnapshot,
  doc,
  updateDoc,
  deleteDoc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore'
import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  initializeAuth,
} from 'firebase/auth'
import { initializeApp, deleteApp } from 'firebase/app'
import { db, auth } from '../firebase/config'
import { useAuth } from '../context/AuthContext'
import type { AppUser, UserRole } from '../types'
import { Trash2, Shield, User, UserPlus, X, Mail, RefreshCw, Lock } from 'lucide-react'

// Firestore gibt Timestamps zurück, keine JS-Dates → toDate() nötig
function toDate(val: unknown): Date | undefined {
  if (!val) return undefined
  if (val instanceof Date) return val
  if (typeof val === 'object' && val !== null && 'toDate' in val)
    return (val as { toDate: () => Date }).toDate()
  return new Date(val as string)
}

function formatLastSeen(lastSeen: unknown): string {
  const d = toDate(lastSeen)
  if (!d) return ''
  const diff = Date.now() - d.getTime()
  const min = Math.floor(diff / 60000)
  if (min < 5) return 'gerade online'
  if (min < 60) return `vor ${min} Min.`
  const h = Math.floor(min / 60)
  if (h < 24) return `vor ${h} Std.`
  const days = Math.floor(h / 24)
  return `vor ${days} Tag${days > 1 ? 'en' : ''}`
}

function isOnline(lastSeen: unknown): boolean {
  const d = toDate(lastSeen)
  if (!d) return false
  return Date.now() - d.getTime() < 5 * 60 * 1000
}

// Firebase-Config der Vertrags-App (separates Projekt)
const VERTRAEGE_CONFIG = {
  apiKey: "AIzaSyCBo69NFyloUpl3-1c5MdykBLfUF9BT8ho",
  authDomain: "htv-vertraege.firebaseapp.com",
  projectId: "htv-vertraege",
  storageBucket: "htv-vertraege.firebasestorage.app",
  messagingSenderId: "244031347624",
  appId: "1:244031347624:web:90e64aa53efbc37b271b9d",
}

const ACTION_CODE_SETTINGS = {
  url: 'https://helmstedtertv.github.io/Htv-vorstands-app/',
  handleCodeInApp: false,
}

const roleLabels: Record<UserRole, string> = {
  admin: 'Admin',
  vorstand: 'Vorstand',
  gast: 'Gast',
}

const roleColors: Record<UserRole, string> = {
  admin: 'bg-purple-100 text-purple-700',
  vorstand: 'bg-blue-100 text-blue-700',
  gast: 'bg-slate-100 text-slate-600',
}

export default function AdminPage() {
  const { userProfile } = useAuth()
  const [users, setUsers] = useState<AppUser[]>([])
  const [showInvite, setShowInvite] = useState(false)

  // Invite form
  const [inviteName, setInviteName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<UserRole>('vorstand')
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteSuccess, setInviteSuccess] = useState('')
  const [inviteError, setInviteError] = useState('')
  const [resendingUid, setResendingUid] = useState<string | null>(null)

  // Vertragsmanagement Passwort-Reset
  const [vertraegeResetEmail, setVertraegeResetEmail] = useState('vorstand.htv@gmail.com')
  const [vertraegeResetLoading, setVertraegeResetLoading] = useState(false)
  const [vertraegeResetMsg, setVertraegeResetMsg] = useState('')

  const isAdmin = userProfile?.role === 'admin'

  useEffect(() => {
    return onSnapshot(collection(db, 'users'), (snap: import('firebase/firestore').QuerySnapshot) => {
      setUsers(snap.docs.map((d: import('firebase/firestore').QueryDocumentSnapshot) => ({ uid: d.id, ...d.data() } as AppUser)))
    })
  }, [])

  async function inviteUser() {
    if (!inviteName.trim() || !inviteEmail.trim()) return
    setInviteLoading(true)
    setInviteError('')
    setInviteSuccess('')

    // Sekundäre Firebase-Instanz – damit der Admin nicht ausgeloggt wird
    const secondaryApp = initializeApp(
      {
        apiKey: "AIzaSyDbXzuiyhLSvbchvbE95jIVX0XGxWk3hhE",
        authDomain: "htv-vorstands-app.firebaseapp.com",
        projectId: "htv-vorstands-app",
      },
      'invite-instance-' + Date.now()
    )
    const secondaryAuth = initializeAuth(secondaryApp)

    try {
      // Temporäres Konto anlegen
      const tempPassword = Math.random().toString(36).slice(-12) + 'A1!'
      const cred = await createUserWithEmailAndPassword(secondaryAuth, inviteEmail.trim(), tempPassword)

      // Firestore-Profil anlegen
      await setDoc(doc(db, 'users', cred.user.uid), {
        displayName: inviteName.trim(),
        email: inviteEmail.trim().toLowerCase(),
        role: inviteRole,
        createdAt: serverTimestamp(),
        invitedAt: serverTimestamp(),
        hasLoggedIn: false,
      })

      // Passwort-Reset-Mail senden → Nutzer setzt sein eigenes Passwort
      await sendPasswordResetEmail(secondaryAuth, inviteEmail.trim(), ACTION_CODE_SETTINGS)

      setInviteSuccess(`Einladung an ${inviteEmail} gesendet! ${inviteName} erhält eine E-Mail zum Passwort setzen.`)
      setInviteName('')
      setInviteEmail('')
      setInviteRole('vorstand')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unbekannter Fehler'
      if (msg.includes('email-already-in-use')) {
        setInviteError('Diese E-Mail-Adresse ist bereits registriert.')
      } else {
        setInviteError('Fehler: ' + msg)
      }
    } finally {
      await deleteApp(secondaryApp)
      setInviteLoading(false)
    }
  }

  async function sendVertraegePasswordReset() {
    setVertraegeResetLoading(true)
    setVertraegeResetMsg('')
    const secondaryApp = initializeApp(VERTRAEGE_CONFIG, 'vertraege-reset-' + Date.now())
    const secondaryAuth = initializeAuth(secondaryApp)
    try {
      await sendPasswordResetEmail(secondaryAuth, vertraegeResetEmail.trim())
      setVertraegeResetMsg(`✓ Reset-E-Mail gesendet an ${vertraegeResetEmail}`)
    } catch (err: unknown) {
      setVertraegeResetMsg('Fehler: ' + (err instanceof Error ? err.message : 'Unbekannt'))
    } finally {
      await deleteApp(secondaryApp)
      setVertraegeResetLoading(false)
    }
  }

  async function resendInvite(uid: string, email: string) {
    setResendingUid(uid)
    try {
      await sendPasswordResetEmail(auth, email, ACTION_CODE_SETTINGS)
      alert(`Einladung erneut gesendet an ${email}`)
    } catch (err: unknown) {
      alert('Fehler: ' + (err instanceof Error ? err.message : 'Unbekannt'))
    } finally {
      setResendingUid(null)
    }
  }

  async function changeRole(uid: string, role: UserRole) {
    await updateDoc(doc(db, 'users', uid), { role })
  }

  async function removeUser(uid: string, name: string) {
    if (!confirm(`${name} wirklich entfernen? Der Firebase-Auth-Account bleibt bestehen – nur das Profil wird gelöscht.`)) return
    await deleteDoc(doc(db, 'users', uid))
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-4 py-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-semibold text-slate-800">Mitglieder</h1>
          {isAdmin ? (
            <button
              onClick={() => { setShowInvite(v => !v); setInviteSuccess(''); setInviteError('') }}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-white text-sm font-medium"
              style={{ backgroundColor: 'var(--htv-blue)' }}
            >
              {showInvite ? <X size={16} /> : <UserPlus size={16} />}
              {showInvite ? 'Abbrechen' : 'Mitglied einladen'}
            </button>
          ) : (
            <span className="flex items-center gap-1.5 text-xs text-slate-400">
              <Shield size={13} />
              Nur Ansicht
            </span>
          )}
        </div>

        {/* Einlade-Formular */}
        {isAdmin && showInvite && (
          <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-5 space-y-4">
            <h2 className="font-medium text-slate-800">Neues Mitglied einladen</h2>
            <p className="text-xs text-slate-500">
              Das Mitglied erhält eine E-Mail mit einem Link zum Passwort setzen und kann sich danach direkt einloggen.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Name *</label>
                <input
                  autoFocus
                  value={inviteName}
                  onChange={e => setInviteName(e.target.value)}
                  placeholder="Max Mustermann"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">E-Mail *</label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  placeholder="max@example.de"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:border-transparent"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Rolle</label>
              <select
                value={inviteRole}
                onChange={e => setInviteRole(e.target.value as UserRole)}
                className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1"
              >
                <option value="admin">Admin (voller Zugriff + Nutzerverwaltung)</option>
                <option value="vorstand">Vorstand (Chat, Todos, Kalender)</option>
                <option value="gast">Gast (nur freigegebene Channels)</option>
              </select>
            </div>

            {inviteSuccess && (
              <div className="flex items-start gap-2 bg-green-50 text-green-700 rounded-lg px-4 py-3 text-sm">
                <Mail size={16} className="mt-0.5 flex-shrink-0" />
                {inviteSuccess}
              </div>
            )}
            {inviteError && (
              <div className="bg-red-50 text-red-700 rounded-lg px-4 py-3 text-sm">{inviteError}</div>
            )}

            <div className="flex justify-end">
              <button
                onClick={inviteUser}
                disabled={inviteLoading || !inviteName.trim() || !inviteEmail.trim()}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-40"
                style={{ backgroundColor: 'var(--htv-blue)' }}
              >
                {inviteLoading ? 'Wird eingeladen…' : (
                  <><Mail size={14} /> Einladung senden</>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Nutzerliste */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
            <span className="text-xs text-slate-500">
              {isAdmin
                ? 'Rollen ändern: Dropdown rechts neben dem Nutzer. Admin-Rechte können nur Admins vergeben.'
                : 'Übersicht aller Mitglieder. Nur Admins können Rollen ändern oder Mitglieder verwalten.'}
            </span>
            <span className="text-xs text-slate-400 flex items-center gap-1">
              <User size={12} /> {users.length}
            </span>
          </div>

          {users.length === 0 && (
            <div className="px-4 py-8 text-center text-slate-400 text-sm">
              Noch keine Mitglieder
            </div>
          )}

          {users.map((user, i) => (
            <div
              key={user.uid}
              className={`flex items-center gap-3 px-4 py-3 ${
                i < users.length - 1 ? 'border-b border-slate-100' : ''
              }`}
            >
              {/* Avatar mit Online-Punkt */}
              <div className="relative flex-shrink-0">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-white font-semibold text-sm"
                  style={{ backgroundColor: 'var(--htv-blue)' }}
                >
                  {user.displayName?.charAt(0).toUpperCase()}
                </div>
                <span
                  className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-white ${
                    isOnline(user.lastSeen) ? 'bg-green-400' : 'bg-slate-300'
                  }`}
                />
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium text-slate-800 truncate">{user.displayName}</span>
                  {!user.hasLoggedIn && user.uid !== userProfile?.uid && (
                    <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-600 font-medium flex-shrink-0">
                      Noch nicht eingeloggt
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-400 truncate">
                  {user.email}
                  {user.lastSeen && (
                    <span className="ml-2 text-slate-300">· {formatLastSeen(user.lastSeen)}</span>
                  )}
                </div>
              </div>

              {/* Rolle Badge */}
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${roleColors[user.role]}`}>
                {roleLabels[user.role]}
              </span>

              {/* Rolle ändern – nur Admin */}
              {isAdmin && user.uid !== userProfile?.uid && (
                <select
                  value={user.role}
                  onChange={e => changeRole(user.uid, e.target.value as UserRole)}
                  className="text-xs border border-slate-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-1 flex-shrink-0"
                >
                  <option value="admin">Admin</option>
                  <option value="vorstand">Vorstand</option>
                  <option value="gast">Gast</option>
                </select>
              )}
              {user.uid === userProfile?.uid && (
                <span className="text-xs text-slate-300 flex-shrink-0">Du</span>
              )}

              {/* Einladung erneut senden + Entfernen – nur Admin */}
              {isAdmin && user.uid !== userProfile?.uid && (
                <>
                  <button
                    onClick={() => resendInvite(user.uid, user.email)}
                    disabled={resendingUid === user.uid}
                    className="text-slate-300 hover:text-blue-400 transition-colors flex-shrink-0 disabled:opacity-40"
                    title="Einladung erneut senden"
                  >
                    <RefreshCw size={15} className={resendingUid === user.uid ? 'animate-spin' : ''} />
                  </button>
                  <button
                    onClick={() => removeUser(user.uid, user.displayName)}
                    className="text-slate-300 hover:text-red-400 transition-colors flex-shrink-0"
                    title="Aus App entfernen"
                  >
                    <Trash2 size={16} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>

        {/* Vertragsmanagement-Zugang – nur Admin */}
        {isAdmin && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 mt-5">
          <div className="flex items-center gap-2 mb-3">
            <Lock size={16} className="text-slate-500" />
            <h2 className="font-medium text-slate-800 text-sm">Zugang Vertragsmanagement</h2>
          </div>
          <p className="text-xs text-slate-500 mb-4">
            Passwort-Reset-E-Mail für den Zugang zur Vertrags-App verschicken.
            Der Empfänger kann damit ein neues Passwort setzen.
          </p>
          <div className="flex gap-2">
            <input
              type="email"
              value={vertraegeResetEmail}
              onChange={e => setVertraegeResetEmail(e.target.value)}
              className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:border-transparent"
            />
            <button
              onClick={sendVertraegePasswordReset}
              disabled={vertraegeResetLoading}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-40 flex-shrink-0"
              style={{ backgroundColor: 'var(--htv-blue)' }}
            >
              <Mail size={14} />
              {vertraegeResetLoading ? 'Senden…' : 'Reset senden'}
            </button>
          </div>
          {vertraegeResetMsg && (
            <p className={`text-xs mt-2 ${vertraegeResetMsg.startsWith('✓') ? 'text-green-600' : 'text-red-600'}`}>
              {vertraegeResetMsg}
            </p>
          )}
        </div>
        )}

      </div>
    </div>
  )
}
