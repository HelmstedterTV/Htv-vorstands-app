import { useEffect, useRef, useState } from 'react'
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  limit,
  doc,
  updateDoc,
  arrayUnion,
  arrayRemove,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../../firebase/config'
import type { Message } from '../../types'
import { useAuth } from '../../context/AuthContext'
import { useChatContext } from '../../context/ChatContext'
import { ExternalLink, SmilePlus, Pencil, Check, X } from 'lucide-react'
import { format } from 'date-fns'
import { de } from 'date-fns/locale'
import PollMessage from './PollMessage'

const QUICK_EMOJIS = ['👍', '❤️', '😂', '🎉', '👏', '✅']

function getDriveIcon(url: string): string {
  try {
    const u = new URL(url)
    if (u.hostname.includes('docs.google.com')) {
      if (u.pathname.includes('/document/')) return '📝'
      if (u.pathname.includes('/spreadsheets/')) return '📊'
      if (u.pathname.includes('/presentation/')) return '📑'
    }
    if (u.hostname.includes('drive.google.com')) return '📁'
    if (u.hostname.includes('mail.google.com')) return '✉️'
    if (u.hostname.includes('dropbox.com')) return '📦'
  } catch { /* noop */ }
  return '🔗'
}

interface Props {
  channelId: string
  isDm?: boolean
}

