export type UserRole = 'vorstand' | 'admin' | 'gast'

export interface DirectConversation {
  convId: string          // [uid1, uid2].sort().join('_')
  participants: string[]  // [uid1, uid2]
}

export interface AppUser {
  uid: string
  email: string
  displayName: string
  role: UserRole
  avatarUrl?: string
  createdAt: Date
  lastSeen?: Date
  invitedAt?: Date
  hasLoggedIn?: boolean
  emailNotifications?: boolean  // opt-in E-Mail-Benachrichtigung bei neuen Nachrichten
}

export type ChannelType = 'vorstand' | 'vorstand_gaeste' | 'projekt'

export interface Channel {
  id: string
  name: string
  type: ChannelType
  description?: string
  members: string[] // UIDs
  createdBy: string
  createdAt: Date
}

export interface Message {
  id: string
  channelId: string
  text: string
  authorId: string
  authorName: string
  createdAt: Date
  editedAt?: Date
  fileUrl?: string
  fileName?: string
  fileType?: string
  reactions?: Record<string, string[]> // emoji -> Array von UIDs
  // Abstimmung
  type?: 'message' | 'poll'
  pollQuestion?: string
  pollOptions?: string[]           // z.B. ['Ja', 'Nein', 'Enthaltung']
  pollVotes?: Record<string, string[]> // optionIndex -> Array von UIDs
  pollAnonymous?: boolean          // true = nur Gesamtzahl sichtbar, kein Wer
}

export type TodoPriority = 'hoch' | 'mittel' | 'niedrig'

export interface Todo {
  id: string
  title: string
  description?: string
  assignedTo?: string // UID
  assignedToName?: string
  priority: TodoPriority
  dueDate?: Date
  done: boolean
  channelId?: string
  createdBy: string
  createdByName: string
  createdAt: Date
}

// Wiederholungsregel
export type RecurrenceFreq = 'none' | 'daily' | 'weekly' | 'monthly_date' | 'monthly_weekday'
// monthly_date   = jeden N-ten des Monats
// monthly_weekday = jeden N-ten Wochentag im Monat (z.B. jeden 2. Dienstag)

export interface RecurrenceRule {
  freq: RecurrenceFreq
  interval: number          // z.B. 2 = jeden 2. Dienstag
  weekday?: number          // 0=Mo … 6=So (für weekly + monthly_weekday)
  weekdayOrdinal?: number   // 1=erster, 2=zweiter, -1=letzter (für monthly_weekday)
  until?: string            // ISO-Datum bis wann (optional)
}

export interface Tagesordnungspunkt {
  id: string
  nr: string
  bezeichnung: string
  zustaendig: string
  unterlagen: string
}

export interface Sitzung {
  id: string
  jahr: number
  datum: string          // "YYYY-MM-DD"
  status: 'offen' | 'abgeschlossen'
  tagesordnung: Tagesordnungspunkt[]
  createdBy: string
  createdAt: Date
}

export interface CalendarEvent {
  id: string
  title: string
  start: Date
  end: Date
  location?: string
  description?: string
  createdBy: string
  googleEventId?: string
  reminderMinutes?: number
  recurrence?: RecurrenceRule
}
