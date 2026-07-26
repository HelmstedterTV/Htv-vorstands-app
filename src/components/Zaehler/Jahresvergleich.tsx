import type { Ablesung, ZaehlerHistorie, ZaehlerVertrag } from '../../types/zaehler'
import { berechneVertrag, fmt } from '../../utils/zaehlerCalc'

const sparteLabel: Record<string, string> = { gas: 'Gas', strom: 'Strom', wasser: 'Wasser' }
const balkenFarbe: Record<string, string> = {
  gas: '#854F0B',
  strom: '#185FA5',
  wasser: '#0F6E56',
}

/**
 * Ordnet jeder Historien-Reihe die Prognose des laufenden Zeitraums zu.
 * Schlüssel: `${sparte}|${reihe}`
 */
function prognosenNachReihe(vertraege: ZaehlerVertrag[], ablesungen: Ablesung[]) {
  const map: Record<string, number> = {}
  for (const v of vertraege) {
    const a = berechneVertrag(v, ablesungen)
    if (v.sparte === 'gas') map['gas|Hauptzähler gesamt'] = a.prognose
    if (v.sparte === 'strom' && v.name.includes('Haus')) map['strom|Haus'] = a.prognose
    if (v.sparte === 'strom' && v.name.includes('Halle')) map['strom|Halle'] = a.prognose
    if (v.sparte === 'wasser') {
      map['wasser|Haus'] = a.hausPrognose ?? 0
      map['wasser|Platz'] = a.prognose - (a.hausPrognose ?? 0)
    }
  }
  return map
}

export default function Jahresvergleich({
  historie,
  vertraege,
  ablesungen,
}: {
  historie: ZaehlerHistorie[]
  vertraege: ZaehlerVertrag[]
  ablesungen: Ablesung[]
}) {
  const prognosen = prognosenNachReihe(vertraege, ablesungen)

  return (
    <div>
      {(['gas', 'strom', 'wasser'] as const).map((sparte) => {
        const eintraege = historie.filter((h) => h.sparte === sparte)
        if (eintraege.length === 0) return null
        const reihen = [...new Set(eintraege.map((h) => h.reihe))]
        const einheit = eintraege[0].einheit
        return (
          <div key={sparte} className="bg-white rounded-xl border border-slate-200 p-4 mb-3">
            <h3 className="text-sm font-semibold text-slate-800 mb-1">
              {sparteLabel[sparte]} ({einheit}/Jahr)
            </h3>
            {reihen.map((reihe) => {
              const werte = eintraege
                .filter((h) => h.reihe === reihe)
                .sort((a, b) => a.sort - b.sort)
              const prognose = prognosen[`${sparte}|${reihe}`]
              const max = Math.max(...werte.map((w) => w.wert), prognose ?? 0)
              const letzter = werte[werte.length - 1]?.wert ?? 0
              const abweichung = letzter > 0 && prognose ? (prognose - letzter) / letzter : 0
              return (
                <div key={reihe} className="mt-3">
                  <p className="text-xs font-semibold text-slate-600 mb-1">{reihe}</p>
                  {werte.map((w) => (
                    <div key={w.id} className="flex items-center gap-2 my-1 text-xs">
                      <span className="w-12 text-right text-slate-400 flex-shrink-0">
                        {w.periode}
                      </span>
                      <div
                        className="h-4 rounded"
                        style={{
                          width: `${Math.max(2, (w.wert / max) * 55)}%`,
                          backgroundColor: balkenFarbe[sparte],
                        }}
                      />
                      <span className="tabular-nums text-slate-600">{fmt(w.wert)}</span>
                    </div>
                  ))}
                  {prognose > 0 && (
                    <div className="flex items-center gap-2 my-1 text-xs">
                      <span
                        className="w-12 text-right font-semibold flex-shrink-0"
                        style={{ color: balkenFarbe[sparte] }}
                      >
                        lfd.*
                      </span>
                      <div
                        className="h-4 rounded"
                        style={{
                          width: `${Math.max(2, (prognose / max) * 55)}%`,
                          border: `1px solid ${balkenFarbe[sparte]}`,
                          background: `repeating-linear-gradient(45deg, ${balkenFarbe[sparte]}, ${balkenFarbe[sparte]} 4px, #fff 4px, #fff 8px)`,
                        }}
                      />
                      <span className="tabular-nums text-slate-600">
                        {fmt(prognose)}{' '}
                        <span
                          className={
                            abweichung > 0.05
                              ? 'text-red-600'
                              : abweichung < -0.05
                                ? 'text-emerald-700'
                                : 'text-slate-400'
                          }
                        >
                          ({abweichung >= 0 ? '+' : ''}
                          {fmt(abweichung * 100)} %)
                        </span>
                      </span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
      <p className="text-[11px] text-slate-400 leading-snug mb-2">
        Volle Balken = abgerechnete Verbräuche laut Schlussrechnungen bzw. Jahresübersichten
        (Perioden ungleich 365 Tage sind normiert). <b>lfd.*</b> schraffiert = Hochrechnung für den
        laufenden Abrechnungszeitraum, Prozentwert = Abweichung zum letzten abgerechneten Jahr.
      </p>
    </div>
  )
}