export default function MessageList({ channelId, isDm = false }: Props) {
  const { currentUser } = useAuth()
  const { markAsRead } = useChatContext()
  const [messages, setMessages] = useState<Message[]>([])
  const [pickerOpen, setPickerOpen] = useState<string | null>(null) // message id
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const editInputRef = useRef<HTMLTextAreaElement>(null)
  const prevLengthRef = useRef(0)

  useEffect(() => {
    const basePath = isDm ? 'directMessages' : 'channels'
    const q = query(
      collection(db, basePath, channelId, 'messages'),
      orderBy('createdAt', 'asc'),
      limit(200)
    )
    return onSnapshot(q, (snap: import('firebase/firestore').QuerySnapshot) => {
      setMessages(
        snap.docs.map((d: import('firebase/firestore').QueryDocumentSnapshot) => ({
          id: d.id,
          ...d.data(),
          createdAt: (d.data().createdAt as import('firebase/firestore').Timestamp)?.toDate() ?? new Date(),
        } as Message))
      )
    })
  }, [channelId])

  useEffect(() => {
    if (messages.length > prevLengthRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
    prevLengthRef.current = messages.length
  }, [messages.length])

  useEffect(() => {
    if (!channelId || messages.length === 0) return
    const timer = setTimeout(() => markAsRead(channelId), 500)
    return () => clearTimeout(timer)
  }, [messages.length, channelId, markAsRead])

  function startEdit(msg: Message) {
    setEditingId(msg.id)
    setEditText(msg.text)
    setPickerOpen(null)
    setTimeout(() => editInputRef.current?.focus(), 50)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditText('')
  }

  async function saveEdit(msg: Message) {
    const trimmed = editText.trim()
    if (!trimmed || trimmed === msg.text) { cancelEdit(); return }
    const basePath = isDm ? 'directMessages' : 'channels'
    const msgRef = doc(db, basePath, channelId, 'messages', msg.id)
    await updateDoc(msgRef, { text: trimmed, editedAt: serverTimestamp() })
    cancelEdit()
  }

  async function toggleReaction(msg: Message, emoji: string) {
    if (!currentUser) return
    const uid = currentUser.uid
    const basePath = isDm ? 'directMessages' : 'channels'
    const msgRef = doc(db, basePath, channelId, 'messages', msg.id)
    const existing = msg.reactions?.[emoji] ?? []
    const hasReacted = existing.includes(uid)

    await updateDoc(msgRef, {
      [`reactions.${emoji}`]: hasReacted ? arrayRemove(uid) : arrayUnion(uid),
    })
    // Picker offen lassen → Nutzer kann mehrere Reaktionen setzen / entfernen
  }

  function formatTime(date: Date) {
    return format(date, 'HH:mm', { locale: de })
  }

  function formatDate(date: Date) {
    return format(date, 'EEEE, d. MMMM', { locale: de })
  }

  // @Erwähnungen farbig hervorheben
  function renderText(text: string, isOwn: boolean) {
    const parts = text.split(/(@\w+)/g)
    return parts.map((part, i) =>
      /^@\w+$/.test(part)
        ? <span key={i} className={`font-semibold ${isOwn ? 'text-white/90' : 'text-blue-600'}`}>{part}</span>
        : part
    )
  }

  let lastDate = ''

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1" onClick={() => setPickerOpen(null)}>
      {messages.map(msg => {
        const isOwn = msg.authorId === currentUser?.uid
        const dateStr = formatDate(msg.createdAt)
        const showDate = dateStr !== lastDate
        lastDate = dateStr
        const reactionEntries = Object.entries(msg.reactions ?? {}).filter(([, uids]) => uids.length > 0)

        return (
          <div key={msg.id}>
            {showDate && (
              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 h-px bg-slate-200" />
                <span className="text-xs text-slate-400 font-medium">{dateStr}</span>
                <div className="flex-1 h-px bg-slate-200" />
              </div>
            )}

            {/* Poll-Nachrichten gesondert rendern */}
            {msg.type === 'poll' && (
              <div className="my-2">
                <PollMessage msg={msg} channelId={channelId} isDm={isDm} />
              </div>
            )}

            {msg.type !== 'poll' && (
            <div className={`group flex gap-2 items-end ${editingId === msg.id ? 'flex-row' : isOwn ? 'flex-row-reverse' : 'flex-row'}`}>
              {/* Avatar */}
              {(!isOwn || editingId === msg.id) && (
                <div
                  className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-white text-xs font-semibold ${editingId === msg.id && isOwn ? 'invisible' : ''}`}
                  style={{ backgroundColor: 'var(--htv-blue)' }}
                >
                  {msg.authorName?.charAt(0).toUpperCase()}
                </div>
              )}

              <div className={`${editingId === msg.id ? 'flex-1' : 'max-w-xs lg:max-w-md'} ${isOwn && editingId !== msg.id ? 'items-end' : 'items-start'} flex flex-col gap-0.5`}>
                {!isOwn && (
                  <span className="text-xs text-slate-500 px-1">{msg.authorName}</span>
                )}

                {/* Drive / Link Karte */}
                {msg.fileUrl && (
                  <a
                    href={msg.fileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={`rounded-xl px-3 py-2.5 text-sm flex items-center gap-2.5 max-w-xs transition-opacity hover:opacity-80 ${
                      isOwn
                        ? 'text-white border border-white/20'
                        : 'bg-white border border-slate-200 text-slate-800'
                    }`}
                    style={isOwn ? { backgroundColor: 'var(--htv-blue-dark)' } : {}}
                  >
                    <span className="text-base flex-shrink-0">{getDriveIcon(msg.fileUrl)}</span>
                    <div className="min-w-0">
                      <div className="font-medium truncate text-xs">{msg.fileName}</div>
                      <div className={`text-xs truncate mt-0.5 ${isOwn ? 'text-white/60' : 'text-slate-400'}`}>
                        {msg.fileUrl.length > 40 ? msg.fileUrl.slice(0, 40) + '…' : msg.fileUrl}
                      </div>
                    </div>
                    <ExternalLink size={13} className={`flex-shrink-0 ${isOwn ? 'text-white/60' : 'text-slate-400'}`} />
                  </a>
                )}

                {/* Text bubble + Aktions-Buttons */}
                {msg.text && (
                  editingId === msg.id ? (
                    /* ── Bearbeitungsmodus ── */
                    <div className="flex items-start gap-1 w-full max-w-lg">
                      <textarea
                        ref={editInputRef}
                        value={editText}
                        onChange={e => setEditText(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(msg) }
                          if (e.key === 'Escape') cancelEdit()
                        }}
                        rows={3}
                        className="flex-1 rounded-xl px-3 py-2 text-sm border-2 focus:outline-none resize-none"
                        style={{ borderColor: 'var(--htv-blue)' }}
                      />
                      <button
                        onClick={() => saveEdit(msg)}
                        className="p-1.5 rounded-full text-white flex-shrink-0"
                        style={{ backgroundColor: 'var(--htv-blue)' }}
                        title="Speichern"
                      >
                        <Check size={14} />
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="p-1.5 rounded-full bg-slate-200 text-slate-600 flex-shrink-0"
                        title="Abbrechen"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <div className={`flex items-end gap-1 ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}>
                      <div
                        className={`rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                          isOwn
                            ? 'text-white rounded-br-sm'
                            : 'bg-white border border-slate-200 text-slate-800 rounded-bl-sm'
                        }`}
                        style={isOwn ? { backgroundColor: 'var(--htv-blue)' } : {}}
                      >
                        {renderText(msg.text, isOwn)}
                      </div>

                      {/* Aktions-Buttons: Bearbeiten (nur eigene) + Reaktion */}
                      <div className={`flex items-center gap-0.5 ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}>
                        {isOwn && (
                          <button
                            onClick={e => { e.stopPropagation(); startEdit(msg) }}
                            className="transition-opacity p-1 rounded-full hover:bg-slate-200 active:bg-slate-200 text-slate-400
                              opacity-0 group-hover:opacity-100
                              [@media(hover:none)]:opacity-60"
                            title="Nachricht bearbeiten"
                          >
                            <Pencil size={14} />
                          </button>
                        )}

                        <div className="relative">
                          <button
                            onClick={e => { e.stopPropagation(); setPickerOpen(pickerOpen === msg.id ? null : msg.id) }}
                            className="transition-opacity p-1 rounded-full hover:bg-slate-200 active:bg-slate-200 text-slate-400
                              opacity-0 group-hover:opacity-100
                              [@media(hover:none)]:opacity-60"
                            title="Reaktion hinzufügen"
                          >
                            <SmilePlus size={16} />
                          </button>

                          {/* Emoji-Picker */}
                          {pickerOpen === msg.id && (
                            <div
                              className={`absolute bottom-8 z-10 bg-white border border-slate-200 rounded-xl shadow-lg px-2 py-1.5 flex gap-1 ${isOwn ? 'right-0' : 'left-0'}`}
                              onClick={e => e.stopPropagation()}
                            >
                              {QUICK_EMOJIS.map(emoji => (
                                <button
                                  key={emoji}
                                  onClick={() => toggleReaction(msg, emoji)}
                                  className={`text-lg hover:scale-125 transition-transform rounded px-0.5 ${
                                    msg.reactions?.[emoji]?.includes(currentUser?.uid ?? '') ? 'bg-blue-100' : ''
                                  }`}
                                >
                                  {emoji}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                )}

                {/* Reaktionen anzeigen */}
                {reactionEntries.length > 0 && (
                  <div className={`flex flex-wrap gap-1 px-1 ${isOwn ? 'justify-end' : 'justify-start'}`}>
                    {reactionEntries.map(([emoji, uids]) => (
                      <button
                        key={emoji}
                        onClick={() => toggleReaction(msg, emoji)}
                        className={`flex items-center gap-1 text-xs rounded-full px-2 py-0.5 border transition-colors ${
                          uids.includes(currentUser?.uid ?? '')
                            ? 'bg-blue-100 border-blue-300 text-blue-700'
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        <span>{emoji}</span>
                        <span>{uids.length}</span>
                      </button>
                    ))}
                  </div>
                )}

                <span className="text-xs text-slate-400 px-1">
                  {formatTime(msg.createdAt)}
                  {msg.editedAt && <span className="ml-1 italic">(bearbeitet)</span>}
                </span>
              </div>
            </div>
            )}
          </div>
        )
      })}
      <div ref={bottomRef} />
    </div>
  )
}
// TEST Sat Jun 27 18:24:56 UTC 2026
