import { useEffect, useState } from 'react'
import {
  collection, onSnapshot, addDoc, updateDoc,
  deleteDoc, doc, serverTimestamp, query, orderBy,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../context/AuthContext'
import type { Sitzung, Tagesordnungspunkt } from '../types'
import { Plus, Trash2, PlusCircle, Check, Archive, ClipboardList } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { de } from 'date-fns/locale'

function neuenPunkt(): Tagesordnungspunkt {
  return { id: crypto.randomUUID(), nr: '', bezeichnung: '', zustaendig: '', unterlagen: '' }
}

export default function SitzungPage() {
  const { currentUser, userProfile } = useAuth()
  const [sitzungen, setSitzungen] = useState<Sitzung[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedJahr, setSelectedJahr] = useState<number>(new Date().getFullYear())
  const [showNewForm, setShowNewForm] = useState(false)
  const [newDatum, setNewDatum] = useState('')
  const [editingTO, setEditingTO] = useState<Tagesordnungspunkt[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const isGast = userProfile?.role === 'gast'

  // Firestore live-sync
  useEffect(() => {
    const q = query(collection(db, 'sitzungen'), orderBy('datum', 'desc'))
    return onSnapshot(q, snap => {
      setSitzungen(
        snap.docs.map(d => ({
          id: d.id,
          ...d.data(),
          createdAt: (d.data().createdAt as import('firebase/firestore').Timestamp)?.toDate() ?? new Date(),
          tagesordnung: (d.data().tagesordnung ?? []) as Tagesordnungspunkt[],
        } as Sitzung))
      )
    }, err => {
      console.error('Sitzungen-Listener Fehler:', err.message)
    })
  }, [])

  // Neueste offene Sitzung auto-auswählen
  useEffect(() => {
    if (sitzungen.length > 0 && !selectedId) {
      const offen = sitzungen.find(s => s.status === 'offen')
      const erste = offen ?? sitzungen[0]
      setSelectedId(erste.id)
      setSelectedJahr(erste.jahr)
    }
  }, [sitzungen, selectedId])

  const jahre = [...new Set(sitzungen.map(s => s.jahr))].sort((a, b) => b - a)
  const sitzungenImJahr = sitzungen.filter(s => s.jahr === selectedJahr)
  const selected = sitzungen.find(s => s.id === selectedId) ?? null

  async function createSitzung() {
    if (!newDatum || !currentUser) return
    setSaving(true)
    setCreateError(null)
    try {
      const ref = await addDoc(collection(db, 'sitzungen'), {
        datum: newDatum,
        jahr: parseInt(newDatum.split('-')[0]),
        status: 'offen',
        tagesordnung: [],
        createdBy: currentUser.uid,
        createdAt: serverTimestamp(),
      })
      setSelectedId(ref.id)
      setSelectedJahr(parseInt(newDatum.split('-')[0]))
      setShowNewForm(false)
      setNewDatum('')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setCreateError(msg)
    } finally {
      setSaving(false)
    }
  }

  function sortiereTagesordnung(to: Tagesordnungspunkt[]): Tagesordnungspunkt[] {
    return [...to].sort((a, b) => {
      const na = parseFloat(String(a.nr)) || 0
      const nb = parseFloat(String(b.nr)) || 0
      return na - nb
    })
  }

  async function saveTagesordnung(sitzungId: string, to: Tagesordnungspunkt[]) {
    setSaving(true)
    const sorted = sortiereTagesordnung(to)
    try {
      await updateDoc(doc(db, 'sitzungen', sitzungId), { tagesordnung: sorted })
      setEditingTO(null)
    } finally {
      setSaving(false)
    }
  }

  async function sitzungAbschliessen(id: string) {
    if (!confirm('Sitzung abschließen und archivieren?')) return
    await updateDoc(doc(db, 'sitzungen', id), { status: 'abgeschlossen' })
  }

  async function sitzungLoeschen(id: string) {
    if (!confirm('Sitzung wirklich löschen?')) return
    await deleteDoc(doc(db, 'sitzungen', id))
    if (selectedId === id) setSelectedId(null)
  }

  function updatePunkt(
    idx: number,
    field: keyof Tagesordnungspunkt,
    value: string
  ) {
    setEditingTO(prev =>
      prev!.map((p, i) => (i === idx ? { ...p, [field]: value } : p))
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* ── Mobile Sitzungsauswahl (nur auf kleinen Bildschirmen) ── */}
      <div className="md:hidden flex-shrink-0 bg-white border-b border-slate-200 px-3 py-2 flex items-center gap-2">
        <label className="text-xs text-slate-500 flex-shrink-0">Sitzung:</label>
        <select
          value={selectedId ?? ''}
          onChange={e => {
            const id = e.target.value
            setSelectedId(id)
            const s = sitzungen.find(x => x.id === id)
            if (s) setSelectedJahr(s.jahr)
          }}
          className="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 bg-white"
        >
          {sitzungen.length === 0 && <option value="">Keine Sitzungen</option>}
          {[...new Set(sitzungen.map(s => s.jahr))].sort((a, b) => b - a).map(j => (
            <optgroup key={j} label={String(j)}>
              {sitzungen.filter(s => s.jahr === j).map(s => (
                <option key={s.id} value={s.id}>
                  {format(parseISO(s.datum), 'dd.MM.yyyy', { locale: de })}
                  {s.status === 'abgeschlossen' ? ' (Archiv)' : ''}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {!isGast && (
          <button
            onClick={() => setShowNewForm(true)}
            className="flex-shrink-0 flex items-center gap-1 px-2 py-1.5 rounded-lg text-white text-xs font-medium"
            style={{ backgroundColor: 'var(--htv-blue)' }}
          >
            <Plus size={13} />
            Neu
          </button>
        )}
      </div>

      <div className="flex-1 flex overflow-hidden">
      {/* ── Linke Sidebar: Jahres- und Sitzungsliste (nur Desktop) ── */}
      <aside className="hidden md:flex w-48 flex-shrink-0 bg-white border-r border-slate-200 flex-col">
        {/* Jahresauswahl */}
        <div className="px-3 pt-4 pb-2 border-b border-slate-100">
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
            Jahr
          </div>
          <div className="flex flex-col gap-0.5">
            {jahre.length === 0 && (
              <span className="text-xs text-slate-300 px-2">–</span>
            )}
            {jahre.map(j => (
              <button
                key={j}
                onClick={() => setSelectedJahr(j)}
                className={`text-left px-2 py-1 rounded-lg text-sm transition-colors ${
                  selectedJahr === j
                    ? 'bg-blue-50 font-semibold'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
                style={selectedJahr === j ? { color: 'var(--htv-blue)' } : {}}
              >
                {j}
              </button>
            ))}
          </div>
        </div>

        {/* Sitzungsliste des gewählten Jahres */}
        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
          {sitzungenImJahr.length === 0 && (
            <div className="text-xs text-slate-400 px-2 py-6 text-center">
              Keine Sitzungen
            </div>
          )}
          {sitzungenImJahr.map(s => (
            <button
              key={s.id}
              onClick={() => setSelectedId(s.id)}
              className={`w-full text-left px-2 py-2 rounded-lg text-sm transition-colors ${
                selectedId === s.id
                  ? 'bg-blue-50 font-medium'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
              style={selectedId === s.id ? { color: 'var(--htv-blue)' } : {}}
            >
              <div className="truncate">
                {format(parseISO(s.datum), 'dd.MM.yy', { locale: de })}
              </div>
              {s.status === 'abgeschlossen' && (
                <span className="text-[10px] text-slate-400">Archiviert</span>
              )}
            </button>
          ))}
        </div>

        {/* Neue Sitzung */}
        {!isGast && (
          <div className="px-2 py-2 border-t border-slate-100">
            <button
              onClick={() => setShowNewForm(true)}
              className="flex items-center gap-1.5 w-full px-2 py-2 rounded-lg text-sm text-white font-medium"
              style={{ backgroundColor: 'var(--htv-blue)' }}
            >
              <Plus size={14} />
              Neue Sitzung
            </button>
          </div>
        )}
      </aside>

      {/* ── Hauptbereich ── */}
      <div className="flex-1 overflow-y-auto bg-slate-50">
        {/* Formular: Neue Sitzung */}
        {showNewForm && (
          <div className="m-4 bg-white rounded-xl border border-slate-200 p-4 max-w-sm">
            <h2 className="font-medium text-slate-800 mb-3">Neue Sitzung anlegen</h2>
            <label className="block text-xs text-slate-500 mb-1">Datum der Sitzung</label>
            <input
              type="date"
              value={newDatum}
              onChange={e => setNewDatum(e.target.value)}
              autoFocus
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:border-transparent mb-3"
            />
            {createError && (
              <div className="mb-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                Fehler: {createError}
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setShowNewForm(false); setNewDatum(''); setCreateError(null) }}
                className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700"
              >
                Abbrechen
              </button>
              <button
                onClick={createSitzung}
                disabled={!newDatum || saving}
                className="px-4 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-40"
                style={{ backgroundColor: 'var(--htv-blue)' }}
              >
                {saving ? 'Speichern…' : 'Erstellen'}
              </button>
            </div>
          </div>
        )}

        {/* Ausgewählte Sitzung */}
        {selected ? (
          <div className="p-4 max-w-4xl">
            {/* Header */}
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="text-xs text-slate-400 mb-0.5">
                  Sitzung {selected.jahr}
                </div>
                <h1 className="text-xl font-semibold text-slate-800">
                  Sitzung am{' '}
                  {format(parseISO(selected.datum), 'dd. MMMM yyyy', { locale: de })}
                </h1>
                {selected.status === 'abgeschlossen' && (
                  <span className="inline-flex items-center gap-1 mt-1 text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
                    <Archive size={11} /> Archiviert
                  </span>
                )}
              </div>

              {!isGast && selected.status === 'offen' && (
                <div className="flex gap-2">
                  <button
                    onClick={() => sitzungAbschliessen(selected.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-slate-200 text-slate-600 hover:bg-slate-100 transition-colors"
                  >
                    <Archive size={14} />
                    Abschließen
                  </button>
                  <button
                    onClick={() => sitzungLoeschen(selected.id)}
                    className="p-1.5 rounded-lg text-slate-300 hover:text-red-400 transition-colors"
                    title="Sitzung löschen"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              )}
            </div>

            {/* Tagesordnung-Karte */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ClipboardList size={16} className="text-slate-400" />
                  <h2 className="font-medium text-slate-800">Tagesordnung</h2>
                </div>
                {!isGast && selected.status === 'offen' && !editingTO && (
                  <button
                    onClick={() =>
                      setEditingTO(
                        selected.tagesordnung.length > 0
                          ? selected.tagesordnung.map(p => ({ ...p }))
                          : [neuenPunkt()]
                      )
                    }
                    className="text-xs px-3 py-1 rounded-lg text-white"
                    style={{ backgroundColor: 'var(--htv-blue)' }}
                  >
                    Bearbeiten
                  </button>
                )}
              </div>

              {/* ── Bearbeitungsmodus ── */}
              {editingTO ? (
                <div className="p-4">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-slate-400 text-left">
                          <th className="pb-2 pr-2 font-medium w-16">TO Nr.</th>
                          <th className="pb-2 pr-2 font-medium">Bezeichnung</th>
                          <th className="pb-2 pr-2 font-medium w-36">Zuständig</th>
                          <th className="pb-2 pr-2 font-medium">Unterlagen / Dateien</th>
                          <th className="pb-2 w-6" />
                        </tr>
                      </thead>
                      <tbody>
                        {editingTO.map((tp, i) => (
                          <tr key={tp.id}>
                            <td className="pr-2 pb-2">
                              <input
                                value={tp.nr}
                                onChange={e => updatePunkt(i, 'nr', e.target.value)}
                                className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1"
                                placeholder="1"
                              />
                            </td>
                            <td className="pr-2 pb-2">
                              <input
                                value={tp.bezeichnung}
                                onChange={e => updatePunkt(i, 'bezeichnung', e.target.value)}
                                className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1"
                                placeholder="Bezeichnung"
                              />
                            </td>
                            <td className="pr-2 pb-2">
                              <input
                                value={tp.zustaendig}
                                onChange={e => updatePunkt(i, 'zustaendig', e.target.value)}
                                className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1"
                                placeholder="Name"
                              />
                            </td>
                            <td className="pr-2 pb-2">
                              <input
                                value={tp.unterlagen}
                                onChange={e => updatePunkt(i, 'unterlagen', e.target.value)}
                                className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1"
                                placeholder="Link oder Dateiname"
                              />
                            </td>
                            <td className="pb-2">
                              <button
                                onClick={() =>
                                  setEditingTO(prev => prev!.filter((_, j) => j !== i))
                                }
                                className="text-slate-300 hover:text-red-400 transition-colors"
                              >
                                <Trash2 size={14} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <button
                    onClick={() => setEditingTO(prev => [...prev!, neuenPunkt()])}
                    className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mt-2 transition-colors"
                  >
                    <PlusCircle size={15} />
                    Punkt hinzufügen
                  </button>

                  <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
                    <button
                      onClick={() => setEditingTO(null)}
                      className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700"
                    >
                      Abbrechen
                    </button>
                    <button
                      onClick={() => saveTagesordnung(selected.id, editingTO)}
                      disabled={saving}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-40"
                      style={{ backgroundColor: 'var(--htv-blue)' }}
                    >
                      <Check size={14} />
                      Speichern
                    </button>
                  </div>
                </div>
              ) : (
                /* ── Anzeigemodus ── */
                <>
                  {selected.tagesordnung.length === 0 ? (
                    <div className="px-4 py-10 text-center text-slate-400 text-sm">
                      Noch keine Tagesordnung eingetragen
                      {!isGast && selected.status === 'offen' && (
                        <div className="mt-2">
                          <button
                            onClick={() => setEditingTO([neuenPunkt()])}
                            className="underline text-sm"
                            style={{ color: 'var(--htv-blue)' }}
                          >
                            Punkte hinzufügen
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-xs text-slate-400 text-left border-b border-slate-100">
                            <th className="px-4 py-2.5 font-medium w-16">TO Nr.</th>
                            <th className="px-4 py-2.5 font-medium">Bezeichnung</th>
                            <th className="px-4 py-2.5 font-medium w-36">Zuständig</th>
                            <th className="px-4 py-2.5 font-medium">Unterlagen / Dateien</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortiereTagesordnung(selected.tagesordnung).map((tp, i) => (
                            <tr
                              key={tp.id}
                              className={
                                i < selected.tagesordnung.length - 1
                                  ? 'border-b border-slate-50'
                                  : ''
                              }
                            >
                              <td className="px-4 py-3 text-slate-500 font-medium">
                                {tp.nr}
                              </td>
                              <td className="px-4 py-3 text-slate-800">{tp.bezeichnung}</td>
                              <td className="px-4 py-3 text-slate-600">{tp.zustaendig}</td>
                              <td className="px-4 py-3 text-slate-500 text-xs">
                                {tp.unterlagen}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        ) : (
          !showNewForm && (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3">
              <ClipboardList size={36} className="opacity-30" />
              <p className="text-sm">
                {sitzungen.length === 0
                  ? 'Noch keine Sitzungen vorhanden'
                  : 'Sitzung auswählen'}
              </p>
              {!isGast && sitzungen.length === 0 && (
                <button
                  onClick={() => setShowNewForm(true)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-white text-sm font-medium mt-1"
                  style={{ backgroundColor: 'var(--htv-blue)' }}
                >
                  <Plus size={14} />
                  Erste Sitzung anlegen
                </button>
              )}
            </div>
          )
        )}
      </div>
      </div>
    </div>
  )
}
