import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import type { ReactNode } from 'react'
import {
  collection, onSnapshot, query, where,
  doc, setDoc, Timestamp, getDoc,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from './AuthContext'
import type { Channel, DirectConversation } from '../types'
import { showNotification, notificationsGranted } from '../utils/notifications'

type MsgDoc = { ts: Date | null; authorId: string; authorName: string }

interface ChatContextType {
  channels: Channel[]
  dmConversations: DirectConversation[]
  counts: Record<string, number>
  totalUnread: number
  markAsRead: (id: string) => void
  markAllAsRead: () => Promise<void>
}

const ChatContext = createContext<ChatContextType>({
  channels: [],
  dmConversations: [],
  counts: {},
  totalUnread: 0,
  markAsRead: () => {},
  markAllAsRead: async () => {},
})

export function useChatContext() {
  return useContext(ChatContext)
}

export function useUnreadTotal() {
  const { totalUnread, markAllAsRead } = useContext(ChatContext)
  return { totalUnread, markAllAsRead }
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const { currentUser, userProfile } = useAuth()

  const [channels, setChannels] = useState<Channel[]>([])
  const [dmConversations, setDmConversations] = useState<DirectConversation[]>([])
  const [msgDocs, setMsgDocs] = useState<Record<string, MsgDoc[]>>({})
  const [lastReadMap, setLastReadMap] = useState<Record<string, Date>>({})
  // Wird true sobald der erste userActivity-Snapshot aus Firestore kam.
  // Verhindert false-positive Badges während des Ladens.
  const [lastReadLoaded, setLastReadLoaded] = useState(false)

  // Ref damit markAsRead immer die aktuellen msgDocs sieht ohne die Funktion neu zu erstellen
  const msgDocsRef = useRef<Record<string, MsgDoc[]>>({})
  msgDocsRef.current = msgDocs

  // Speichert die Anzahl der bekannten Nachrichten pro Channel/DM, um neue zu erkennen
  const msgCountRef = useRef<Record<string, number>>({})

  // Channels laden
  // Drei getrennte States mit jeweils exakter '=='-Abfrage. Firestore kann Security-Rules
  // für List-Queries nur dann statisch beweisen, wenn die Query-Filter 1:1 zu den
  // Regel-Bedingungen passen – ein "in"-Filter über mehrere Typen führt sonst zu
  // permission-denied, auch wenn die Regel selbst korrekt wäre.
  const [vorstandChannels, setVorstandChannels] = useState<Channel[]>([])
  const [gaesteChannels, setGaesteChannels] = useState<Channel[]>([])
  const [projektChannels, setProjektChannels] = useState<Channel[]>([])

  // "Vorstand"-Channels: nur für Vorstand/Admin, nicht für Gäste
  useEffect(() => {
    if (!currentUser || userProfile?.role === 'gast') { setVorstandChannels([]); return }
    const q = query(collection(db, 'channels'), where('type', '==', 'vorstand'))
    return onSnapshot(q, snap => {
      setVorstandChannels(snap.docs.map(d => ({ id: d.id, ...d.data() } as Channel)))
    }, err => console.warn('Vorstand-Channels listener error:', err))
  }, [currentUser, userProfile?.role])

  // "Vorstand & Gäste"-Channels: für alle eingeloggten Nutzer inkl. Gäste
  useEffect(() => {
    if (!currentUser) { setGaesteChannels([]); return }
    const q = query(collection(db, 'channels'), where('type', '==', 'vorstand_gaeste'))
    return onSnapshot(q, snap => {
      setGaesteChannels(snap.docs.map(d => ({ id: d.id, ...d.data() } as Channel)))
    }, err => console.warn('Gäste-Channels listener error:', err))
  }, [currentUser])

  // Projekt-Channels: nur die, in denen der Nutzer als Mitglied eingetragen ist (auch Gäste möglich)
  useEffect(() => {
    if (!currentUser) { setProjektChannels([]); return }
    const q = query(
      collection(db, 'channels'),
      where('type', '==', 'projekt'),
      where('members', 'array-contains', currentUser.uid)
    )
    return onSnapshot(q, snap => {
      setProjektChannels(snap.docs.map(d => ({ id: d.id, ...d.data() } as Channel)))
    }, err => console.warn('Projekt-Channels listener error:', err))
  }, [currentUser, userProfile?.role])

  useEffect(() => {
    setChannels([...vorstandChannels, ...gaesteChannels, ...projektChannels])
  }, [vorstandChannels, gaesteChannels, projektChannels])

  // DM-Conversations laden (nur für eingeloggte Nicht-Gäste)
  useEffect(() => {
    if (!currentUser || userProfile?.role === 'gast') return
    const q = query(
      collection(db, 'directMessages'),
      where('participants', 'array-contains', currentUser.uid)
    )
    return onSnapshot(q, snap => {
      setDmConversations(snap.docs.map(d => ({
        convId: d.id,
        participants: d.data().participants as string[],
      })))
    }, err => console.warn('DM conversations listener error:', err))
  }, [currentUser, userProfile?.role])

  // lastReadMap laden – Null-Safety für serverTimestamp()-Pending-Snapshots
  useEffect(() => {
    if (!currentUser) return
    return onSnapshot(
      doc(db, 'userActivity', currentUser.uid),
      snap => {
        setLastReadLoaded(true)  // Firestore hat geantwortet – ab jetzt Badges berechnen
        const data = snap.data()?.channelLastRead as Record<string, Timestamp> | undefined
        if (!data) return   // kein Dokument oder kein channelLastRead → lastReadMap bleibt {}
        const mapped: Record<string, Date> = {}
        for (const [id, ts] of Object.entries(data)) {
          if (ts && typeof (ts as Timestamp).toDate === 'function') {
            mapped[id] = (ts as Timestamp).toDate()
          }
        }
        // Nur neuere Timestamps übernehmen – verhindert, dass ein Firestore-Snapshot
        // das optimistische Update (markAsRead) zurücksetzt, bevor der Write bestätigt ist.
        setLastReadMap(prev => {
          const merged: Record<string, Date> = { ...prev }
          let changed = false
          for (const [id, date] of Object.entries(mapped)) {
            const prevDate = prev[id]
            if (!prevDate || date.getTime() > prevDate.getTime()) {
              merged[id] = date
              changed = true
            }
          }
          return changed ? merged : prev
        })
      },
      // Fehler-Handler: bei Firestore-Regelverstoß nie einfrieren
      err => console.warn('userActivity listener error:', err)
    )
    // Beim Wechsel des Users zurücksetzen
    return () => setLastReadLoaded(false)
  }, [currentUser])

  // Nachrichten pro Channel abonnieren
  useEffect(() => {
    if (!currentUser || channels.length === 0) return
    const unsubs = channels.map(ch => {
      const q = query(collection(db, 'channels', ch.id, 'messages'))
      return onSnapshot(q, snap => {
        const docs: MsgDoc[] = snap.docs.map(d => ({
          ts: (d.data().createdAt as Timestamp)?.toDate() ?? null,
          authorId: d.data().authorId as string,
          authorName: d.data().authorName as string ?? '',
        }))
        // Benachrichtigung bei neuer Nachricht von jemand anderem
        const prevCount = msgCountRef.current[ch.id] ?? -1
        if (prevCount >= 0 && docs.length > prevCount && notificationsGranted() && document.hidden) {
          const newest = docs[docs.length - 1]
          if (newest.authorId !== currentUser?.uid) {
            showNotification(
              `${newest.authorName || 'Neue Nachricht'} in #${ch.name}`,
              ''
            )
          }
        }
        msgCountRef.current[ch.id] = docs.length
        setMsgDocs(prev => ({ ...prev, [ch.id]: docs }))
      })
    })
    return () => unsubs.forEach(u => u())
  }, [currentUser, channels.map(c => c.id).join(',')])

  // Nachrichten pro DM-Conversation abonnieren
  useEffect(() => {
    if (!currentUser || dmConversations.length === 0) return
    const unsubs = dmConversations.map(dm => {
      const q = query(collection(db, 'directMessages', dm.convId, 'messages'))
      return onSnapshot(q, snap => {
        const docs: MsgDoc[] = snap.docs.map(d => ({
          ts: (d.data().createdAt as Timestamp)?.toDate() ?? null,
          authorId: d.data().authorId as string,
          authorName: d.data().authorName as string ?? '',
        }))
        // Benachrichtigung bei neuer DM von jemand anderem
        const prevCount = msgCountRef.current[dm.convId] ?? -1
        if (prevCount >= 0 && docs.length > prevCount && notificationsGranted() && document.hidden) {
          const newest = docs[docs.length - 1]
          if (newest.authorId !== currentUser?.uid) {
            showNotification(
              `Direktnachricht von ${newest.authorName || 'Jemand'}`,
              ''
            )
          }
        }
        msgCountRef.current[dm.convId] = docs.length
        setMsgDocs(prev => ({ ...prev, [dm.convId]: docs }))
      }, err => console.warn('DM messages listener error:', err))
    })
    return () => unsubs.forEach(u => u())
  }, [currentUser, dmConversations.map(d => d.convId).join(',')])

  // Counts direkt aus React-State berechnen (Channels + DMs)
  const allIds = [
    ...channels.map(c => c.id),
    ...dmConversations.map(d => d.convId),
  ]
  const counts: Record<string, number> = {}
  for (const id of allIds) {
    if (!lastReadLoaded) {
      counts[id] = 0
      continue
    }
    const lastRead = lastReadMap[id]
    const msgs = msgDocs[id] ?? []
    let count = 0
    for (const { ts, authorId } of msgs) {
      if (authorId === currentUser?.uid) continue          // eigene Nachrichten nie ungelesen
      if (!lastRead || (ts && ts > lastRead)) count++
    }
    counts[id] = count
  }
  const totalUnread = Object.values(counts).reduce((a, b) => a + b, 0)

  // PWA Badge – direkt + via Service Worker (funktioniert auch wenn App minimiert ist)
  useEffect(() => {
    // Direkt setzen (App im Vordergrund)
    if ('setAppBadge' in navigator) {
      if (totalUnread > 0) {
        (navigator as Navigator & { setAppBadge: (n: number) => void }).setAppBadge(totalUnread)
      } else {
        (navigator as Navigator & { clearAppBadge: () => void }).clearAppBadge?.()
      }
    }
    // Via Service Worker setzen (App im Hintergrund / minimiert)
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'SET_BADGE',
        count: totalUnread,
      })
    }
  }, [totalUnread])

  const markAsRead = useCallback(async (id: string) => {
    if (!currentUser) return

    // Neuesten bestätigten Nachrichten-Timestamp + 1ms als lastRead verwenden.
    const msgs = msgDocsRef.current[id] ?? []
    let latestTs = new Date(0)
    for (const { ts } of msgs) {
      if (ts && ts > latestTs) latestTs = ts
    }
    const readTime = latestTs.getTime() > 0
      ? new Date(latestTs.getTime() + 1)
      : new Date()

    // Sofort optimistisch aktualisieren – Badge verschwindet ohne Wartezeit
    setLastReadMap(prev => ({ ...prev, [id]: readTime }))

    // In Firestore persistieren (Client-Timestamp → kein null-Pending-Bug)
    await setDoc(
      doc(db, 'userActivity', currentUser.uid),
      { channelLastRead: { [id]: Timestamp.fromDate(readTime) } },
      { merge: true }
    )
  }, [currentUser])

  // Alle Kanäle + verwaiste DMs als gelesen markieren → Badge löschen
  const markAllAsRead = useCallback(async () => {
    if (!currentUser) return
    const now = new Date()
    const nowTs = Timestamp.fromDate(now)

    // Alle bekannten IDs (aktive Channels + DMs)
    const knownIds = [
      ...channels.map(c => c.id),
      ...dmConversations.map(d => d.convId),
    ]

    // Auch verwaiste IDs aus Firestore lesen (z.B. gelöschte DMs)
    const activitySnap = await getDoc(doc(db, 'userActivity', currentUser.uid))
    const storedIds = Object.keys(activitySnap.data()?.channelLastRead ?? {})
    const allIds = Array.from(new Set([...knownIds, ...storedIds]))

    // lastReadMap optimistisch auf jetzt setzen
    const nowMap: Record<string, Date> = {}
    for (const id of allIds) nowMap[id] = now
    setLastReadMap(prev => ({ ...prev, ...nowMap }))

    // In Firestore schreiben
    const channelLastRead: Record<string, Timestamp> = {}
    for (const id of allIds) channelLastRead[id] = nowTs
    await setDoc(
      doc(db, 'userActivity', currentUser.uid),
      { channelLastRead },
      { merge: true }
    )

    // Badge sofort löschen
    if ('clearAppBadge' in navigator) {
      (navigator as Navigator & { clearAppBadge: () => void }).clearAppBadge?.()
    }
    navigator.serviceWorker?.controller?.postMessage({ type: 'SET_BADGE', count: 0 })
  }, [currentUser, channels, dmConversations])

  return (
    <ChatContext.Provider value={{ channels, dmConversations, counts, totalUnread, markAsRead, markAllAsRead }}>
      {children}
    </ChatContext.Provider>
  )
}
