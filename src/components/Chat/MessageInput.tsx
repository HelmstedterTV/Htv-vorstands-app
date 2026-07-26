import { useState, useRef, useEffect } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { addDoc, collection, serverTimestamp, getDocs } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { useAuth } from '../../context/AuthContext'
import { useChatContext } from '../../context/ChatContext'
import type { AppUser } from '../../types'
import { Send, Link, X, ExternalLink, AtSign, BarChart2, Plus, Trash2 } from 'lucide-react'
import { notifyOthers } from '../../utils/webPush'

interface Props {
  channelId: string
  isDm?: boolean
  channelName?: string  // für E-Mail-Betreff
}

// Ermittelt Dateiname aus Google-Link
function getLinkLabel(url: string): string {
  try {
    const u = new URL(url)
    if (u.hostname.includes('drive.google.com')) return 'Google Drive Datei'
    if (u.hostname.includes('dropbox.com')) return 'Dropbox Datei'
    if (u.hostname.includes('mail.google.com')) return 'Google Mail'
    if (u.hostname.includes('docs.google.com')) {
      if (u.pathname.includes('/document/')) return 'Google Dokument'
      if (u.pathname.includes('/spreadsheets/')) return 'Google Tabelle'
      if (u.pathname.includes('/presentation/')) return 'Google Präsentation'
    }
    return u.hostname.replace('www.', '')
  } catch {
    return 'Datei-Link'
  }
}

