import { useEffect, useState } from 'react'
import {
  collection, addDoc, serverTimestamp,
  updateDoc, deleteDoc, doc as firestoreDoc, onSnapshot,
} from 'firebase/firestore'
import { db } from '../../firebase/config'
import { useAuth } from '../../context/AuthContext'
import { useChatContext } from '../../context/ChatContext'
import type { Channel, ChannelType, AppUser } from '../../types'
import { Hash, Plus, X, MoreHorizontal, Pencil, Trash2, Check, MessageCircle, Users } from 'lucide-react'

interface Props {
  selectedChannelId: string | null
  selectedDmConvId: string | null
  onSelectChannel: (id: string | null) => void
  onSelectDm: (convId: string, otherUserId: string, otherUserName: string) => void
  /** Auf Mobile die volle Breite nutzen statt w-52 */
  fullWidth?: boolean
}

export default function ChannelSidebar({
  selectedChannelId,
  selectedDmConvId,
  onSelectChannel,
  onSelectDm,
  fullWidth,
}: Props) {
  const { currentUser, userProfile } = useAuth()
  const { channels, counts, markAsRead } = useChatContext()

  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<ChannelType>('vorstand')
  const [newMembers, setNewMembers] = useState<string[]>([])
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [manageMembersId, setManageMembersId] = useState<string | null>(null)
  const [manageMembers, setManageMembers] = useState<string[]>([])
  const [users, setUsers] = useState<AppUser[]>([])

  const isGast = userProfile?.role === 'gast'
  const isAdmin = userProfile?.role === 'admin'

  // Alle Nutzer laden (für DM-Bereich)
  useEffect(() => {
    if (isGast) return
    return onSnapshot(collection(db, 'users'), snap => {
      setUsers(snap.docs.map(d => ({ uid: d.id, ...d.data() } as AppUser)))
    })
  }, [isGast])

  // Menü bei Klick außerhalb schließen
  useEffect(() => {
    if (!openMenuId) return
    function close() { setOpenMenuId(null) }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [openMenuId])

  async function createChannel() {
    if (!newName.trim() || !currentUser) return
    // Ersteller ist immer Mitglied; bei Projekt-Channels zusätzlich die ausgewählten Teilnehmer
    const members = newType === 'projekt'
      ? Array.from(new Set([currentUser.uid, ...newMembers]))
      : [currentUser.uid]
    await addDoc(collection(db, 'channels'), {
      name: newName.trim(),
      type: newType,
      members,
      createdBy: currentUser.uid,
      createdAt: serverTimestamp(),
    })
    setNewName('')
    setNewMembers([])
    setShowNew(false)
  }

  function toggleNewMember(uid: string) {
    setNewMembers(prev => prev.includes(uid) ? prev.filter(id => id !== uid) : [...prev, uid])
  }

  function startManageMembers(ch: Channel) {
    setManageMembersId(ch.id)
    setManageMembers(ch.members ?? [])
    setOpenMenuId(null)
  }

  function toggleManageMember(uid: string) {
    setManageMembers(prev => prev.includes(uid) ? prev.filter(id => id !== uid) : [...prev, uid])
  }

  async function saveMembers() {
    if (!manageMembersId || !currentUser) return
    const members = Array.from(new Set([currentUser.uid, ...manageMembers]))
    await updateDoc(firestoreDoc(db, 'channels', manageMembersId), { members })
    setManageMembersId(null)
  }

  async function renameChannel(channelId: string) {
    if (!editName.trim()) { setEditingId(null); return }
    await updateDoc(firestoreDoc(db, 'channels', channelId), { name: editName.trim() })
    setEditingId(null)
    setEditName('')
  }

  async function deleteChannel(channelId: string) {
    if (!window.confirm('Channel wirklich löschen? Alle Nachrichten gehen verloren.')) return
    await deleteDoc(firestoreDoc(db, 'channels', channelId))
    if (selectedChannelId === channelId) onSelectChannel(null)
  }

  function startEdit(ch: Channel) {
    setEditingId(ch.id)
    setEditName(ch.name)
    setOpenMenuId(null)
  }

  function handleChannelSelect(channelId: string) {
    onSelectChannel(channelId)
    markAsRead(channelId)
  }

  function handleDmSelect(convId: string, otherUserId: string, otherUserName: string) {
    onSelectDm(convId, otherUserId, otherUserName)
    markAsRead(convId)
  }

  // channels kommt aus ChatContext bereits nach Rolle/Mitgliedschaft gefiltert (Projekt-Channels
  // nur wenn der Nutzer Mitglied ist) – hier zusätzlich Vorstand-Channels für Gäste ausblenden
  const visibleChannels = isGast
    ? channels.filter(c => c.type === 'vorstand_gaeste' || c.type === 'projekt')
    : channels

  const groups: Record<string, Channel[]> = {
    Vorstand: visibleChannels.filter(c => c.type === 'vorstand'),
    'Vorstand & Gäste': visibleChannels.filter(c => c.type === 'vorstand_gaeste'),
    Projekte: visibleChannels.filter(c => c.type === 'projekt'),
  }

  // Andere Nutzer für Direktnachrichten (nicht ich selbst, keine Gäste)
  const otherUsers = users.filter(
    u => u.uid !== currentUser?.uid && u.role !== 'gast'
  )

  // Andere Nutzer für Projekt-Mitgliederauswahl (nicht ich selbst, Gäste eingeschlossen)
  const assignableUsers = users.filter(u => u.uid !== currentUser?.uid)

  return (
    <div className={`${fullWidth ? 'w-full' : 'w-52'} flex-shrink-0 bg-slate-800 flex flex-col h-full`}>
      <div className="px-3 py-3 flex items-center justify-between border-b border-slate-700">
        <span className="text-white font-medium text-sm">Channels</span>
        {!isGast && (
          <button onClick={() => setShowNew(v => !v)} className="text-slate-400 hover:text-white transition-colors">
            {showNew ? <X size={16} /> : <Plus size={16} />}
          </button>
        )}
      </div>

      {showNew && (
        <div className="px-3 py-3 border-b border-slate-700 space-y-2">
          <input
            autoFocus
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Channel-Name"
            className="w-full bg-slate-700 text-white text-sm rounded px-2 py-1.5 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
            onKeyDown={e => e.key === 'Enter' && createChannel()}
          />
          <select
            value={newType}
            onChange={e => setNewType(e.target.value as ChannelType)}
            className="w-full bg-slate-700 text-white text-sm rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
          >
            <option value="vorstand">Vorstand</option>
            <option value="vorstand_gaeste">Vorstand & Gäste</option>
            <option value="projekt">Projekt</option>
          </select>

          {newType === 'projekt' && (
            <div>
              <div className="text-slate-400 text-xs mb-1">Teilnehmer auswählen</div>
              <div className="max-h-32 overflow-y-auto space-y-1 bg-slate-900/40 rounded p-1.5">
                {assignableUsers.map(u => (
                  <label key={u.uid} className="flex items-center gap-2 text-sm text-slate-200 px-1 py-0.5 rounded hover:bg-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newMembers.includes(u.uid)}
                      onChange={() => toggleNewMember(u.uid)}
                      className="accent-blue-400"
                    />
                    <span className="truncate">{u.displayName}</span>
                    {u.role === 'gast' && <span className="text-slate-500 text-[10px] flex-shrink-0">Gast</span>}
                  </label>
                ))}
                {assignableUsers.length === 0 && (
                  <div className="text-slate-500 text-xs px-1 py-0.5">Keine weiteren Nutzer</div>
                )}
              </div>
            </div>
          )}

          <button
            onClick={createChannel}
            className="w-full text-sm py-1.5 rounded text-white font-medium"
            style={{ backgroundColor: 'var(--htv-blue-light)' }}
          >
            Erstellen
          </button>
        </div>
      )}

      {manageMembersId && (
        <div className="px-3 py-3 border-b border-slate-700 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-white text-sm font-medium">Teilnehmer bearbeiten</span>
            <button onClick={() => setManageMembersId(null)} className="text-slate-400 hover:text-white">
              <X size={14} />
            </button>
          </div>
          <div className="max-h-32 overflow-y-auto space-y-1 bg-slate-900/40 rounded p-1.5">
            {assignableUsers.map(u => (
              <label key={u.uid} className="flex items-center gap-2 text-sm text-slate-200 px-1 py-0.5 rounded hover:bg-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={manageMembers.includes(u.uid)}
                  onChange={() => toggleManageMember(u.uid)}
                  className="accent-blue-400"
                />
                <span className="truncate">{u.displayName}</span>
                {u.role === 'gast' && <span className="text-slate-500 text-[10px] flex-shrink-0">Gast</span>}
              </label>
            ))}
          </div>
          <button
            onClick={saveMembers}
            className="w-full text-sm py-1.5 rounded text-white font-medium"
            style={{ backgroundColor: 'var(--htv-blue-light)' }}
          >
            Speichern
          </button>
        </div>
      )}

      <nav className="flex-1 overflow-y-auto py-2">
        {/* Channels */}
        {Object.entries(groups).map(([label, list]) => {
          if (list.length === 0) return null
          return (
            <div key={label} className="mb-3">
              <div className="px-3 py-1 text-slate-400 text-xs font-semibold uppercase tracking-wider">
                {label}
              </div>
              {list.map(ch => {
                const unread = counts[ch.id] ?? 0
                const isSelected = selectedChannelId === ch.id
                const isEditing = editingId === ch.id

                if (isEditing) {
                  return (
                    <div key={ch.id} className="flex items-center gap-1 px-2 py-1">
                      <input
                        autoFocus
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') renameChannel(ch.id)
                          if (e.key === 'Escape') setEditingId(null)
                        }}
                        className="flex-1 min-w-0 bg-slate-700 text-white text-sm rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                      <button onClick={() => renameChannel(ch.id)} className="text-green-400 hover:text-green-300 flex-shrink-0">
                        <Check size={14} />
                      </button>
                      <button onClick={() => setEditingId(null)} className="text-slate-400 hover:text-white flex-shrink-0">
                        <X size={14} />
                      </button>
                    </div>
                  )
                }

                return (
                  <div
                    key={ch.id}
                    className={`group relative flex items-center transition-colors ${
                      isSelected ? 'bg-slate-600' : 'hover:bg-slate-700'
                    }`}
                  >
                    <button
                      onClick={() => handleChannelSelect(ch.id)}
                      className={`flex-1 flex items-center gap-2 pl-3 py-1.5 pr-1 text-sm text-left min-w-0 ${
                        isSelected
                          ? 'text-white'
                          : unread > 0
                          ? 'text-white font-medium'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      <Hash size={14} className="flex-shrink-0" />
                      <span className="truncate">{ch.name}</span>
                    </button>

                    <div className="flex items-center gap-0.5 pr-1 flex-shrink-0">
                      {unread > 0 && !isSelected && (
                        <span className="bg-red-500 text-white text-xs font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                          {unread > 9 ? '9+' : unread}
                        </span>
                      )}
                      {isAdmin && (
                        <div className="relative">
                          <button
                            onClick={e => { e.stopPropagation(); setOpenMenuId(prev => prev === ch.id ? null : ch.id) }}
                            className="opacity-100 p-0.5 text-slate-400 hover:text-white rounded transition-opacity"
                          >
                            <MoreHorizontal size={14} />
                          </button>
                          {openMenuId === ch.id && (
                            <div
                              className="absolute right-0 top-full mt-0.5 z-50 bg-slate-700 border border-slate-600 rounded shadow-lg py-1 min-w-[140px]"
                              onClick={e => e.stopPropagation()}
                            >
                              <button
                                onClick={() => startEdit(ch)}
                                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-600"
                              >
                                <Pencil size={12} />
                                Umbenennen
                              </button>
                              {ch.type === 'projekt' && (
                                <button
                                  onClick={() => startManageMembers(ch)}
                                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-600"
                                >
                                  <Users size={12} />
                                  Teilnehmer bearbeiten
                                </button>
                              )}
                              <button
                                onClick={() => { setOpenMenuId(null); deleteChannel(ch.id) }}
                                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-slate-600"
                              >
                                <Trash2 size={12} />
                                Löschen
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })}

        {/* Direktnachrichten */}
        {!isGast && otherUsers.length > 0 && (
          <div className="mb-3">
            <div className="px-3 py-1 text-slate-400 text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5">
              <MessageCircle size={11} />
              Direktnachrichten
            </div>
            {otherUsers.map(user => {
              const convId = [currentUser!.uid, user.uid].sort().join('_')
              const unread = counts[convId] ?? 0
              const isSelected = selectedDmConvId === convId

              return (
                <div
                  key={user.uid}
                  className={`flex items-center transition-colors ${
                    isSelected ? 'bg-slate-600' : 'hover:bg-slate-700'
                  }`}
                >
                  <button
                    onClick={() => handleDmSelect(convId, user.uid, user.displayName)}
                    className={`flex-1 flex items-center gap-2 pl-3 py-1.5 pr-2 text-sm text-left min-w-0 ${
                      isSelected
                        ? 'text-white'
                        : unread > 0
                        ? 'text-white font-medium'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <div className="w-5 h-5 rounded-full bg-slate-500 flex items-center justify-center text-white text-xs flex-shrink-0 font-semibold">
                      {(user.displayName ?? '?').charAt(0).toUpperCase()}
                    </div>
                    <span className="truncate">{user.displayName}</span>
                  </button>
                  {unread > 0 && !isSelected && (
                    <span className="mr-2 bg-red-500 text-white text-xs font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                      {unread > 9 ? '9+' : unread}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </nav>
    </div>
  )
}
