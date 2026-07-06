import { useEffect, useState, useCallback } from 'react'
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  limit,
  doc,
  setDoc,
  Timestamp,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../context/AuthContext'

// Speichert pro Nutzer+Channel den Zeitpunkt der letzten Anzeige
// Pfad: userActivity/{uid}/channelLastRead/{channelId}

export interface UnreadState {
  // channelId -> anzahl ungelesener Nachrichten
  counts: Record<string, number>
  totalUnread: number
  markAsRead: (channelId: string) => Promise<void>
}

export function useUnread(channelIds: string[]): UnreadState {
  const { currentUser } = useAuth()
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [lastReadMap, setLastReadMap] = useState<Record<string, Date>>({})

  // lastRead-Zeiten aus Firestore laden
  useEffect(() => {
    if (!currentUser || channelIds.length === 0) return
    const ref = doc(db, 'userActivity', currentUser.uid)
    const unsub = onSnapshot(ref, snap => {
      const data = snap.data()?.channelLastRead as Record<string, Timestamp> | undefined
      if (data) {
        const mapped: Record<string, Date> = {}
        for (const [id, ts] of Object.entries(data)) {
          // Null-Safety: serverTimestamp() kann im pending-Snapshot null sein
          if (ts && typeof (ts as Timestamp).toDate === 'function') {
            mapped[id] = (ts as Timestamp).toDate()
          }
        }
        setLastReadMap(mapped)
      }
    })
    return unsub
  }, [currentUser, channelIds.join(',')])

  // Pro Channel: Nachrichten zählen die neuer als lastRead sind
  useEffect(() => {
    if (!currentUser || channelIds.length === 0) return

    const unsubscribers: (() => void)[] = []

    for (const channelId of channelIds) {
      const q = query(
        collection(db, 'channels', channelId, 'messages'),
        orderBy('createdAt', 'desc'),
        limit(50)
      )
      const unsub = onSnapshot(q, snap => {
        const lastRead = lastReadMap[channelId]
        let count = 0
        for (const d of snap.docs) {
          const ts = (d.data().createdAt as Timestamp)?.toDate()
          const authorId = d.data().authorId as string
          // Eigene Nachrichten nicht als ungelesen zählen
          if (ts && lastRead && ts > lastRead && authorId !== currentUser.uid) {
            count++
          } else if (!lastRead && authorId !== currentUser.uid) {
            count++
          }
        }
        setCounts(prev => ({ ...prev, [channelId]: count }))
      })
      unsubscribers.push(unsub)
    }

    return () => unsubscribers.forEach(u => u())
  }, [currentUser, channelIds.join(','), lastReadMap])

  // PWA Badge API aktualisieren
  useEffect(() => {
    const total = Object.values(counts).reduce((a, b) => a + b, 0)
    if ('setAppBadge' in navigator) {
      if (total > 0) {
        (navigator as Navigator & { setAppBadge: (n: number) => void }).setAppBadge(total)
      } else {
        (navigator as Navigator & { clearAppBadge: () => void }).clearAppBadge?.()
      }
    }
  }, [counts])

  // Badge löschen wenn kein Nutzer eingeloggt
  useEffect(() => {
    if (!currentUser && 'clearAppBadge' in navigator) {
      (navigator as Navigator & { clearAppBadge: () => void }).clearAppBadge?.()
    }
  }, [currentUser])

  const markAsRead = useCallback(async (channelId: string) => {
    if (!currentUser) return
    const now = new Date()
    const nowTs = Timestamp.fromDate(now)
    // Sofort optimistisch aktualisieren – kein Warten auf Firestore
    setLastReadMap(prev => ({ ...prev, [channelId]: now }))
    setCounts(prev => ({ ...prev, [channelId]: 0 }))
    // In Firestore speichern – Client-Timestamp statt serverTimestamp()
    // (serverTimestamp() erzeugt pending-null-Snapshot → ts.toDate() wirft)
    await setDoc(
      doc(db, 'userActivity', currentUser.uid),
      { channelLastRead: { [channelId]: nowTs } },
      { merge: true }
    )
  }, [currentUser])

  const totalUnread = Object.values(counts).reduce((a, b) => a + b, 0)

  return { counts, totalUnread, markAsRead }
}
