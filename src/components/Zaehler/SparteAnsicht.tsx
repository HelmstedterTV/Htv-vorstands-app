import type { Ablesung, Zaehler, ZaehlerSparte } from '../../types/zaehler'
import { echteAblesungen, fmt, fmtDatum, jahresVerbrauch, tageZwischen } from '../../utils/zaehlerCalc'
import { QuelleBadge } from './Erfassung'

const balkenFarbe: Record<string, string> = { gas: '#854F0B', strom: '#185FA5', wasser: '#0F6E56' }

/**
 * Aufteilung nach Zählerrollen. Unterzähler werden vom übergeordneten Abrechnungszähler
 * abgezogen – nie addiert. Statistik-Zähler laufen über fremde Verträge und werden nur
 * nachrichtlich ausgewiesen.
 */
function aufteilung(zaehler: Zaehler[], ablesungen: Ablesung[], sparte: ZaehlerSparte) {
  const liste = zaehler.filter((z) => z.sparte === sparte)
  const werte: { label: string; wert: number; einheit: string }[] = []
  const wert = (z: Zaehler) => jahresVerbrauch(ablesungen, z.id) * (z.faktor ?? 1)
  const einheitVon = (z: Zaehler) => (z.faktor ? 'kWh' : z.einheit)

  for (const haupt of liste.filter((z) => z.rolle === 'abrechnung')) {
    const unter = liste.filter((z) => z.rolle === 'unterzaehler' && z.gehoertZu === haupt.id)
    const summeUnter = unter.reduce((s, u) => s + wert(u), 0)
    if (unter.length > 0) {
      werte.push({
        label: `${haupt.name.replace(/^(Gas|Strom|Wasser) /, '')} ohne Unterzähler`,
        wert: wert(haupt) - summeUnter,
        einheit: einheitVon(haupt),
      })
      for (const u of unter)
        werte.push({
          label: `${u.name.replace(/^(Gas|Strom|Wasser) /, '')} (Unterzähler)`,
          wert: wert(u),
          einheit: einheitVon(u),
        })
    } else {
      werte.push({
        label: haupt.name.replace(/^(Gas|Strom|Wasser) /, ''),
        wert: wert(haupt),
        einheit: einheitVon(haupt),
      })
    }
  }
  for (const s of liste.filter((z) => z.rolle === 'statistik'))
    werte.push({
      label: `${s.name.replace(/^(Gas|Strom|Wasser) /, '')} (Statistik, eigener Vertrag)`,
      wert: wert(s),
      einheit: einheitVon(s),
    })
  return werte
}

export default function SparteAnsicht({
  sparte,
  zaehler,
  ablesungen,
}: {
  sparte: ZaehlerSparte
  zaehler: Zaehler[]
  ablesungen: Ablesung[]
}) {
  const werte = aufteilung(zaehler, ablesungen, sparte)
  const max = Math.max(...werte.map((w) => w.wert), 1)
  const liste = zaehler.filter((z) => z.sparte === sparte).sort((a, b) => a.sort - b.sort)

  return (
    <div>
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-3">
        <h3 className="text-sm font-semibold text-slate-800 mb-2">
          Aufteilung (Durchschnitt pro Jahr über den erfassten Zeitraum, normiert)
        </h3>
        {werte.map((w) => (
          <div key={w.label} className="flex items-center gap-2 my-1 text-xs">
            <span className="w-36 text-right text-slate-500 flex-shrink-0 leading-tight">
              {w.label}
            </span>
            <div
              className="h-4 rounded"
              style={{
                width: `${Math.max(2, (w.wert / max) * 40)}%`,
                backgroundColor: balkenFarbe[sparte],
              }}
            />
            <span className="tabular-nums text-slate-600">
              {fmt(w.wert)} {w.einheit}
            </span>
          </div>
        ))}
        <p className="text-[11px] text-slate-400 mt-2 leading-snug">
          {sparte === 'gas' &&
            'Abgerechnet wird nur der Hauptzähler. Die Halle ist ein Unterzähler davon und wird abgezogen, nicht addiert. Die Gaststätte hat einen eigenen Vertrag.'}
          {sparte === 'wasser' &&
            'Abwasser wird nur auf den Hausverbrauch berechnet. Die Unterzähler dienen der Nebenkostenumlage (Gaststätte = kalt + warm).'}
          {sparte === 'strom' &&
            'Haus und Halle haben eigene Verträge. Der Pächter-Zähler läuft über einen fremden Vertrag und wird nur nachrichtlich geführt.'}
        </p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-800 mb-2">Letzte Ablesungen</h3>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-500">
              <th className="text-left font-semibold py-1 border-b-2 border-slate-200">Zähler</th>
              <th className="text-left font-semibold py-1 border-b-2 border-slate-200">Datum</th>
              <th className="text-right font-semibold py-1 border-b-2 border-slate-200">Stand</th>
              <th className="text-right font-semibold py-1 border-b-2 border-slate-200">Verbr.</th>
              <th className="text-right font-semibold py-1 border-b-2 border-slate-200">/Tag</th>
            </tr>
          </thead>
          <tbody>
            {liste.flatMap((z) => {
              const reihe = echteAblesungen(ablesungen, z.id).slice(-3)
              const alle = echteAblesungen(ablesungen, z.id)
              return reihe.map((e) => {
                const idx = alle.findIndex((x) => x.id === e.id)
                let verbrauch = '—'
                let proTag = '—'
                if (idx > 0) {
                  const d = tageZwischen(alle[idx - 1].datum, e.datum)
                  const v = e.stand - alle[idx - 1].stand
                  verbrauch = fmt(v)
                  proTag = d > 0 ? fmt(v / d, 1) : '—'
                }
                return (
                  <tr key={e.id} className="border-b border-slate-100">
                    <td className="py-1">
                      {z.name.replace(/^(Gas|Strom|Wasser) /, '')}
                      <QuelleBadge quelle={e.quelle} />
                    </td>
                    <td className="py-1">{fmtDatum(e.datum)}</td>
                    <td className="py-1 text-right tabular-nums">{fmt(e.stand)}</td>
                    <td className="py-1 text-right tabular-nums">{verbrauch}</td>
                    <td className="py-1 text-right tabular-nums">{proTag}</td>
                  </tr>
                )
              })
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
