import { useEffect, useState } from 'react'
import { doc, updateDoc, arrayUnion, arrayRemove, getDocs, collection } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { useAuth } from '../../context/AuthContext'
import type { Message, AppUser } from '../../types'
import { BarChart2, Lock } from 'lucide-react'
import { format } from 'date-fns'
import { de } from 'date-fns/locale'

interface Props {
  msg: Message
  channelId: string
  isDm?: boolean
}

export default function PollMessage({ msg, channelId, isDm = false }: Props) {
  const { currentUser } = useAuth()
  const [users, setUsers] = useState<AppUser[]>([])

  useEffect(() => {
    getDocs(collection(db, 'users')).then(snap => {
      setUsers(snap.docs.map(d => ({ uid: d.id, ...d.data() } as AppUser)))
    })
  }, [])

  const options = msg.pollOptions ?? []
  const votes = msg.pollVotes ?? {}
  const totalVotes = options.reduce((sum, _, i) => sum + (votes[i] ?? []).length, 0)
  const uid = currentUser?.uid ?? ''
  const myVoteIdx = options.findIndex((_, i) => (votes[i] ?? []).includes(uid))
  const hasVoted = myVoteIdx !== -1

  function voterNames(optionIdx: number): string {
    const uids = votes[optionIdx] ?? []
    return uids
      .map(u => users.find(x => x.uid === u)?.displayName?.split(' ')[0] ?? '?')
      .join(', ')
  }

  async function handleVote(optionIdx: number) {
    if (!currentUser) return
    const basePath = isDm ? 'directMessages' : 'channels'
    const msgRef = doc(db, basePath, channelId, 'messages', msg.id)

    if (myVoteIdx === optionIdx) {
      await updateDoc(msgRef, {
        [`pollVotes.${optionIdx}`]: arrayRemove(uid),
      })
    } else {
      const updates: Record<string, unknown> = {
        [`pollVotes.${optionIdx}`]: arrayUnion(uid),
      }
      if (myVoteIdx !== -1) {
        updates[`pollVotes.${myVoteIdx}`] = arrayRemove(uid)
      }
      await updateDoc(msgRef, updates)
    }
  }

  function formatTime(date: Date) {
    return format(date, 'HH:mm', { locale: de })
  }

  return (
    <div className="flex gap-2 items-end">
      {/* Avatar */}
      <div
        className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-white text-xs font-semibold"
        style={{ backgroundColor: 'var(--htv-blue)' }}
      >
        {msg.authorName?.charAt(0).toUpperCase()}
      </div>

      <div className="flex flex-col gap-0.5 max-w-xs lg:max-w-md w-full">
        <span className="text-xs text-slate-500 px-1">{msg.authorName}</span>

        {/* Poll-Karte */}
        <div className="bg-white border border-slate-200 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
          {/* Header */}
          <div className="flex items-center gap-2 mb-3">
            <BarChart2 size={15} className="text-slate-400 flex-shrink-0" />
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Abstimmung</span>
            {msg.pollAnonymous && (
              <span className="flex items-center gap-0.5 text-xs text-slate-400 ml-auto">
                <Lock size={11} />
                Anonym
              </span>
            )}
          </div>

          {/* Frage */}
          <p className="text-sm font-semibold text-slate-800 mb-3 leading-snug">
            {msg.pollQuestion}
          </p>

          {/* Optionen */}
          <div className="flex flex-col gap-2">
            {options.map((option, i) => {
              const count = (votes[i] ?? []).length
              const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0
              const isMyVote = myVoteIdx === i
              const isLeading = count > 0 && count === Math.max(...options.map((_, j) => (votes[j] ?? []).length))
              const names = !msg.pollAnonymous && count > 0 ? voterNames(i) : ''

              return (
                <button
                  key={i}
                  onClick={() => handleVote(i)}
                  className={`relative w-full text-left rounded-xl px-3 py-2.5 text-sm transition-all overflow-hidden border ${
                    isMyVote
                      ? 'border-blue-400 bg-blue-50'
                      : 'border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white'
                  }`}
                >
                  {/* Fortschrittsbalken */}
                  {totalVotes > 0 && pct > 0 && (
                    <div
                      className={`absolute inset-y-0 left-0 rounded-xl transition-all duration-500 ${
                        isMyVote ? 'bg-blue-100' : 'bg-slate-100'
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  )}

                  {/* Inhalt */}
                  <div className="relative flex flex-col gap-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {/* Auswahlindikator */}
                        <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                          isMyVote
                            ? 'border-blue-500 bg-blue-500'
                            : 'border-slate-300'
                        }`}>
                          {isMyVote && (
                            <div className="w-1.5 h-1.5 rounded-full bg-white" />
                          )}
                        </div>
                        <span className={`truncate font-medium ${isMyVote ? 'text-blue-800' : 'text-slate-700'}`}>
                          {option}
                        </span>
                        {isLeading && totalVotes > 0 && (
                          <span className="text-xs">🏆</span>
                        )}
                      </div>

                      {/* Prozent */}
                      {totalVotes > 0 && (
                        <span className={`text-xs font-semibold flex-shrink-0 ${isMyVote ? 'text-blue-600' : 'text-slate-500'}`}>
                          {pct}% ({count})
                        </span>
                      )}
                    </div>

                    {/* Namen der Abstimmenden (nur nicht-anonym) */}
                    {names && (
                      <span className="text-xs text-slate-400 pl-6 truncate">{names}</span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>

          {/* Footer */}
          <div className="mt-2.5 flex items-center justify-between">
            <span className="text-xs text-slate-400">
              {totalVotes === 0
                ? 'Noch keine Stimmen'
                : `${totalVotes} ${totalVotes === 1 ? 'Stimme' : 'Stimmen'}`}
            </span>
            {hasVoted && (
              <button
                onClick={() => handleVote(myVoteIdx)}
                className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
              >
                Stimme zurückziehen
              </button>
            )}
          </div>
        </div>

        <span className="text-xs text-slate-400 px-1">{formatTime(msg.createdAt)}</span>
      </div>
    </div>
  )
}
