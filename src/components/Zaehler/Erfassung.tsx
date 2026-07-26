import { useMemo, useState } from 'react'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore'
import { db } from '../../firebase/config'
import type { Ablesung, AblesungQuelle, Zaehler } from '../../types/zaehler'
import {
  echteAblesungen,
  fmt,
  fmtDatum,
  letzteAblesung,
  mittelProTag,
  tageZwischen,
} from '../../utils/zaehlerCalc'
import { Camera, Pencil, Trash2 } from 'lucide-react'

const sparteLabel: Record<string, string> = { gas: 'Gas', strom: 'Strom', wasser: 'Wasser' }
const sparteBadge: Record<string, string> = {
  gas: 'bg-amber-100 text-amber-800',
  strom: 'bg-blue-100 text-blue-800',
  wasser: 'bg-emerald-100 text-emerald-800',
}

export function QuelleBadge({ quelle }: { quelle: AblesungQuelle }) {
  if (quelle === 'R')
    return (
      <span
        title="Kundenablesung laut Rechnung"
        className="ml-1 inline-block text-[10px] px-1.5 py-0.5 rounded-full bg-blue-600 text-white align-middle"
      >
        R
      </span>
    )
  if (quelle === 'G')
    return (
      <span
        title="Geschätzter Stand laut Rechnung – zählt nicht im Verbrauch"
        className="ml-1 inline-block text-[10px] px-1.5 py-0.5 rounded-full bg-slate-400 text-white align-middle"
      >
        G
      </span>
    )
  return null
}

