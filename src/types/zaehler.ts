// Typen für das Zähler-Modul (Gas / Strom / Wasser)

export type ZaehlerSparte = 'gas' | 'strom' | 'wasser'

/**
 * abrechnung   = Grundlage der Versorgerrechnung, erzeugt Kosten
 * unterzaehler = sitzt hinter einem Abrechnungszähler, dient nur der Aufteilung (wird abgezogen)
 * statistik    = eigener Vertrag Dritter (Pächter), nur zur Information
 */
export type ZaehlerRolle = 'abrechnung' | 'unterzaehler' | 'statistik'

/**
 * A = eigene Ablesung
 * R = Kundenablesung laut Rechnung (echter Stand)
 * G = geschätzter/berechneter Stand laut Rechnung – wird angezeigt, zählt aber nicht im Verbrauch
 */
export type AblesungQuelle = 'A' | 'R' | 'G'

export interface Zaehler {
  id: string
  sparte: ZaehlerSparte
  name: string
  nummer: string
  einheit: string // 'm³' | 'kWh'
  rolle: ZaehlerRolle
  gehoertZu?: string // ID des übergeordneten Zählers (bei unterzaehler)
  faktor?: number // Umrechnung m³ → kWh (Gas)
  info?: string
  aktiv: boolean
  sort: number
}

export interface Ablesung {
  id: string
  zaehlerId: string
  datum: string // YYYY-MM-DD
  stand: number
  quelle: AblesungQuelle
  erfasstVon: string
  erfasstVonName: string
  erfasstAm: Date
  geaendertAm?: Date
  geaendertVonName?: string
  notiz?: string
}

export interface VertragSzenario {
  label: string
  /** Gas/Strom: Faktor auf die Hochrechnung. Wasser: Anteil der skalierten Vorjahres-Restsaison. */
  faktor: number
}

export interface ZaehlerVertrag {
  id: string
  sparte: ZaehlerSparte
  name: string
  versorger: string
  kontakt?: string
  /** Abrechnungszähler dieses Vertrags */
  zaehlerIds: string[]
  faktor?: number // Gas: m³ → kWh

  // ---- letzte Schlussrechnung ----
  vjVon: string
  vjBis: string
  vjVerbrauch: number
  vjEinheit: string
  vjKosten: number
  /** positiv = Guthaben, negativ = Nachzahlung */
  vjSaldo: number
  vjStartStaende: Record<string, number>
  vjEndStaende: Record<string, number>
  vjVerbrauchHaus?: number // Wasser
  vjVerbrauchPlatz?: number // Wasser

  // ---- laufender Abrechnungszeitraum ----
  lfdVon: string
  lfdBis: string

  // ---- Preise (brutto) ----
  arbeitspreis?: number // €/kWh bzw. €/m³
  trinkwasser?: number // €/m³
  abwasser?: number // €/m³
  grundpreis: number // €/Jahr
  abschlag: number // € je Zahlungstermin
  zahlungenProJahr: number
  abschlagAb?: string
  puffer: number // z.B. 1.15

  // ---- Wasser-Spezifika ----
  wasser?: boolean
  plaetze?: number
  plaetzeVJ?: number

  szenarien: VertragSzenario[]
  hinweis?: string
}

/** Abgerechnete Jahreswerte für den Jahresvergleich */
export interface ZaehlerHistorie {
  id: string
  sparte: ZaehlerSparte
  reihe: string // z.B. 'Halle', 'Haus', 'Platz'
  periode: string // z.B. '23/24'
  wert: number
  einheit: string
  sort: number
}

/** Ergebnis der Hochrechnung eines Vertrags */
export interface VertragAuswertung {
  heute: string
  tage: number
  pTage: number
  seitVerbrauch: number
  seitText: string
  vjFensterText: string
  anteil: number
  prognose: number
  prognoseText: string
  kosten: number
  soll: number
  diff: number
  ampel: 'gruen' | 'gelb' | 'rot'
  szenarien: { label: string; menge: number; kosten: number; soll: number }[]
  // Wasser
  hausPrognose?: number
  platzSeit?: number
  restVJ?: number
  restSkaliert?: number
}
