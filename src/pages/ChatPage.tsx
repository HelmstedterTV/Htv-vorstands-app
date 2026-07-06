import { useEffect, useState } from 'react'
import { collection, doc, onSnapshot, setDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../context/AuthContext'
import ChannelSidebar from '../components/Chat/ChannelSidebar'
import MessageList from '../components/Chat/MessageList'
import MessageInput from '../components/Chat/MessageInput'
import { useChatContext } from '../context/ChatContext'
import { Hash, ChevronLeft, MessageCircle, Users } from 'lucide-react'
import type { AppUser } from '../types'

interface DmSelection {
  convId: string
  otherUserId: string
  otherUserName: string
}

export default function ChatPage() {
  const { currentUser } = useAuth()
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null)
  const [selectedDm, setSelectedDm] = useState<DmSelection | null>(null)
  const [showMembers, setShowMembers] = useState(false)
  const [users, setUsers] = useState<AppUser[]>([])
  const { channels } = useChatContext()

  const selectedChannelObj = channels.find(c => c.id === selectedChannel)
  const channelName = selectedChannelObj?.name ?? ''
  const hasSelection = selectedChannel !== null || selectedDm !== null

  // Nutzer laden, um Mitglieder-UIDs eines Projekt-Channels in Namen aufzulösen (nur Anzeige)
  useEffect(() => {
    if (!currentUser) return
    return onSnapshot(collection(db, 'users'), snap => {
      setUsers(snap.docs.map(d => ({ uid: d.id, ...d.data() } as AppUser)))
    })
  }, [currentUser])

  useEffect(() => { setShowMembers(false) }, [selectedChannel])

  async function handleSelectDm(convId: string, otherUserId: string, otherUserName: string) {
    if (!currentUser) return
    // DM-Conversation-Dokument anlegen falls noch nicht vorhanden
    await setDoc(
      doc(db, 'directMessages', convId),
      { participants: [currentUser.uid, otherUserId].sort() },
      { merge: true }
    )
    setSelectedChannel(null)
    setSelectedDm({ convId, otherUserId, otherUserName })
  }

  function handleSelectChannel(id: string | null) {
    setSelectedDm(null)
    setSelectedChannel(id)
  }

  function handleBack() {
    setSelectedChannel(null)
    setSelectedDm(null)
  }

  return (
    <div className="flex h-full">
      {/* Sidebar: auf Mobile nur sichtbar wenn nichts gewählt (Fullscreen) */}
      <div className={`flex-shrink-0 h-full ${
        hasSelection
          ? 'hidden md:block md:w-52'
          : 'block w-full md:w-52'
      }`}>
        <ChannelSidebar
          selectedChannelId={selectedChannel}
          selectedDmConvId={selectedDm?.convId ?? null}
          onSelectChannel={handleSelectChannel}
          onSelectDm={handleSelectDm}
          fullWidth={!hasSelection}
        />
      </div>

      {/* Chat-Bereich: auf Mobile nur sichtbar wenn etwas gewählt (Fullscreen) */}
      <div className={`flex-col min-w-0 bg-white ${
        hasSelection ? 'flex flex-1' : 'hidden md:flex md:flex-1'
      }`}>
        {selectedChannel ? (
          <>
            <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2 relative">
              <button
                className="md:hidden p-1 -ml-2 text-slate-500 hover:text-slate-700 active:text-slate-900"
                onClick={handleBack}
                aria-label="Zurück zur Channel-Liste"
              >
                <ChevronLeft size={22} />
              </button>
              <Hash size={18} className="text-slate-400 flex-shrink-0" />
              <span className="font-medium text-slate-800 text-sm truncate">{channelName}</span>

              {selectedChannelObj?.type === 'projekt' && (
                <div className="ml-auto relative">
                  <button
                    onClick={() => setShowMembers(v => !v)}
                    className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 px-2 py-1 rounded hover:bg-slate-100"
                  >
                    <Users size={14} />
                    {selectedChannelObj.members?.length ?? 0}
                  </button>
                  {showMembers && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setShowMembers(false)} />
                      <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-slate-200 rounded-lg shadow-lg py-2 min-w-[180px] max-h-64 overflow-y-auto">
                        <div className="px-3 pb-1 text-slate-400 text-xs font-semibold uppercase tracking-wider">
                          Teilnehmer
                        </div>
                        {(selectedChannelObj.members ?? []).map(uid => {
                          const u = users.find(x => x.uid === uid)
                          return (
                            <div key={uid} className="px-3 py-1 text-sm text-slate-700 flex items-center gap-1.5">
                              <span className="truncate">{u?.displayName ?? 'Unbekannt'}</span>
                              {u?.role === 'gast' && <span className="text-slate-400 text-[10px] flex-shrink-0">Gast</span>}
                            </div>
                          )
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
            <MessageList channelId={selectedChannel} isDm={false} />
            <MessageInput channelId={selectedChannel} isDm={false} channelName={channelName} />
          </>
        ) : selectedDm ? (
          <>
            <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2">
              <button
                className="md:hidden p-1 -ml-2 text-slate-500 hover:text-slate-700 active:text-slate-900"
                onClick={handleBack}
                aria-label="Zurück"
              >
                <ChevronLeft size={22} />
              </button>
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0"
                style={{ backgroundColor: 'var(--htv-blue)' }}
              >
                {selectedDm.otherUserName.charAt(0).toUpperCase()}
              </div>
              <span className="font-medium text-slate-800 text-sm truncate">{selectedDm.otherUserName}</span>
              <span className="text-xs text-slate-400 ml-1 flex items-center gap-1">
                <MessageCircle size={12} />
                Privat
              </span>
            </div>
            <MessageList channelId={selectedDm.convId} isDm={true} />
            <MessageInput channelId={selectedDm.convId} isDm={true} channelName={`DM: ${selectedDm.otherUserName}`} />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-400">
            <div className="text-center">
              <div className="text-4xl mb-3">💬</div>
              <div className="text-sm">Wähle einen Channel oder starte eine Direktnachricht</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
