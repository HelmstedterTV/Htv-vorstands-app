// Rechenkern des Zähler-Moduls.
// Grundsatz: Es wird ausschließlich mit gemessenen Werten gerechnet.
// Geschätzte Stände aus Rechnungen (Quelle 'G') bleiben außen vor.

import type { Ablesung, VertragAuswertung, ZaehlerVertrag } from '../types/zaehler'

export const fmt = (n: number, d = 0) =>
  n.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d })

export const fmtDatum = (s: string) => {
  if (!s) return ''
  const [y, m, t] = s.split('-')
  return `${t}.${m}.${y.slice(2)}`
}

export const tageZwischen = (a: string, b: string) =>
  Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000)

export function plusTage(s: string, n: number) {
  const d = new Date(s)
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Nur echte Ablesungen (eigene + Kundenablesung lt. Rechnung), chronologisch */
export function echteAblesungen(alle: Ablesung[], zaehlerId: string): Ablesung[] {
  return alle
    .filter((a) => a.zaehlerId === zaehlerId && a.quelle !== 'G')
    .sort((a, b) => a.datum.localeCompare(b.datum))
}

export function letzteAblesung(alle: Ablesung[], zaehlerId: string): Ablesung | undefined {
  const r = echteAblesungen(alle, zaehlerId)
  return r[r.length - 1]
}

/** Zählerstand zu einem beliebigen Datum, linear interpoliert zwischen echten Ablesungen */
export function standAm(alle: Ablesung[], zaehlerId: string, datum: string): number {
  const r = echteAblesungen(alle, zaehlerId)
  if (r.length === 0) return 0
  if (datum <= r[0].datum) return r[0].stand
  for (let i = 1; i < r.length; i++) {
    if (r[i].datum >= datum) {
      const spanne = tageZwischen(r[i - 1].datum, r[i].datum)
      const versatz = tageZwischen(r[i - 1].datum, datum)
      return r[i - 1].stand + (r[i].stand - r[i - 1].stand) * (spanne > 0 ? versatz / spanne : 0)
    }
  }
  return r[r.length - 1].stand
}

/** Verbrauch je Tag im Mittel über alle erfassten Ablesungen (für Plausibilitätsprüfung) */
export function mittelProTag(alle: Ablesung[], zaehlerId: string): number {
  const r = echteAblesungen(alle, zaehlerId)
  if (r.length < 2) return 0
  const d = tageZwischen(r[0].datum, r[r.length - 1].datum)
  return d > 0 ? (r[r.length - 1].stand - r[0].stand) / d : 0
}

/**
 * Hochrechnung für den laufenden Abrechnungszeitraum.
 *
 * Anker ist immer die letzte Schlussrechnung. Der Verbrauch seitdem wird durch den Anteil
 * geteilt, den das Vorjahr im exakt gleichen Zeitfenster hatte (Saisonbereinigung).
 * Ist das Fenster zu kurz für eine belastbare Aussage, wird linear auf 365 Tage gerechnet.
 *
 * Wasser: Haus und Platzbewässerung werden getrennt geführt. Für die Bewässerung zählt
 * ausschließlich das messbare Frischwasser am Gartenzähler; die Zisterne ist nicht messbar
 * und wird deshalb nicht geschätzt.
 */
export function berechneVertrag(v: ZaehlerVertrag, ablesungen: Ablesung[]): VertragAuswertung {
  const stichtage = v.zaehlerIds
    .map((id) => letzteAblesung(ablesungen, id)?.datum)
    .filter((d): d is string => !!d)
    .sort()
  const heute = stichtage[stichtage.length - 1] ?? v.vjBis
  const tage = Math.max(tageZwischen(v.vjBis, heute), 0)
  const vjFenster = plusTage(v.vjVon, tage) // gleiches Zeitfenster im Vorjahr
  const pTage = tageZwischen(v.lfdVon, v.lfdBis) + 1
  const f = v.faktor ?? 1

  if (v.wasser) {
    const hausId = v.zaehlerIds[0]
    const gartenId = v.zaehlerIds[1]
    const hausSeit =
      standAm(ablesungen, hausId, heute) -
      v.vjEndStaende[hausId] -
      (standAm(ablesungen, gartenId, heute) - v.vjEndStaende[gartenId])
    const platzSeit = standAm(ablesungen, gartenId, heute) - v.vjEndStaende[gartenId]
    const hausFenster =
      standAm(ablesungen, hausId, vjFenster) -
      v.vjStartStaende[hausId] -
      (standAm(ablesungen, gartenId, vjFenster) - v.vjStartStaende[gartenId])
    const basis = v.vjVerbrauchHaus ?? 0
    const anteil = basis > 0 ? hausFenster / basis : 0
    const hausPrognose = anteil > 0.15 ? hausSeit / anteil : (hausSeit * 365) / Math.max(tage, 1)

    // Referenz Bewässerung: Frischwasser-Zukauf des Vorjahres in der noch offenen Restsaison,
    // skaliert auf die Zahl aktuell bewässerter Plätze.
    const restVJ = v.vjEndStaende[gartenId] - standAm(ablesungen, gartenId, vjFenster)
    const restSkaliert = restVJ * ((v.plaetze ?? 1) / (v.plaetzeVJ ?? 1))

    const szenarien = v.szenarien.map((s) => {
      const platz = platzSeit + restSkaliert * s.faktor
      const menge = hausPrognose + platz
      const kosten =
        menge * (v.trinkwasser ?? 0) + hausPrognose * (v.abwasser ?? 0) + v.grundpreis
      return {
        label: `${s.label} → ${fmt(platz)} m³ Zukauf`,
        menge,
        kosten,
        soll: (kosten * v.puffer) / v.zahlungenProJahr,
      }
    })
    const basisSzenario = szenarien[Math.min(1, szenarien.length - 1)]
    const soll = basisSzenario.soll
    const diff = soll > 0 ? (v.abschlag - soll) / soll : 0

    return {
      heute,
      tage,
      pTage,
      seitVerbrauch: hausSeit,
      seitText: `${fmt(hausSeit)} m³ Haus + ${fmt(platzSeit)} m³ Platz`,
      vjFensterText: `${fmt(hausFenster)} m³ Haus`,
      anteil,
      prognose: basisSzenario.menge,
      prognoseText: `${fmt(basisSzenario.menge)} m³ (${fmt(hausPrognose)} Haus + ${fmt(
        basisSzenario.menge - hausPrognose
      )} Platz)`,
      kosten: basisSzenario.kosten,
      soll,
      diff,
      ampel: Math.abs(diff) > 0.25 ? 'rot' : Math.abs(diff) > 0.1 ? 'gelb' : 'gruen',
      szenarien,
      hausPrognose,
      platzSeit,
      restVJ,
      restSkaliert,
    }
  }

  let seit = 0
  let fenster = 0
  for (const id of v.zaehlerIds) {
    seit += (standAm(ablesungen, id, heute) - v.vjEndStaende[id]) * f
    fenster += (standAm(ablesungen, id, vjFenster) - v.vjStartStaende[id]) * f
  }
  const anteil = v.vjVerbrauch > 0 ? fenster / v.vjVerbrauch : 0
  const prognose = anteil > 0.15 ? seit / anteil : (seit * 365) / Math.max(tage, 1)

  const szenarien = v.szenarien.map((s) => {
    const menge = prognose * s.faktor
    const kosten = menge * (v.arbeitspreis ?? 0) + v.grundpreis
    return { label: s.label, menge, kosten, soll: (kosten * v.puffer) / v.zahlungenProJahr }
  })
  const basisSzenario = szenarien.find((s) => Math.abs(s.menge - prognose) < 0.01) ?? szenarien[0]
  const soll = basisSzenario.soll
  const diff = soll > 0 ? (v.abschlag - soll) / soll : 0

  return {
    heute,
    tage,
    pTage,
    seitVerbrauch: seit,
    seitText: `${fmt(seit)} ${v.vjEinheit}`,
    vjFensterText: `${fmt(fenster)} ${v.vjEinheit}`,
    anteil,
    prognose,
    prognoseText: `${fmt(prognose)} ${v.vjEinheit}`,
    kosten: basisSzenario.kosten,
    soll,
    diff,
    ampel: Math.abs(diff) > 0.25 ? 'rot' : Math.abs(diff) > 0.1 ? 'gelb' : 'gruen',
    szenarien,
  }
}

/** Jahresverbrauch eines Zählers über den erfassten Zeitraum, normiert auf 365 Tage */
export function jahresVerbrauch(ablesungen: Ablesung[], zaehlerId: string): number {
  const r = echteAblesungen(ablesungen, zaehlerId)
  if (r.length < 2) return 0
  const d = tageZwischen(r[0].datum, r[r.length - 1].datum)
  return d > 0 ? ((r[r.length - 1].stand - r[0].stand) * 365) / d : 0
}
