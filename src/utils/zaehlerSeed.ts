// Erstbefüllung des Zähler-Moduls in Firestore. Wird über den Button in der Zähler-Seite
// ausgelöst (nur Admin) und bricht ab, wenn bereits Zähler vorhanden sind.

import { collection, doc, getDocs, writeBatch, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase/config'
import { SEED_ABLESUNGEN, SEED_HISTORIE, SEED_VERTRAEGE, SEED_ZAEHLER } from './zaehlerSeedDaten'

/** Schreibt die Stammdaten. Bricht ab, wenn bereits Zähler vorhanden sind. */
export async function seedZaehlerdaten(uid: string, name: string): Promise<string> {
  const vorhanden = await getDocs(collection(db, 'zaehler'))
  if (!vorhanden.empty) return 'Es sind bereits Zähler angelegt – Import übersprungen.'

  let batch = writeBatch(db)
  let ops = 0
  const commitWennVoll = async () => {
    ops++
    if (ops >= 450) {
      await batch.commit()
      batch = writeBatch(db)
      ops = 0
    }
  }

  for (const z of SEED_ZAEHLER) {
    const { id, ...rest } = z
    batch.set(doc(db, 'zaehler', id), rest)
    await commitWennVoll()
  }
  for (const v of SEED_VERTRAEGE) {
    const { id, ...rest } = v
    batch.set(doc(db, 'zaehlerVertraege', id), rest)
    await commitWennVoll()
  }
  for (const h of SEED_HISTORIE) {
    const { id, ...rest } = h
    batch.set(doc(db, 'zaehlerHistorie', id), rest)
    await commitWennVoll()
  }
  let anzahl = 0
  for (const [zaehlerId, liste] of Object.entries(SEED_ABLESUNGEN)) {
    for (const [datum, stand, quelle] of liste) {
      batch.set(doc(collection(db, 'zaehlerAblesungen')), {
        zaehlerId,
        datum,
        stand,
        quelle: quelle ?? 'A',
        erfasstVon: uid,
        erfasstVonName: name,
        erfasstAm: serverTimestamp(),
        notiz: 'Import aus Nebenkostenumlage-Tabelle',
      })
      anzahl++
      await commitWennVoll()
    }
  }
  await batch.commit()
  return `Import abgeschlossen: ${SEED_ZAEHLER.length} Zähler, ${SEED_VERTRAEGE.length} Verträge, ${anzahl} Ablesungen.`
}
