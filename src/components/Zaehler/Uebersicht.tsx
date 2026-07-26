import { useState } from 'react'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '../../firebase/config'
import type { Ablesung, ZaehlerVertrag } from '../../types/zaehler'
import { berechneVertrag, fmt, fmtDatum } from '../../utils/zaehlerCalc'
import { ChevronDown, ChevronUp, FileText } from 'lucide-react'

const sparteFarbe: Record<string, string> = {
  gas: 'text-amber-700',
  strom: 'text-blue-700',
  wasser: 'text-emerald-700',
}
const sparteLabel: Record<string, string> = { gas: 'Gas', strom: 'Strom', wasser: 'Wasser' }

const ampelStil: Record<string, string> = {
  gruen: 'bg-emerald-50 border-emerald-200 text-emerald-900',
  gelb: 'bg-amber-50 border-amber-200 text-amber-900',
  rot: 'bg-red-50 border-red-200 text-red-900',
}
const ampelPunkt: Record<string, string> = {
  gruen: 'bg-emerald-600',
  gelb: 'bg-amber-500',
  rot: 'bg-red-600',
}

function VertragKarte({
  vertrag,
  ablesungen,
  darfBearbeiten,
}: {
  vertrag: ZaehlerVertrag
  ablesungen: Ablesung[]
  darfBearbeiten: boolean
}) {
  const [offen, setOffen] = useState(false)
  const [speichert, setSpeichert] = useState(false)
  const [form, setForm] = useState({
    arbeitspreis: vertrag.arbeitspreis ?? 0,
    trinkwasser: vertrag.trinkwasser ?? 0,
    abwasser: vertrag.abwasser ?? 0,
    grundpreis: vertrag.grundpreis,
    abschlag: vertrag.abschlag,
  })

  const a = berechneVertrag(vertrag, ablesungen)
  const saldoText =
    vertrag.vjSaldo < 0
      ? `${fmt(-vertrag.vjSaldo, 2)} € Nachzahlung`
      : `${fmt(vertrag.vjSaldo, 2)} € Guthaben`
  const proText =
    vertrag.zahlungenProJahr === 12
      ? '€/Monat'
      : `€ je Termin (${vertrag.zahlungenProJahr}×/Jahr)`

  let ampelText = `Vorauszahlung passt: ${fmt(vertrag.abschlag)} € gegenüber empfohlen ${fmt(a.soll)} ${proText}.`
  if (a.ampel === 'rot')
    ampelText = `${a.diff < 0 ? 'Deutliche Nachzahlung absehbar' : 'Deutliches Guthaben absehbar'}: ${fmt(
      vertrag.abschlag
    )} € gegenüber empfohlen ${fmt(a.soll)} ${proText} – beim Versorger anpassen.`
  else if (a.ampel === 'gelb')
    ampelText = `Anpassung erwägen: ${fmt(vertrag.abschlag)} € gegenüber empfohlen ${fmt(a.soll)} ${proText}.`

  async function speichern() {
    setSpeichert(true)
    const daten: Record<string, number> = {
      grundpreis: Number(form.grundpreis),
      abschlag: Number(form.abschlag),
    }
    if (vertrag.wasser) {
      daten.trinkwasser = Number(form.trinkwasser)
      daten.abwasser = Number(form.abwasser)
    } else {
      daten.arbeitspreis = Number(form.arbeitspreis)
    }
    await updateDoc(doc(db, 'zaehlerVertraege', vertrag.id), daten)
    setSpeichert(false)
    setOffen(false)
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 mb-3">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <h3 className="font-semibold text-slate-800 text-sm">{vertrag.name}</h3>
          <p className="text-xs text-slate-500">{vertrag.kontakt}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="bg-slate-50 rounded-lg px-3 py-2">
          <div className="text-base font-bold text-slate-800">
            {fmt(vertrag.vjVerbrauch)} {vertrag.vjEinheit}
          </div>
          <div className="text-[11px] text-slate-500 leading-snug">
            <b>Letzte Abrechnung</b>
            <br />
            {fmtDatum(vertrag.vjVon)} – {fmtDatum(vertrag.vjBis)}
          </div>
        </div>
        <div className="bg-slate-50 rounded-lg px-3 py-2">
          <div className="text-base font-bold text-slate-800">{fmt(vertrag.vjKosten, 2)} €</div>
          <div className="text-[11px] text-slate-500 leading-snug">
            Kosten ·{' '}
            <span className={vertrag.vjSaldo < 0 ? 'text-red-600 font-semibold' : 'text-emerald-700 font-semibold'}>
              {saldoText}
            </span>
          </div>
        </div>
        <div className="bg-slate-50 rounded-lg px-3 py-2">
          <div className="text-base font-bold text-slate-800">{a.seitText}</div>
          <div className="text-[11px] text-slate-500 leading-snug">
            <b>Verbrauch seitdem</b>
            <br />
            {fmtDatum(vertrag.lfdVon)} – {fmtDatum(a.heute)} ({a.tage} von {a.pTage} Tagen)
            <br />
            Vorjahr im gleichen Fenster: {a.vjFensterText} ({fmt(a.anteil * 100)} %)
          </div>
        </div>
        <div className="bg-slate-50 rounded-lg px-3 py-2">
          <div className="text-base font-bold text-slate-800">{a.prognoseText}</div>
          <div className="text-[11px] text-slate-500 leading-snug">
            <b>Hochrechnung laufender Zeitraum</b>
            <br />
            {fmtDatum(vertrag.lfdVon)} – {fmtDatum(vertrag.lfdBis)} ≈ {fmt(a.kosten)} €
          </div>
        </div>
      </div>

      <div className={`flex items-start gap-3 rounded-lg border px-3 py-2 mt-3 ${ampelStil[a.ampel]}`}>
        <span className={`w-3 h-3 rounded-full mt-1 flex-shrink-0 ${ampelPunkt[a.ampel]}`} />
        <div className="text-xs leading-snug">
          <b>Vorauszahlung:</b> aktuell {fmt(vertrag.abschlag)} €
          {vertrag.abschlagAb ? ` (ab ${vertrag.abschlagAb})` : ''}. {ampelText}
        </div>
      </div>

      <table className="w-full text-xs mt-3">
        <thead>
          <tr className="text-slate-500">
            <th className="text-left font-semibold py-1 border-b-2 border-slate-200">Szenario</th>
            <th className="text-right font-semibold py-1 border-b-2 border-slate-200">{vertrag.vjEinheit}</th>
            <th className="text-right font-semibold py-1 border-b-2 border-slate-200">Kosten/Jahr</th>
            <th className="text-right font-semibold py-1 border-b-2 border-slate-200">Soll je Zahlung</th>
          </tr>
        </thead>
        <tbody>
          {a.szenarien.map((s) => (
            <tr key={s.label} className="border-b border-slate-100">
              <td className="py-1 pr-2">{s.label}</td>
              <td className="py-1 text-right tabular-nums">{fmt(s.menge)}</td>
              <td className="py-1 text-right tabular-nums">{fmt(s.kosten)} €</td>
              <td className="py-1 text-right tabular-nums font-medium">{fmt(s.soll)} €</td>
            </tr>
          ))}
        </tbody>
      </table>

      {vertrag.hinweis && (
        <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3">
          {vertrag.hinweis}
        </p>
      )}

      {darfBearbeiten && (
        <>
          <button
            onClick={() => setOffen((v) => !v)}
            className="flex items-center gap-1 text-xs mt-3 text-[color:var(--htv-blue)] font-medium"
          >
            {offen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            Preise & Vorauszahlung aus Schlussrechnung anpassen
          </button>
          {offen && (
            <div className="mt-2 space-y-2 border-t border-slate-100 pt-3">
              {vertrag.wasser ? (
                <>
                  <label className="block text-xs text-slate-500">
                    Trinkwasser brutto (€/m³)
                    <input
                      type="number"
                      step="0.0001"
                      value={form.trinkwasser}
                      onChange={(e) => setForm({ ...form, trinkwasser: Number(e.target.value) })}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1"
                    />
                  </label>
                  <label className="block text-xs text-slate-500">
                    Abwasser (€/m³)
                    <input
                      type="number"
                      step="0.01"
                      value={form.abwasser}
                      onChange={(e) => setForm({ ...form, abwasser: Number(e.target.value) })}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1"
                    />
                  </label>
                </>
              ) : (
                <label className="block text-xs text-slate-500">
                  Effektiver Arbeitspreis brutto inkl. Umlagen (€/{vertrag.vjEinheit})
                  <input
                    type="number"
                    step="0.0001"
                    value={form.arbeitspreis}
                    onChange={(e) => setForm({ ...form, arbeitspreis: Number(e.target.value) })}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1"
                  />
                </label>
              )}
              <label className="block text-xs text-slate-500">
                Grundpreise brutto (€/Jahr)
                <input
                  type="number"
                  step="0.01"
                  value={form.grundpreis}
                  onChange={(e) => setForm({ ...form, grundpreis: Number(e.target.value) })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1"
                />
              </label>
              <label className="block text-xs text-slate-500">
                Vorauszahlung (€ je Termin)
                <input
                  type="number"
                  step="1"
                  value={form.abschlag}
                  onChange={(e) => setForm({ ...form, abschlag: Number(e.target.value) })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1"
                />
              </label>
              <button
                onClick={speichern}
                disabled={speichert}
                className="px-4 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-50"
                style={{ backgroundColor: 'var(--htv-blue)' }}
              >
                {speichert ? 'Speichert…' : 'Übernehmen'}
              </button>
              <p className="text-[11px] text-slate-400 flex items-start gap-1">
                <FileText size={12} className="mt-0.5 flex-shrink-0" />
                Zählerstände aus Schlussrechnungen werden im Reiter „Erfassen" mit Quelle R
                (Kundenablesung) bzw. G (geschätzt) eingetragen.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default function Uebersicht({
  vertraege,
  ablesungen,
  darfBearbeiten,
}: {
  vertraege: ZaehlerVertrag[]
  ablesungen: Ablesung[]
  darfBearbeiten: boolean
}) {
  return (
    <div>
      {(['gas', 'strom', 'wasser'] as const).map((sparte) => {
        const liste = vertraege.filter((v) => v.sparte === sparte)
        if (liste.length === 0) return null
        return (
          <div key={sparte}>
            <h2 className={`text-sm font-semibold mt-4 mb-2 ${sparteFarbe[sparte]}`}>
              {sparteLabel[sparte]}
            </h2>
            {liste.map((v) => (
              <VertragKarte
                key={v.id}
                vertrag={v}
                ablesungen={ablesungen}
                darfBearbeiten={darfBearbeiten}
              />
            ))}
          </div>
        )
      })}
      <p className="text-[11px] text-slate-400 leading-snug mt-3 mb-2">
        Hochrechnung = Verbrauch seit der letzten Abrechnung geteilt durch den Anteil, den das
        Vorjahr im gleichen Zeitfenster hatte (saisonbereinigt). Beim Wasser wird die
        Platzbewässerung getrennt geführt: Referenz ist der Vorjahres-Zukauf am Gartenzähler in der
        noch offenen Restsaison, skaliert auf die Zahl bewässerter Plätze. Es zählt ausschließlich
        messbares Frischwasser.
      </p>
    </div>
  )
}
