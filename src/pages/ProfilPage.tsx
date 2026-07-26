import { useState, useEffect } from 'react'
import {
  updatePassword,
  updateEmail,
  reauthenticateWithCredential,
  EmailAuthProvider,
} from 'firebase/auth'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../context/AuthContext'
import { User, Mail, Lock, CheckCircle2, Bell } from 'lucide-react'
import { requestNotificationPermission, notificationsGranted } from '../utils/notifications'
import { subscribeToPush, pushSupported, listenForegroundMessages } from '../utils/webPush'

export default function ProfilPage() {
  const { currentUser, userProfile } = useAuth()

  // Name
  const [name, setName] = useState(userProfile?.displayName ?? '')
  const [nameSuccess, setNameSuccess] = useState(false)
  const [nameSaving, setNameSaving] = useState(false)

  // E-Mail
  const [newEmail, setNewEmail] = useState('')
  const [emailPassword, setEmailPassword] = useState('')
  const [emailSuccess, setEmailSuccess] = useState(false)
  const [emailError, setEmailError] = useState('')
  const [emailSaving, setEmailSaving] = useState(false)

  // Push-Benachrichtigungen
  const [pushGranted, setPushGranted] = useState(notificationsGranted)
  const [notifSaving, setNotifSaving] = useState(false)
  const [notifDenied, setNotifDenied] = useState(
    'Notification' in window && Notification.permission === 'denied'
  )
  const [pushInfo, setPushInfo] = useState('')

  // Vordergrund-Nachrichten anzeigen, solange die App offen ist
  useEffect(() => {
    if (pushGranted) void listenForegroundMessages()
  }, [pushGranted])

  async function togglePushNotifications() {
    setNotifSaving(true)
    try {
      // Erlaubnis kann per JS nicht widerrufen werden. Ist sie bereits erteilt,
      // dient der Knopf dazu, das Gerät ERNEUT anzumelden – nötig, wenn ein Abo
      // veraltet ist (Gerät bekommt sonst dauerhaft keine Benachrichtigungen).
      if (!pushGranted) {
        const granted = await requestNotificationPermission()
        setPushGranted(granted)
        if (!granted) {
          setNotifDenied(true)
          return
        }
      }
      if (pushSupported() && currentUser) {
        const ok = await subscribeToPush(currentUser.uid)
        setPushInfo(ok ? 'Gerät für Benachrichtigungen angemeldet.' : 'Anmeldung fehlgeschlagen.')
        await listenForegroundMessages()
      } else {
        setPushInfo('Push wird hier nicht unterstützt (auf iPhone/iPad: App über „Zum Home-Bildschirm" öffnen).')
      }
    } finally {
      setNotifSaving(false)
    }
  }

  // Passwort
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordSuccess, setPasswordSuccess] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [passwordSaving, setPasswordSaving] = useState(false)

  async function saveName() {
    if (!name.trim() || !currentUser) return
    setNameSaving(true)
    try {
      await updateDoc(doc(db, 'users', currentUser.uid), { displayName: name.trim() })
      setNameSuccess(true)
      setTimeout(() => setNameSuccess(false), 3000)
    } finally {
      setNameSaving(false)
    }
  }

  async function saveEmail() {
    if (!newEmail.trim() || !emailPassword || !currentUser) return
    setEmailSaving(true)
    setEmailError('')
    try {
      const cred = EmailAuthProvider.credential(currentUser.email!, emailPassword)
      await reauthenticateWithCredential(currentUser, cred)
      await updateEmail(currentUser, newEmail.trim())
      await updateDoc(doc(db, 'users', currentUser.uid), { email: newEmail.trim().toLowerCase() })
      setEmailSuccess(true)
      setNewEmail('')
      setEmailPassword('')
      setTimeout(() => setEmailSuccess(false), 4000)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : ''
      if (msg.includes('wrong-password') || msg.includes('invalid-credential')) {
        setEmailError('Aktuelles Passwort ist falsch.')
      } else if (msg.includes('email-already-in-use')) {
        setEmailError('Diese E-Mail-Adresse ist bereits vergeben.')
      } else {
        setEmailError('Fehler beim Ändern der E-Mail.')
      }
    } finally {
      setEmailSaving(false)
    }
  }

  async function savePassword() {
    if (!currentPassword || !newPassword || !confirmPassword || !currentUser) return
    setPasswordError('')
    if (newPassword !== confirmPassword) {
      setPasswordError('Neue Passwörter stimmen nicht überein.')
      return
    }
    if (newPassword.length < 8) {
      setPasswordError('Passwort muss mindestens 8 Zeichen haben.')
      return
    }
    setPasswordSaving(true)
    try {
      const cred = EmailAuthProvider.credential(currentUser.email!, currentPassword)
      await reauthenticateWithCredential(currentUser, cred)
      await updatePassword(currentUser, newPassword)
      setPasswordSuccess(true)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setTimeout(() => setPasswordSuccess(false), 4000)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : ''
      if (msg.includes('wrong-password') || msg.includes('invalid-credential')) {
        setPasswordError('Aktuelles Passwort ist falsch.')
      } else {
        setPasswordError('Fehler beim Ändern des Passworts.')
      }
    } finally {
      setPasswordSaving(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-lg mx-auto px-4 py-6 space-y-5">
        <h1 className="text-xl font-semibold text-slate-800">Mein Profil</h1>

        {/* Avatar + Übersicht */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 flex items-center gap-4">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center text-white font-bold text-xl flex-shrink-0"
            style={{ backgroundColor: 'var(--htv-blue)' }}
          >
            {userProfile?.displayName?.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="font-semibold text-slate-800">{userProfile?.displayName}</div>
            <div className="text-sm text-slate-400">{currentUser?.email}</div>
            <div className="text-xs mt-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 inline-block font-medium">
              {userProfile?.role === 'admin' ? 'Admin' : userProfile?.role === 'vorstand' ? 'Vorstand' : 'Gast'}
            </div>
          </div>
        </div>

        {/* Name ändern */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <div className="flex items-center gap-2 mb-4">
            <User size={16} className="text-slate-400" />
            <h2 className="font-medium text-slate-800">Anzeigename</h2>
          </div>
          <div className="flex gap-3">
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Dein Name"
              className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:border-transparent"
              onKeyDown={e => e.key === 'Enter' && saveName()}
            />
            <button
              onClick={saveName}
              disabled={nameSaving || name.trim() === userProfile?.displayName}
              className="px-4 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-40 flex items-center gap-2"
              style={{ backgroundColor: 'var(--htv-blue)' }}
            >
              {nameSuccess ? <><CheckCircle2 size={14} /> Gespeichert</> : nameSaving ? 'Speichern…' : 'Speichern'}
            </button>
          </div>
        </div>

        {/* E-Mail ändern */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <div className="flex items-center gap-2 mb-1">
            <Mail size={16} className="text-slate-400" />
            <h2 className="font-medium text-slate-800">E-Mail-Adresse ändern</h2>
          </div>
          <p className="text-xs text-slate-400 mb-4">Aktuell: {currentUser?.email}</p>
          <div className="space-y-3">
            <input
              type="email"
              value={newEmail}
              onChange={e => setNewEmail(e.target.value)}
              placeholder="Neue E-Mail-Adresse"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:border-transparent"
            />
            <input
              type="password"
              value={emailPassword}
              onChange={e => setEmailPassword(e.target.value)}
              placeholder="Aktuelles Passwort zur Bestätigung"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:border-transparent"
            />
            {emailError && <p className="text-red-600 text-sm bg-red-50 rounded-lg px-3 py-2">{emailError}</p>}
            {emailSuccess && (
              <p className="text-green-700 text-sm bg-green-50 rounded-lg px-3 py-2 flex items-center gap-2">
                <CheckCircle2 size={14} /> E-Mail-Adresse erfolgreich geändert.
              </p>
            )}
            <button
              onClick={saveEmail}
              disabled={emailSaving || !newEmail.trim() || !emailPassword}
              className="w-full py-2 rounded-lg text-white text-sm font-medium disabled:opacity-40"
              style={{ backgroundColor: 'var(--htv-blue)' }}
            >
              {emailSaving ? 'Wird gespeichert…' : 'E-Mail ändern'}
            </button>
          </div>
        </div>

        {/* Push-Benachrichtigungen */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <div className="flex items-center gap-2 mb-1">
            <Bell size={16} className="text-slate-400" />
            <h2 className="font-medium text-slate-800">Benachrichtigungen</h2>
          </div>
          <p className="text-xs text-slate-400 mb-4">
            Erhalte eine Benachrichtigung wenn jemand eine neue Nachricht schreibt, während du in einem anderen Tab bist.
          </p>
          {notifDenied ? (
            <p className="text-xs text-amber-600 bg-amber-50 rounded-xl px-3 py-2">
              Benachrichtigungen wurden im Browser blockiert. Bitte in den Browser-Einstellungen erlauben und die Seite neu laden.
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div className="text-sm text-slate-700 font-medium">
                  {pushGranted ? (
                    <span className="flex items-center gap-1.5 text-green-700">
                      <CheckCircle2 size={14} /> Benachrichtigungen aktiviert
                    </span>
                  ) : 'Benachrichtigungen aktivieren'}
                </div>
                {/* Auch bei erteilter Erlaubnis anbieten: erlaubt das erneute
                    Anmelden dieses Geräts, falls das Abo veraltet ist. */}
                <button
                  onClick={togglePushNotifications}
                  disabled={notifSaving}
                  className={`px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40 ${
                    pushGranted
                      ? 'border border-slate-200 text-slate-600'
                      : 'text-white'
                  }`}
                  style={pushGranted ? undefined : { backgroundColor: 'var(--htv-blue)' }}
                >
                  {notifSaving
                    ? 'Bitte warten…'
                    : pushGranted ? 'Gerät neu anmelden' : 'Erlauben'}
                </button>
              </div>
              {pushInfo && (
                <p className="text-xs text-slate-500 mt-2">{pushInfo}</p>
              )}
            </>
          )}
        </div>

        {/* Passwort ändern */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Lock size={16} className="text-slate-400" />
            <h2 className="font-medium text-slate-800">Passwort ändern</h2>
          </div>
          <div className="space-y-3">
            <input
              type="password"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              placeholder="Aktuelles Passwort"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:border-transparent"
            />
            <input
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="Neues Passwort (min. 8 Zeichen)"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:border-transparent"
            />
            <input
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              placeholder="Neues Passwort wiederholen"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:border-transparent"
              onKeyDown={e => e.key === 'Enter' && savePassword()}
            />
            {passwordError && <p className="text-red-600 text-sm bg-red-50 rounded-lg px-3 py-2">{passwordError}</p>}
            {passwordSuccess && (
              <p className="text-green-700 text-sm bg-green-50 rounded-lg px-3 py-2 flex items-center gap-2">
                <CheckCircle2 size={14} /> Passwort erfolgreich geändert.
              </p>
            )}
            <button
              onClick={savePassword}
              disabled={passwordSaving || !currentPassword || !newPassword || !confirmPassword}
              className="w-full py-2 rounded-lg text-white text-sm font-medium disabled:opacity-40"
              style={{ backgroundColor: 'var(--htv-blue)' }}
            >
              {passwordSaving ? 'Wird gespeichert…' : 'Passwort ändern'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