export default function MessageInput({ channelId, isDm = false, channelName }: Props) {
  const { currentUser, userProfile } = useAuth()
  const { channels, dmConversations } = useChatContext()
  const [text, setText] = useState('')
  const [showLinkInput, setShowLinkInput] = useState(false)
  const [driveLink, setDriveLink] = useState('')
  const [sending, setSending] = useState(false)

  // Poll-Creator
  const [showPollCreator, setShowPollCreator] = useState(false)
  const [pollQuestion, setPollQuestion] = useState('')
  const [pollOptions, setPollOptions] = useState(['', ''])
  const [pollAnonymous, setPollAnonymous] = useState(false)
  const linkInputRef = useRef<HTMLInputElement>(null)
  const textInputRef = useRef<HTMLInputElement>(null)

  // @-Erwähnung
  const [users, setUsers] = useState<AppUser[]>([])
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionStartIdx, setMentionStartIdx] = useState(0)
  const [mentionHighlightIdx, setMentionHighlightIdx] = useState(0)

  // Nutzer einmalig laden
  useEffect(() => {
    getDocs(collection(db, 'users')).then(snap => {
      setUsers(snap.docs.map(d => ({ uid: d.id, ...d.data() } as AppUser)))
    })
  }, [])

  // Gefilterte Nutzer für Autocomplete
  const mentionUsers = mentionQuery !== null
    ? users
        .filter(u => (u.displayName ?? '').toLowerCase().includes(mentionQuery.toLowerCase()))
        .slice(0, 5)
    : []

  function handleTextChange(val: string) {
    setText(val)

    // Suche nach @word direkt vor dem Cursor
    const el = textInputRef.current
    const cursorPos = el?.selectionStart ?? val.length
    const textBefore = val.slice(0, cursorPos)
    const match = /@(\w*)$/.exec(textBefore)

    if (match) {
      setMentionQuery(match[1])
      setMentionStartIdx(cursorPos - match[0].length)
      setMentionHighlightIdx(0)
    } else {
      setMentionQuery(null)
    }
  }

  function selectMention(user: AppUser) {
    const firstName = (user.displayName ?? '').split(' ')[0]
    const before = text.slice(0, mentionStartIdx)
    const cursorPos = textInputRef.current?.selectionStart ?? text.length
    const after = text.slice(mentionStartIdx + 1 + (mentionQuery ?? '').length)
    const newText = `${before}@${firstName} ${after}`
    setText(newText)
    setMentionQuery(null)
    // Cursor hinter den Mention setzen
    const newCursor = before.length + firstName.length + 2 // @Name + Leerzeichen
    setTimeout(() => {
      textInputRef.current?.focus()
      textInputRef.current?.setSelectionRange(newCursor, newCursor)
    }, 0)
    void cursorPos // suppress lint
  }

  function handleTextKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    // @-Dropdown Navigation
    if (mentionQuery !== null && mentionUsers.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionHighlightIdx(i => Math.min(i + 1, mentionUsers.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionHighlightIdx(i => Math.max(i - 1, 0))
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        selectMention(mentionUsers[mentionHighlightIdx])
        return
      }
      if (e.key === 'Escape') {
        setMentionQuery(null)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(e as unknown as FormEvent)
    }
  }

  function openPollCreator() {
    setShowPollCreator(true)
    setShowLinkInput(false)
    setPollQuestion('')
    setPollOptions(['', ''])
    setPollAnonymous(false)
  }

  function closePollCreator() {
    setShowPollCreator(false)
  }

  function addPollOption() {
    if (pollOptions.length < 4) setPollOptions(o => [...o, ''])
  }

  function removePollOption(idx: number) {
    setPollOptions(o => o.filter((_, i) => i !== idx))
  }

  function updatePollOption(idx: number, val: string) {
    setPollOptions(o => o.map((v, i) => (i === idx ? val : v)))
  }

  async function sendPoll() {
    if (!currentUser) return
    const question = pollQuestion.trim()
    const validOptions = pollOptions.map(o => o.trim()).filter(Boolean)
    if (!question || validOptions.length < 2) return

    setSending(true)
    try {
      const basePath = isDm ? 'directMessages' : 'channels'
      await addDoc(collection(db, basePath, channelId, 'messages'), {
        type: 'poll',
        text: '',
        pollQuestion: question,
        pollOptions: validOptions,
        pollVotes: Object.fromEntries(validOptions.map((_, i) => [i, []])),
        pollAnonymous,
        authorId: currentUser.uid,
        authorName: userProfile?.displayName ?? currentUser.email,
        createdAt: serverTimestamp(),
      })
      closePollCreator()
      notifyOthers({
        senderUid: currentUser.uid,
        authorName: userProfile?.displayName ?? currentUser.email ?? 'Jemand',
        channelName: isDm ? undefined : channelName,
        recipientUids: getRecipientUids(),
      })
    } finally {
      setSending(false)
    }
  }

  // Ermittelt, welche Nutzer eine Push-Benachrichtigung erhalten sollen.
  // Wichtig: nur tatsächliche Mitglieder/Empfänger, nicht alle registrierten Geräte
  // (sonst bekommen z.B. bei "Pickleball"-Projekt-Channels auch Nicht-Mitglieder eine Push).
  function getRecipientUids(): string[] {
    if (!currentUser) return []

    if (isDm) {
      const dm = dmConversations.find(d => d.convId === channelId)
      return (dm?.participants ?? []).filter(uid => uid !== currentUser.uid)
    }

    const channel = channels.find(c => c.id === channelId)
    if (!channel) return []

    if (channel.type === 'projekt') {
      return (channel.members ?? []).filter(uid => uid !== currentUser.uid)
    }
    if (channel.type === 'vorstand') {
      return users.filter(u => u.uid !== currentUser.uid && u.role !== 'gast').map(u => u.uid)
    }
    // 'vorstand_gaeste' -> alle eingeloggten Nutzer, auch Gäste
    return users.filter(u => u.uid !== currentUser.uid).map(u => u.uid)
  }

  function toggleLinkInput() {
    setShowLinkInput(v => !v)
    setDriveLink('')
    setTimeout(() => linkInputRef.current?.focus(), 50)
  }

  async function send(e: FormEvent) {
    e.preventDefault()
    if (!currentUser || (!text.trim() && !driveLink.trim())) return

    setSending(true)
    try {
      const linkUrl = driveLink.trim()
      const trimmedText = text.trim()

      // Erwähnte Nutzer aus dem Text ermitteln
      const mentionedNames = Array.from(trimmedText.matchAll(/@(\w+)/g)).map(m => m[1].toLowerCase())
      const mentionUids = users
        .filter(u => mentionedNames.some(n => (u.displayName ?? '').toLowerCase().startsWith(n)))
        .map(u => u.uid)

      const basePath = isDm ? 'directMessages' : 'channels'
      await addDoc(collection(db, basePath, channelId, 'messages'), {
        text: trimmedText,
        authorId: currentUser.uid,
        authorName: userProfile?.displayName ?? currentUser.email,
        createdAt: serverTimestamp(),
        ...(linkUrl && {
          fileUrl: linkUrl,
          fileName: getLinkLabel(linkUrl),
          fileType: 'link',
        }),
        ...(mentionUids.length > 0 && { mentions: mentionUids }),
      })
      setText('')
      setDriveLink('')
      setShowLinkInput(false)
      setMentionQuery(null)

      // Push-Benachrichtigung nur an die tatsächlichen Empfänger senden
      // (Channel-/Projekt-Mitglieder bzw. DM-Partner, nicht an alle Geräte)
      notifyOthers({
        senderUid:  currentUser.uid,
        authorName: userProfile?.displayName ?? currentUser.email ?? 'Jemand',
        channelName: isDm ? undefined : channelName,
        recipientUids: getRecipientUids(),
      })

    } finally {
      setSending(false)
    }
  }

  return (
    <form onSubmit={send} className="relative px-4 py-3 bg-white border-t border-slate-200">

      {/* Poll-Creator Modal */}
      {showPollCreator && (
        <div className="absolute left-0 right-0 bottom-full mb-1 bg-white border border-slate-200 rounded-2xl shadow-xl z-30 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <BarChart2 size={15} className="text-slate-500" />
              <span className="text-sm font-semibold text-slate-700">Abstimmung erstellen</span>
            </div>
            <button type="button" onClick={closePollCreator} className="text-slate-400 hover:text-slate-600">
              <X size={16} />
            </button>
          </div>

          {/* Frage */}
          <input
            type="text"
            value={pollQuestion}
            onChange={e => setPollQuestion(e.target.value)}
            placeholder="Frage eingeben…"
            className="w-full rounded-xl px-3 py-2 text-sm border border-slate-200 focus:outline-none focus:ring-2 focus:border-transparent mb-3"
            style={{ '--tw-ring-color': 'var(--htv-blue)' } as React.CSSProperties}
            autoFocus
          />

          {/* Optionen */}
          <div className="flex flex-col gap-2 mb-3">
            {pollOptions.map((opt, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs text-slate-400 w-4 flex-shrink-0">{i + 1}.</span>
                <input
                  type="text"
                  value={opt}
                  onChange={e => updatePollOption(i, e.target.value)}
                  placeholder={`Option ${i + 1}`}
                  className="flex-1 rounded-xl px-3 py-1.5 text-sm border border-slate-200 focus:outline-none focus:ring-2"
                  style={{ '--tw-ring-color': 'var(--htv-blue)' } as React.CSSProperties}
                />
                {pollOptions.length > 2 && (
                  <button
                    type="button"
                    onClick={() => removePollOption(i)}
                    className="text-slate-300 hover:text-red-400 transition-colors flex-shrink-0"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Option hinzufügen */}
          {pollOptions.length < 4 && (
            <button
              type="button"
              onClick={addPollOption}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 transition-colors mb-3"
            >
              <Plus size={13} />
              Option hinzufügen (max. 4)
            </button>
          )}

          {/* Anonym */}
          <label className="flex items-center gap-2 text-xs text-slate-500 cursor-pointer mb-4 select-none">
            <input
              type="checkbox"
              checked={pollAnonymous}
              onChange={e => setPollAnonymous(e.target.checked)}
              className="rounded"
            />
            Anonym (nur Gesamtzahl sichtbar)
          </label>

          {/* Absenden */}
          <button
            type="button"
            onClick={sendPoll}
            disabled={sending || !pollQuestion.trim() || pollOptions.filter(o => o.trim()).length < 2}
            className="w-full py-2 rounded-xl text-sm font-semibold text-white transition-opacity disabled:opacity-30"
            style={{ backgroundColor: 'var(--htv-blue)' }}
          >
            Abstimmung starten
          </button>
        </div>
      )}

      {/* @-Mention Autocomplete Dropdown */}
      {mentionQuery !== null && mentionUsers.length > 0 && (
        <div className="absolute left-4 right-4 bottom-full mb-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden z-20">
          <div className="px-3 py-1.5 text-xs text-slate-400 border-b border-slate-100 flex items-center gap-1.5">
            <AtSign size={11} />
            Personen erwähnen
          </div>
          {mentionUsers.map((user, idx) => (
            <button
              key={user.uid}
              type="button"
              onMouseDown={e => { e.preventDefault(); selectMention(user) }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors ${
                idx === mentionHighlightIdx ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50'
              }`}
            >
              <div
                className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-white text-xs font-semibold"
                style={{ backgroundColor: 'var(--htv-blue)' }}
              >
                {(user.displayName ?? '?').charAt(0).toUpperCase()}
              </div>
              <span className="font-medium">{user.displayName}</span>
              <span className="text-slate-400 text-xs">{user.role}</span>
            </button>
          ))}
        </div>
      )}

      {/* Drive-Link Eingabe */}
      {showLinkInput && (
        <div className="mb-2 flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2">
          <ExternalLink size={14} className="text-blue-400 flex-shrink-0" />
          <input
            ref={linkInputRef}
            type="url"
            value={driveLink}
            onChange={e => setDriveLink(e.target.value)}
            placeholder="Google Drive / Mail / Docs Link einfügen…"
            className="flex-1 bg-transparent text-sm text-slate-700 placeholder-slate-400 focus:outline-none"
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                send(e as unknown as FormEvent)
              }
              if (e.key === 'Escape') { setShowLinkInput(false); setDriveLink('') }
            }}
          />
          <button
            type="button"
            onClick={() => { setShowLinkInput(false); setDriveLink('') }}
            className="text-slate-400 hover:text-slate-600"
          >
            <X size={14} />
          </button>
        </div>
      )}

      <div className="flex items-center gap-2">
        {/* Drive-Link Button */}
        <button
          type="button"
          onClick={toggleLinkInput}
          title="Link einfügen (Google Drive, Mail, Docs…)"
          className={`flex-shrink-0 transition-colors ${
            showLinkInput ? 'text-blue-500' : 'text-slate-400 hover:text-slate-600'
          }`}
        >
          <Link size={20} />
        </button>

        {/* Poll Button */}
        <button
          type="button"
          onClick={openPollCreator}
          title="Abstimmung erstellen"
          className={`flex-shrink-0 transition-colors ${
            showPollCreator ? 'text-blue-500' : 'text-slate-400 hover:text-slate-600'
          }`}
        >
          <BarChart2 size={20} />
        </button>

        {/* Nachrichtenfeld */}
        <input
          ref={textInputRef}
          type="text"
          value={text}
          onChange={e => handleTextChange(e.target.value)}
          placeholder={showLinkInput ? 'Kommentar zur Datei (optional)…' : 'Nachricht schreiben… (@Name für Erwähnung)'}
          className="flex-1 bg-slate-100 rounded-xl px-4 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:bg-white transition-colors"
          onKeyDown={handleTextKeyDown}
          disabled={sending}
        />

        {/* Senden */}
        <button
          type="submit"
          disabled={sending || (!text.trim() && !driveLink.trim())}
          className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-white transition-opacity disabled:opacity-30"
          style={{ backgroundColor: 'var(--htv-blue)' }}
        >
          <Send size={16} />
        </button>
      </div>

      {/* Hinweistext */}
      {showLinkInput && !driveLink && (
        <p className="text-xs text-slate-400 mt-1.5 pl-1">
          Link aus{' '}
          <a href="https://drive.google.com" target="_blank" rel="noreferrer" className="underline">Google Drive</a>
          ,{' '}
          <a href="https://mail.google.com" target="_blank" rel="noreferrer" className="underline">Gmail</a>
          {' '}oder Docs kopieren → hier einfügen
        </p>
      )}
    </form>
  )
}