export default function Erfassung({
  zaehler,
  ablesungen,
  uid,
  name,
  darfSchreiben,
}: {
  zaehler: Zaehler[]
  ablesungen: Ablesung[]
  uid: string
  name: string
  darfSchreiben: boolean
}) {
  const [gewaehlt, setGewaehlt] = useState<string | null>(null)
  const [bearbeite, setBearbeite] = useState<Ablesung | null>(null)
  const [stand, setStand] = useState('')
  const [datum, setDatum] = useState(new Date().toISOString().slice(0, 10))
  const [quelle, setQuelle] = useState<AblesungQuelle>('A')
  const [notiz, setNotiz] = useState('')
  const [speichert, setSpeichert] = useState(false)

  const aktiverZaehler = zaehler.find((z) => z.id === gewaehlt) ?? null

  function formOeffnen(z: Zaehler, eintrag?: Ablesung) {
    setGewaehlt(z.id)
    setBearbeite(eintrag ?? null)
    setStand(eintrag ? String(eintrag.stand) : '')
    setDatum(eintrag ? eintrag.datum : new Date().toISOString().slice(0, 10))
    setQuelle(eintrag ? eintrag.quelle : 'A')
    setNotiz(eintrag?.notiz ?? '')
  }
  function formSchliessen() {
    setGewaehlt(null)
    setBearbeite(null)
    setStand('')
    setNotiz('')
  }

  // Plausibilitätsprüfung
  const pruefung = useMemo(() => {
    if (!aktiverZaehler || bearbeite) return null
    const wert = parseFloat(stand.replace(',', '.'))
    if (isNaN(wert)) return null
    const letzte = letzteAblesung(ablesungen, aktiverZaehler.id)
    if (!letzte) return { art: 'ok' as const, text: 'Erste Ablesung für diesen Zähler.' }
    if (wert < letzte.stand)
      return {
        art: 'warn' as const,
        text: `Stand ist kleiner als der letzte (${fmt(letzte.stand)}). Zahlendreher – oder Zählerwechsel?`,
      }
    const d = tageZwischen(letzte.datum, datum)
    if (d <= 0) return { art: 'warn' as const, text: 'Datum liegt vor der letzten Ablesung.' }
    const proTag = (wert - letzte.stand) / d
    const mittel = mittelProTag(ablesungen, aktiverZaehler.id)
    if (mittel > 0 && proTag > mittel * 2.5)
      return {
        art: 'hint' as const,
        text: `${fmt(proTag, 1)} ${aktiverZaehler.einheit}/Tag – deutlich über dem Mittel (${fmt(
          mittel,
          1
        )}/Tag). Bitte Stand prüfen, Speichern ist möglich.`,
      }
    if (mittel > 0 && proTag < mittel * 0.2 && wert - letzte.stand > 0)
      return {
        art: 'hint' as const,
        text: `Ungewöhnlich niedriger Verbrauch (${fmt(proTag, 1)} ${aktiverZaehler.einheit}/Tag).`,
      }
    return {
      art: 'ok' as const,
      text: `Plausibel: ${fmt(wert - letzte.stand)} ${aktiverZaehler.einheit} in ${d} Tagen (${fmt(
        proTag,
        1
      )}/Tag).`,
    }
  }, [aktiverZaehler, ablesungen, stand, datum, bearbeite])

  async function speichern() {
    if (!aktiverZaehler) return
    const wert = parseFloat(stand.replace(',', '.'))
    if (isNaN(wert) || !datum) {
      alert('Bitte Zählerstand und Datum prüfen.')
      return
    }
    setSpeichert(true)
    if (bearbeite) {
      await updateDoc(doc(db, 'zaehlerAblesungen', bearbeite.id), {
        stand: wert,
        datum,
        notiz,
        geaendertAm: serverTimestamp(),
        geaendertVonName: name,
      })
    } else {
      await addDoc(collection(db, 'zaehlerAblesungen'), {
        zaehlerId: aktiverZaehler.id,
        datum,
        stand: wert,
        quelle,
        notiz,
        erfasstVon: uid,
        erfasstVonName: name,
        erfasstAm: serverTimestamp(),
      })
    }
    setSpeichert(false)
    formSchliessen()
  }

  async function loeschen(eintrag: Ablesung) {
    if (!confirm(`Ablesung vom ${fmtDatum(eintrag.datum)} wirklich löschen?`)) return
    await deleteDoc(doc(db, 'zaehlerAblesungen', eintrag.id))
  }

  const letzteEintraege = aktiverZaehler
    ? ablesungen
        .filter((a) => a.zaehlerId === aktiverZaehler.id)
        .sort((a, b) => b.datum.localeCompare(a.datum))
        .slice(0, 5)
    : []

  return (
    <div>
      {/* Zählerliste */}
      <div className="bg-white rounded-xl border border-slate-200 p-3 mb-3">
        {(['gas', 'strom', 'wasser'] as const).map((sparte) => (
          <div key={sparte}>
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mt-3 mb-1">
              {sparteLabel[sparte]}
            </h3>
            {zaehler
              .filter((z) => z.sparte === sparte)
              .sort((a, b) => a.sort - b.sort)
              .map((z) => {
                const letzte = letzteAblesung(ablesungen, z.id)
                return (
                  <button
                    key={z.id}
                    onClick={() => formOeffnen(z)}
                    className="w-full flex items-center justify-between gap-2 py-2.5 px-1 border-b border-slate-100 last:border-0 hover:bg-slate-50 text-left"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                        <span className="truncate">{z.name}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${sparteBadge[sparte]}`}>
                          {z.rolle === 'unterzaehler'
                            ? 'Unterzähler'
                            : z.rolle === 'statistik'
                              ? 'Statistik'
                              : 'Abrechnung'}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">
                        Nr. {z.nummer}
                        {z.info ? ` · ${z.info}` : ''}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-sm font-semibold text-slate-800 tabular-nums">
                        {letzte ? `${fmt(letzte.stand)} ${z.einheit}` : '—'}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {letzte ? fmtDatum(letzte.datum) : 'keine Ablesung'}
                      </div>
                    </div>
                  </button>
                )
              })}
          </div>
        ))}
      </div>

      {/* Formular */}
      {aktiverZaehler && darfSchreiben && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 mb-3">
          <h3 className="text-sm font-semibold text-slate-800">
            {bearbeite ? 'Eintrag ändern: ' : ''}
            {aktiverZaehler.name}
          </h3>
          <p className="text-[11px] text-slate-500 mb-2">Nr. {aktiverZaehler.nummer}</p>
          {bearbeite && (
            <p className="text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-3 py-2 mb-2">
              Bearbeitungsmodus – die Änderung wird mit Name und Zeitpunkt protokolliert.
            </p>
          )}

          <label className="block text-xs text-slate-500">
            Zählerstand ({aktiverZaehler.einheit})
            <input
              autoFocus
              type="number"
              inputMode="decimal"
              value={stand}
              onChange={(e) => setStand(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-3 text-lg mt-1"
            />
          </label>
          <label className="block text-xs text-slate-500 mt-2">
            Ablesedatum
            <input
              type="date"
              value={datum}
              onChange={(e) => setDatum(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1"
            />
          </label>
          {!bearbeite && (
            <label className="block text-xs text-slate-500 mt-2">
              Quelle
              <select
                value={quelle}
                onChange={(e) => setQuelle(e.target.value as AblesungQuelle)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1 bg-white"
              >
                <option value="A">Eigene Ablesung</option>
                <option value="R">Kundenablesung laut Rechnung (R)</option>
                <option value="G">Geschätzter Stand laut Rechnung (G) – zählt nicht im Verbrauch</option>
              </select>
            </label>
          )}
          <label className="block text-xs text-slate-500 mt-2">
            Notiz (optional)
            <input
              value={notiz}
              onChange={(e) => setNotiz(e.target.value)}
              placeholder="z. B. Zählerwechsel, Rechnungsnummer"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1"
            />
          </label>

          {pruefung && (
            <p
              className={`text-xs rounded-lg px-3 py-2 mt-2 border ${
                pruefung.art === 'warn'
                  ? 'bg-red-50 border-red-200 text-red-800'
                  : pruefung.art === 'hint'
                    ? 'bg-amber-50 border-amber-200 text-amber-900'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-800'
              }`}
            >
              {pruefung.text}
            </p>
          )}

          <div className="flex gap-2 mt-3">
            <button
              onClick={speichern}
              disabled={speichert}
              className="px-4 py-2.5 rounded-lg text-white text-sm font-semibold disabled:opacity-50"
              style={{ backgroundColor: 'var(--htv-blue)' }}
            >
              {speichert ? 'Speichert…' : bearbeite ? 'Änderung speichern' : 'Speichern'}
            </button>
            <button onClick={formSchliessen} className="px-4 py-2.5 text-sm text-slate-600">
              Abbrechen
            </button>
          </div>
          <p className="text-[11px] text-slate-400 flex items-center gap-1 mt-2">
            <Camera size={12} /> Foto vom Zähler als Beleg: geplant für eine spätere Version.
          </p>

          {/* Letzte Einträge mit Korrekturmöglichkeit */}
          <h4 className="text-xs font-semibold text-slate-600 mt-4 mb-1">Letzte Einträge</h4>
          {letzteEintraege.map((e) => (
            <div
              key={e.id}
              className="flex items-center justify-between gap-2 py-1.5 border-b border-slate-100 last:border-0"
            >
              <div className="text-xs text-slate-600">
                {fmtDatum(e.datum)} —{' '}
                <b className="tabular-nums">
                  {fmt(e.stand)} {aktiverZaehler.einheit}
                </b>
                <QuelleBadge quelle={e.quelle} />
                {e.geaendertVonName && (
                  <span className="text-slate-400"> · geändert von {e.geaendertVonName}</span>
                )}
              </div>
              {e.quelle === 'A' ? (
                <div className="flex gap-1 flex-shrink-0">
                  <button
                    onClick={() => formOeffnen(aktiverZaehler, e)}
                    className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                    title="Ändern"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    onClick={() => loeschen(e)}
                    className="p-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50"
                    title="Löschen"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ) : (
                <span className="text-[11px] text-slate-400 flex-shrink-0">aus Rechnung</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Letzte Erfassungen gesamt */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-800 mb-2">Letzte Erfassungen</h3>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-500">
              <th className="text-left font-semibold py-1 border-b-2 border-slate-200">Datum</th>
              <th className="text-left font-semibold py-1 border-b-2 border-slate-200">Zähler</th>
              <th className="text-right font-semibold py-1 border-b-2 border-slate-200">Stand</th>
              <th className="text-right font-semibold py-1 border-b-2 border-slate-200">Verbrauch</th>
              <th className="text-left font-semibold py-1 border-b-2 border-slate-200 pl-2">Von</th>
            </tr>
          </thead>
          <tbody>
            {ablesungen
              .slice()
              .sort((a, b) => b.datum.localeCompare(a.datum))
              .slice(0, 12)
              .map((e) => {
                const z = zaehler.find((x) => x.id === e.zaehlerId)
                let verbrauch = '—'
                if (z && e.quelle !== 'G') {
                  const reihe = echteAblesungen(ablesungen, z.id)
                  const idx = reihe.findIndex((x) => x.id === e.id)
                  if (idx > 0) verbrauch = `${fmt(e.stand - reihe[idx - 1].stand)} ${z.einheit}`
                }
                return (
                  <tr key={e.id} className="border-b border-slate-100">
                    <td className="py-1">{fmtDatum(e.datum)}</td>
                    <td className="py-1">
                      {z?.name ?? e.zaehlerId}
                      <QuelleBadge quelle={e.quelle} />
                    </td>
                    <td className="py-1 text-right tabular-nums">{fmt(e.stand)}</td>
                    <td className="py-1 text-right tabular-nums">{verbrauch}</td>
                    <td className="py-1 pl-2 text-slate-500">{e.erfasstVonName?.split(' ')[0]}</td>
                  </tr>
                )
              })}
          </tbody>
        </table>
        <p className="text-[11px] text-slate-400 mt-2">
          R = Kundenablesung laut Rechnung · G = geschätzter Stand laut Rechnung (fließt nicht in die
          Verbrauchsberechnung ein). Rechnungsstände sind nicht änderbar.
        </p>
      </div>
    </div>
  )
}
