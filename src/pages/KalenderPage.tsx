import { useEffect, useState } from 'react'
import {
  collection, onSnapshot, addDoc, deleteDoc,
  doc, serverTimestamp, query, orderBy, updateDoc,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../context/AuthContext'
import type { CalendarEvent, RecurrenceFreq, RecurrenceRule } from '../types'
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval,
  startOfWeek, endOfWeek, isSameMonth, isSameDay, isToday,
  addMonths, subMonths,
} from 'date-fns'
import { de } from 'date-fns/locale'
import {
  ChevronLeft, ChevronRight, Plus, X, Trash2, Bell,
  RefreshCw, Calendar, Upload, Download, Loader2, AlertCircle, Pencil,
} from 'lucide-react'
import { expandRecurring, recurrenceLabel } from '../utils/recurrence'
import { useGoogleCalendar } from '../hooks/useGoogleCalendar'

const WEEKDAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag']
const ORDINALS = [
  { value: 1, label: 'ersten' },
  { value: 2, label: 'zweiten' },
  { value: 3, label: 'dritten' },
  { value: 4, label: 'vierten' },
  { value: -1, label: 'letzten' },
]

export default function KalenderPage() {
  const { currentUser, userProfile } = useAuth()
  const [firestoreEvents, setFirestoreEvents] = useState<CalendarEvent[]>([])
  const [googleEvents, setGoogleEvents] = useState<CalendarEvent[]>([])
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [selectedDay, setSelectedDay] = useState<Date | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [exportingId, setExportingId] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null)

  const { isConnected, isSyncing, error: gError, connect, exportEvent, updateGoogleEvent, importEvents, disconnect } =
    useGoogleCalendar()

  // Form state
  const [title, setTitle] = useState('')
  const [startDate, setStartDate] = useState('')
  const [startTime, setStartTime] = useState('09:00')
  const [endDate, setEndDate] = useState('')
  const [endTime, setEndTime] = useState('10:00')
  const [location, setLocation] = useState('')
  const [description, setDescription] = useState('')
  const [reminderMin, setReminderMin] = useState('30')

  // Wiederholung
  const [recFreq, setRecFreq] = useState<RecurrenceFreq>('none')
  const [recInterval, setRecInterval] = useState(1)
  const [recWeekday, setRecWeekday] = useState(1)
  const [recOrdinal, setRecOrdinal] = useState(1)
  const [recUntil, setRecUntil] = useState('')

  const isGast = userProfile?.role === 'gast'

  // Firestore Events
  useEffect(() => {
    const q = query(collection(db, 'events'), orderBy('start', 'asc'))
    return onSnapshot(q, (snap: import('firebase/firestore').QuerySnapshot) => {
      setFirestoreEvents(
        snap.docs.map((d: import('firebase/firestore').QueryDocumentSnapshot) => ({
          id: d.id,
          ...d.data(),
          start: (d.data().start as import('firebase/firestore').Timestamp)?.toDate() ?? new Date(),
          end: (d.data().end as import('firebase/firestore').Timestamp)?.toDate() ?? new Date(),
        } as CalendarEvent))
      )
    })
  }, [])

  // Kalender-Bereich
  const monthStart = startOfMonth(currentMonth)
  const monthEnd = endOfMonth(currentMonth)
  const calStart = startOfWeek(monthStart, { weekStartsOn: 1 })
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 })
  const days = eachDayOfInterval({ start: calStart, end: calEnd })

  // Wiederholungs-Instanzen expandieren
  const expandedFirestore = firestoreEvents.flatMap(ev => expandRecurring(ev, calStart, calEnd))
  // Google Events für sichtbaren Bereich filtern
  const visibleGoogle = googleEvents.filter(
    e => e.start <= calEnd && e.end >= calStart
  )
  const allDisplayEvents = [...expandedFirestore, ...visibleGoogle]

  const eventsForDay = (day: Date) => allDisplayEvents.filter(e => isSameDay(e.start, day))

  // Google Kalender Sync für aktuellen Monat
  async function handleGoogleSync() {
    const imported = await importEvents(
      subMonths(monthStart, 1),
      addMonths(monthEnd, 1)
    )
    setGoogleEvents(imported)
  }

  async function handleConnect() {
    await connect()
    // Direkt nach Verbindung Daten laden
    const imported = await importEvents(subMonths(monthStart, 1), addMonths(monthEnd, 1))
    setGoogleEvents(imported)
  }

  async function handleExportEvent(ev: CalendarEvent) {
    setExportingId(ev.id)
    const googleId = await exportEvent(ev)
    if (googleId) {
      // Speichere Google Event ID in Firestore (nur für Basisevents, nicht Wiederholungs-Instanzen)
      const baseId = ev.id.includes('_') ? ev.id.split('_')[0] : ev.id
      if (!baseId.startsWith('gcal_')) {
        await updateDoc(doc(db, 'events', baseId), { googleEventId: googleId })
      }
    }
    setExportingId(null)
  }

  function openEdit(ev: CalendarEvent) {
    setEditingEvent(ev)
    setTitle(ev.title)
    setStartDate(format(ev.start, 'yyyy-MM-dd'))
    setStartTime(format(ev.start, 'HH:mm'))
    setEndDate(format(ev.end, 'yyyy-MM-dd'))
    setEndTime(format(ev.end, 'HH:mm'))
    setLocation(ev.location ?? '')
    setDescription(ev.description ?? '')
    setReminderMin(String(ev.reminderMinutes ?? 30))
    setRecFreq(ev.recurrence?.freq ?? 'none')
    setRecInterval(ev.recurrence?.interval ?? 1)
    setRecWeekday(ev.recurrence?.weekday ?? 1)
    setRecOrdinal(ev.recurrence?.weekdayOrdinal ?? 1)
    setRecUntil(ev.recurrence?.until ?? '')
    setSaveError(null)
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditingEvent(null)
    setSaveError(null)
  }

  async function saveEvent() {
    setSaveError(null)
    if (!title.trim() || !startDate) return
    if (!currentUser) {
      setSaveError('Nicht eingeloggt – bitte Seite neu laden.')
      return
    }
    const start = new Date(`${startDate}T${startTime}`)
    const end = new Date(`${endDate || startDate}T${endTime}`)

    if (end <= start) {
      setSaveError('Endzeit muss nach der Startzeit liegen.')
      return
    }

    const recurrence: RecurrenceRule = {
      freq: recFreq,
      interval: recInterval,
      ...(recFreq === 'weekly' && { weekday: recWeekday }),
      ...(recFreq === 'monthly_weekday' && { weekday: recWeekday, weekdayOrdinal: recOrdinal }),
      ...(recUntil && { until: recUntil }),
    }

    try {
      if (editingEvent) {
        // Bestehenden Termin aktualisieren
        const baseId = editingEvent.id.includes('_') ? editingEvent.id.split('_')[0] : editingEvent.id
        const updateData = {
          title: title.trim(),
          start,
          end,
          location: location.trim() || null,
          description: description.trim() || null,
          reminderMinutes: parseInt(reminderMin),
          recurrence: recFreq !== 'none' ? recurrence : null,
        }
        await updateDoc(doc(db, 'events', baseId), updateData)
        // Google sync: Termin auch in Google aktualisieren
        if (isConnected && editingEvent.googleEventId) {
          await updateGoogleEvent(editingEvent.googleEventId, {
            ...editingEvent, ...updateData, start, end,
            location: updateData.location ?? undefined,
            description: updateData.description ?? undefined,
            recurrence: updateData.recurrence ?? undefined,
          })
        }
      } else {
        // Neuen Termin anlegen
        const newRef = await addDoc(collection(db, 'events'), {
          title: title.trim(),
          start,
          end,
          location: location.trim() || null,
          description: description.trim() || null,
          reminderMinutes: parseInt(reminderMin),
          recurrence: recFreq !== 'none' ? recurrence : null,
          createdBy: currentUser.uid,
          createdAt: serverTimestamp(),
        })
        // Google sync: Neuen Termin automatisch nach Google exportieren
        if (isConnected) {
          const tempEv: CalendarEvent = {
            id: newRef.id,
            title: title.trim(),
            start, end,
            location: location.trim() || undefined,
            description: description.trim() || undefined,
            reminderMinutes: parseInt(reminderMin),
            createdBy: currentUser.uid,
          }
          const googleId = await exportEvent(tempEv)
          if (googleId) {
            await updateDoc(doc(db, 'events', newRef.id), { googleEventId: googleId })
          }
        }
      }

      setTitle(''); setStartDate(''); setEndDate(''); setLocation('')
      setDescription(''); setRecFreq('none'); setRecInterval(1)
      setRecWeekday(1); setRecOrdinal(1); setRecUntil('')
      setEditingEvent(null)
      setShowForm(false)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setSaveError(`Fehler beim Speichern: ${msg}`)
    }
  }

  async function deleteEvent(id: string) {
    if (id.startsWith('gcal_')) return // Google Events nicht aus App löschen
    const baseId = id.includes('_') ? id.split('_')[0] : id
    if (!confirm('Termin löschen? Bei Wiederholungen werden ALLE Instanzen gelöscht.')) return
    await deleteDoc(doc(db, 'events', baseId))
  }

  const selectedEvents = selectedDay ? eventsForDay(selectedDay) : []

  // Nächste Termine (3 Monate)
  const upcoming = [
    ...firestoreEvents.flatMap(ev => expandRecurring(ev, new Date(), addMonths(new Date(), 3))),
    ...googleEvents.filter(e => e.start >= new Date()),
  ]
    .filter(e => e.start >= new Date())
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .slice(0, 8)

  const isGoogleEvent = (ev: CalendarEvent) =>
    ev.id.startsWith('gcal_') || ev.createdBy === 'google'

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 py-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
          <h1 className="text-xl font-semibold text-slate-800">Kalender</h1>
          <div className="flex items-center gap-2">
            {/* Google Kalender */}
            {isConnected ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleGoogleSync}
                  disabled={isSyncing}
                  title="Google Kalender aktualisieren"
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50"
                >
                  {isSyncing
                    ? <Loader2 size={15} className="animate-spin" />
                    : <Calendar size={15} className="text-green-600" />}
                  <span className="text-green-700 font-medium">Verbunden</span>
                </button>
                <button onClick={disconnect} title="Trennen"
                  className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100">
                  <X size={15} />
                </button>
              </div>
            ) : (
              <button
                onClick={handleConnect}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors"
              >
                <Calendar size={15} />
                Google Kalender
              </button>
            )}

            {!isGast && (
              <button
                onClick={() => setShowForm(v => !v)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-white text-sm font-medium"
                style={{ backgroundColor: 'var(--htv-blue)' }}
              >
                <Plus size={16} />
                Termin
              </button>
            )}
          </div>
        </div>

        {/* Google Fehler */}
        {gError && (
          <div className="flex items-center gap-2 bg-red-50 text-red-700 border border-red-200 rounded-lg px-4 py-3 text-sm mb-4">
            <AlertCircle size={15} />
            {gError}
          </div>
        )}

        {/* Termin-Formular */}
        {showForm && !isGast && (
          <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-medium text-slate-800">
                {editingEvent ? 'Termin bearbeiten' : 'Neuer Termin'}
              </h2>
              <button onClick={closeForm}><X size={16} className="text-slate-400" /></button>
            </div>

            <input
              autoFocus
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Titel *"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:border-transparent"
            />

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Beginn</label>
                <input type="date" value={startDate}
                  onChange={e => { setStartDate(e.target.value); if (!endDate) setEndDate(e.target.value) }}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1" />
                <input type="time" value={startTime}
                  onChange={e => setStartTime(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 mt-1" />
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Ende</label>
                <input type="date" value={endDate}
                  onChange={e => setEndDate(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1" />
                <input type="time" value={endTime}
                  onChange={e => setEndTime(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 mt-1" />
              </div>
            </div>

            <input value={location} onChange={e => setLocation(e.target.value)}
              placeholder="Ort (optional)"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1" />

            <textarea value={description} onChange={e => setDescription(e.target.value)}
              placeholder="Beschreibung (optional)" rows={2}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 resize-none" />

            {/* Erinnerung */}
            <div className="flex items-center gap-2">
              <Bell size={14} className="text-slate-400" />
              <label className="text-sm text-slate-600">Erinnerung</label>
              <select value={reminderMin} onChange={e => setReminderMin(e.target.value)}
                className="border border-slate-200 rounded-lg px-2 py-1 text-sm bg-white focus:outline-none">
                <option value="0">keine</option>
                <option value="15">15 min vorher</option>
                <option value="30">30 min vorher</option>
                <option value="60">1 Std vorher</option>
                <option value="1440">1 Tag vorher</option>
              </select>
            </div>

            {/* Wiederholung */}
            <div className="border-t border-slate-100 pt-4 space-y-3">
              <div className="flex items-center gap-2">
                <RefreshCw size={14} className="text-slate-400" />
                <label className="text-sm text-slate-600 font-medium">Wiederholung</label>
              </div>

              <select value={recFreq} onChange={e => setRecFreq(e.target.value as RecurrenceFreq)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1">
                <option value="none">Keine Wiederholung</option>
                <option value="daily">Täglich</option>
                <option value="weekly">Wöchentlich</option>
                <option value="monthly_date">Monatlich (gleicher Tag)</option>
                <option value="monthly_weekday">Monatlich (Wochentag, z.B. 2. Dienstag)</option>
              </select>

              {recFreq !== 'none' && (
                <div className="space-y-3 pl-2">
                  {(recFreq === 'weekly' || recFreq === 'monthly_weekday') && (
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-slate-500 w-20">Wochentag</label>
                      <select value={recWeekday} onChange={e => setRecWeekday(Number(e.target.value))}
                        className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-1">
                        {WEEKDAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
                      </select>
                    </div>
                  )}
                  {recFreq === 'monthly_weekday' && (
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-slate-500 w-20">Position</label>
                      <select value={recOrdinal} onChange={e => setRecOrdinal(Number(e.target.value))}
                        className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-1">
                        {ORDINALS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      <span className="text-xs text-slate-400">{WEEKDAYS[recWeekday]} im Monat</span>
                    </div>
                  )}
                  {recFreq !== 'monthly_weekday' && (
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-slate-500 w-20">Alle</label>
                      <input type="number" min={1} max={12} value={recInterval}
                        onChange={e => setRecInterval(Number(e.target.value))}
                        className="w-16 border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1" />
                      <span className="text-xs text-slate-400">
                        {recFreq === 'daily' ? 'Tage' : recFreq === 'weekly' ? 'Wochen' : 'Monate'}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-slate-500 w-20">Bis</label>
                    <input type="date" value={recUntil} onChange={e => setRecUntil(e.target.value)}
                      className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1" />
                    <span className="text-xs text-slate-400">(leer = unbegrenzt)</span>
                  </div>
                </div>
              )}
            </div>

            {saveError && (
              <div className="flex items-center gap-2 bg-red-50 text-red-700 border border-red-200 rounded-lg px-3 py-2 text-sm">
                <AlertCircle size={14} />
                {saveError}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={closeForm} className="px-4 py-2 text-sm text-slate-600">Abbrechen</button>
              <button onClick={saveEvent} disabled={!title.trim() || !startDate}
                className="px-4 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-40"
                style={{ backgroundColor: 'var(--htv-blue)' }}>
                {editingEvent ? 'Aktualisieren' : 'Speichern'}
              </button>
            </div>
          </div>
        )}

        {/* Monats-Navigation */}
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
            className="p-2 hover:bg-slate-200 rounded-lg transition-colors">
            <ChevronLeft size={18} />
          </button>
          <h2 className="font-semibold text-slate-800 capitalize">
            {format(currentMonth, 'MMMM yyyy', { locale: de })}
          </h2>
          <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
            className="p-2 hover:bg-slate-200 rounded-lg transition-colors">
            <ChevronRight size={18} />
          </button>
        </div>

        {/* Legende */}
        {isConnected && googleEvents.length > 0 && (
          <div className="flex items-center gap-4 mb-3 text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm inline-block" style={{ backgroundColor: 'var(--htv-blue)' }} />
              Vorstands-App
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm bg-green-500 inline-block" />
              Google Kalender
            </span>
          </div>
        )}

        {/* Kalender-Grid */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden mb-5">
          <div className="grid grid-cols-7 border-b border-slate-100">
            {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(d => (
              <div key={d} className="py-2 text-center text-xs font-semibold text-slate-400">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map(day => {
              const dayEvents = eventsForDay(day)
              const isSelected = selectedDay && isSameDay(day, selectedDay)
              const inMonth = isSameMonth(day, currentMonth)
              return (
                <button key={day.toISOString()}
                  onClick={() => setSelectedDay(isSameDay(day, selectedDay ?? new Date(0)) ? null : day)}
                  className={`min-h-16 p-1.5 border-b border-r border-slate-100 text-left transition-colors ${
                    isSelected ? 'bg-blue-50' : 'hover:bg-slate-50'
                  } ${!inMonth ? 'opacity-30' : ''}`}>
                  <span className={`text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full ${
                    isToday(day) ? 'text-white' : 'text-slate-700'
                  }`} style={isToday(day) ? { backgroundColor: 'var(--htv-blue)' } : {}}>
                    {format(day, 'd')}
                  </span>
                  <div className="mt-1 space-y-0.5">
                    {dayEvents.slice(0, 2).map(ev => (
                      <div key={ev.id}
                        className="truncate text-xs px-1 py-0.5 rounded text-white flex items-center gap-1"
                        style={{ backgroundColor: isGoogleEvent(ev) ? '#16a34a' : (ev.recurrence ? 'var(--htv-blue-light)' : 'var(--htv-blue)') }}>
                        {ev.recurrence && !isGoogleEvent(ev) && <span className="text-white/70">↻</span>}
                        <span className="truncate">{ev.title}</span>
                      </div>
                    ))}
                    {dayEvents.length > 2 && (
                      <div className="text-xs text-slate-400 px-1">+{dayEvents.length - 2}</div>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Tagesdetails */}
        {selectedDay && (
          <div className="mb-6">
            <h3 className="font-medium text-slate-800 mb-3 capitalize">
              {format(selectedDay, 'EEEE, d. MMMM yyyy', { locale: de })}
            </h3>
            {selectedEvents.length === 0 ? (
              <p className="text-slate-400 text-sm">Keine Termine an diesem Tag.</p>
            ) : (
              <div className="space-y-2">
                {selectedEvents.map(ev => (
                  <EventCard
                    key={ev.id}
                    ev={ev}
                    isGoogleEvent={isGoogleEvent(ev)}
                    isGast={isGast}
                    googleConnected={isConnected}
                    exporting={exportingId === ev.id}
                    onDelete={() => deleteEvent(ev.id)}
                    onExport={() => handleExportEvent(ev)}
                    onEdit={() => openEdit(ev)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Nächste Termine */}
        {!selectedDay && (
          <div>
            <h3 className="font-medium text-slate-800 mb-3">Nächste Termine</h3>
            {upcoming.length === 0 ? (
              <p className="text-slate-400 text-sm">Keine anstehenden Termine.</p>
            ) : (
              <div className="space-y-2">
                {upcoming.map(ev => (
                  <div key={ev.id} className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex items-start gap-4">
                    <div className="flex-shrink-0 text-center rounded-xl px-3 py-2 text-white"
                      style={{ backgroundColor: isGoogleEvent(ev) ? '#16a34a' : 'var(--htv-blue)' }}>
                      <div className="text-xs font-medium uppercase">{format(ev.start, 'MMM', { locale: de })}</div>
                      <div className="text-lg font-bold leading-none">{format(ev.start, 'd')}</div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-slate-800 text-sm">{ev.title}</div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {format(ev.start, 'HH:mm')} – {format(ev.end, 'HH:mm')}
                        {ev.location && ` · ${ev.location}`}
                      </div>
                      {ev.recurrence && ev.recurrence.freq !== 'none' && (
                        <div className="flex items-center gap-1 text-xs text-blue-400 mt-0.5">
                          <RefreshCw size={10} />
                          {recurrenceLabel(ev.recurrence)}
                        </div>
                      )}
                      {isGoogleEvent(ev) && (
                        <div className="text-xs text-green-600 mt-0.5 flex items-center gap-1">
                          <Calendar size={10} />
                          Google Kalender
                        </div>
                      )}
                    </div>
                    {!isGast && !isGoogleEvent(ev) && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {isConnected && !ev.googleEventId && (
                          <button onClick={() => handleExportEvent(ev)}
                            disabled={exportingId === ev.id}
                            title="In Google Kalender exportieren"
                            className="p-1.5 rounded text-slate-300 hover:text-green-600 disabled:opacity-30 transition-colors">
                            {exportingId === ev.id
                              ? <Loader2 size={14} className="animate-spin" />
                              : <Upload size={14} />}
                          </button>
                        )}
                        <button onClick={() => openEdit(ev)}
                          title="Termin bearbeiten"
                          className="p-1.5 rounded text-slate-300 hover:text-blue-500 transition-colors">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => deleteEvent(ev.id)}
                          className="p-1.5 rounded text-slate-300 hover:text-red-400 transition-colors">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ---- Event Card Komponente ----
interface EventCardProps {
  ev: CalendarEvent
  isGoogleEvent: boolean
  isGast: boolean
  googleConnected: boolean
  exporting: boolean
  onDelete: () => void
  onExport: () => void
  onEdit: () => void
}

function EventCard({ ev, isGoogleEvent, isGast, googleConnected, exporting, onDelete, onExport, onEdit }: EventCardProps) {
  return (
    <div className={`bg-white rounded-xl border px-4 py-3 ${isGoogleEvent ? 'border-green-200' : 'border-slate-200'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {isGoogleEvent && <Calendar size={12} className="text-green-600 flex-shrink-0" />}
            <div className="font-medium text-slate-800 text-sm">{ev.title}</div>
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            {format(ev.start, 'HH:mm')} – {format(ev.end, 'HH:mm')}
            {ev.location && ` · ${ev.location}`}
          </div>
          {ev.description && <div className="text-xs text-slate-500 mt-1">{ev.description}</div>}
          {ev.recurrence && ev.recurrence.freq !== 'none' && !isGoogleEvent && (
            <div className="flex items-center gap-1 text-xs text-blue-500 mt-1">
              <RefreshCw size={10} />
              {recurrenceLabel(ev.recurrence)}
            </div>
          )}
          {ev.reminderMinutes != null && ev.reminderMinutes > 0 && !isGoogleEvent && (
            <div className="flex items-center gap-1 text-xs text-slate-400 mt-0.5">
              <Bell size={10} />
              {ev.reminderMinutes < 60
                ? `${ev.reminderMinutes} min vorher`
                : ev.reminderMinutes === 1440
                ? '1 Tag vorher'
                : `${ev.reminderMinutes / 60} Std vorher`}
            </div>
          )}
          {isGoogleEvent && (
            <div className="text-xs text-green-600 mt-0.5">Aus Google Kalender</div>
          )}
          {ev.googleEventId && !isGoogleEvent && (
            <div className="flex items-center gap-1 text-xs text-green-600 mt-0.5">
              <Download size={10} />
              In Google Kalender exportiert
            </div>
          )}
        </div>

        {!isGast && !isGoogleEvent && (
          <div className="flex items-center gap-1 flex-shrink-0">
            {googleConnected && !ev.googleEventId && (
              <button
                onClick={onExport}
                disabled={exporting}
                title="In Google Kalender exportieren"
                className="p-1.5 rounded text-slate-300 hover:text-green-600 disabled:opacity-40 transition-colors"
              >
                {exporting
                  ? <Loader2 size={15} className="animate-spin" />
                  : <Upload size={15} />}
              </button>
            )}
            <button onClick={onEdit}
              title="Termin bearbeiten"
              className="p-1.5 rounded text-slate-300 hover:text-blue-500 transition-colors">
              <Pencil size={15} />
            </button>
            <button onClick={onDelete}
              className="p-1.5 rounded text-slate-300 hover:text-red-400 transition-colors">
              <Trash2 size={15} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
