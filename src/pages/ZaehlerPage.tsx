import { useEffect, useState } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'
import type { QuerySnapshot, QueryDocumentSnapshot, Timestamp } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../context/AuthContext'
import type { Ablesung, Zaehler, ZaehlerHistorie, ZaehlerVertrag } from '../types/zaehler'
import { seedZaehlerdaten } from '../utils/zaehlerSeed'
import Uebersicht from '../components/Zaehler/Uebersicht'
import Erfassung from '../components/Zaehler/Erfassung'
import SparteAnsicht from '../components/Zaehler/SparteAnsicht'
import Jahresvergleich from '../components/Zaehler/Jahresvergleich'
import { AlertTriangle, Database } from 'lucide-react'

type Reiter = 'uebersicht' | 'erfassen' | 'gas' | 'strom' | 'wasser' | 'jahre'

const reiter: { id: Reiter; label: string }[] = [
  { id: 'uebersicht', label: 'Übersicht' },
  { id: 'erfassen', label: 'Erfassen' },
  { id: 'gas', label: 'Gas' },
  { id: 'strom', label: 'Strom' },
  { id: 'wasser', label: 'Wasser' },
  { id: 'jahre', label: 'Jahresvergleich' },
]

export default function ZaehlerPage() {
  const { currentUser, userProfile } = useAuth()
  const [tab, setTab] = useState<Reiter>('uebersicht')
  const [zaehler, setZaehler] = useState<Zaehler[]>([])
  const [ablesungen, setAblesungen] = useState<Ablesung[]>([])
  const [vertraege, setVertraege] = useState<ZaehlerVertrag[]>([])
  const [historie, setHistorie] = useState<ZaehlerHistorie[]>([])
  const [laedt, setLaedt] = useState(true)
  const [importLaeuft, setImportLaeuft] = useState(false)
  const [meldung, setMeldung] = useState('')
  const [fehler, setFehler] = useState('')

  const istAdmin = userProfile?.role === 'admin'
  const darfSchreiben = userProfile?.role === 'admin' || userProfile?.role === 'vorstand'

  useEffect(() => {
    // Fehler nicht verschlucken: sonst bleibt die Seite bei "Daten werden geladen" stehen,
    // z.B. wenn die Firestore-Regeln für die Zähler-Collections noch nicht veröffentlicht sind.
    function beiFehler(e: Error) {
      setLaedt(false)
      const text = e.message ?? String(e)
      setFehler(
        text.includes('permission') || text.includes('insufficient')
          ? 'Zugriff verweigert. Die Firestore-Regeln für die Zähler-Collections sind noch nicht veröffentlicht. Bitte einmalig ausführen: npx firebase deploy --only firestore:rules'
          : `Daten konnten nicht geladen werden: ${text}`
      )
    }

    const stops = [
      onSnapshot(
        collection(db, 'zaehler'),
        (snap: QuerySnapshot) => {
          setZaehler(
            snap.docs.map((d: QueryDocumentSnapshot) => ({ id: d.id, ...d.data() }) as Zaehler)
          )
          setFehler('')
          setLaedt(false)
        },
        beiFehler
      ),
      onSnapshot(
        collection(db, 'zaehlerAblesungen'),
        (snap: QuerySnapshot) => {
          setAblesungen(
            snap.docs.map((d: QueryDocumentSnapshot) => {
              const data = d.data()
              return {
                id: d.id,
                ...data,
                erfasstAm: (data.erfasstAm as Timestamp)?.toDate() ?? new Date(),
                geaendertAm: (data.geaendertAm as Timestamp)?.toDate(),
              } as Ablesung
            })
          )
        },
        beiFehler
      ),
      onSnapshot(
        collection(db, 'zaehlerVertraege'),
        (snap: QuerySnapshot) => {
          setVertraege(
            snap.docs.map(
              (d: QueryDocumentSnapshot) => ({ id: d.id, ...d.data() }) as ZaehlerVertrag
            )
          )
        },
        beiFehler
      ),
      onSnapshot(
        collection(db, 'zaehlerHistorie'),
        (snap: QuerySnapshot) => {
          setHistorie(
            snap.docs.map(
              (d: QueryDocumentSnapshot) => ({ id: d.id, ...d.data() }) as ZaehlerHistorie
            )
          )
        },
        beiFehler
      ),
    ]
    return () => stops.forEach((s) => s())
  }, [])

  async function importieren() {
    if (!currentUser) return
    setImportLaeuft(true)
    try {
      const text = await seedZaehlerdaten(
        currentUser.uid,
        userProfile?.displayName ?? currentUser.email ?? 'Import'
      )
      setMeldung(text)
    } catch (e) {
      setMeldung(`Fehler beim Import: ${(e as Error).message}`)
    }
    setImportLaeuft(false)
  }

  const leer = !laedt && !fehler && zaehler.length === 0

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-4 py-5">
        <h1 className="text-xl font-semibold text-slate-800 mb-3">Zähler & Verbräuche</h1>

        {/* Reiter */}
        <div className="flex gap-1 overflow-x-auto pb-2 mb-3 -mx-1 px-1">
          {reiter.map((r) => (
            <button
              key={r.id}
              onClick={() => setTab(r.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                tab === r.id
                  ? 'text-white'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
              }`}
              style={tab === r.id ? { backgroundColor: 'var(--htv-blue)' } : undefined}
            >
              {r.label}
            </button>
          ))}
        </div>

        {laedt && <p className="text-sm text-slate-500">Daten werden geladen…</p>}

        {fehler && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4">
            <div className="flex items-start gap-2">
              <AlertTriangle size={18} className="text-red-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-red-900 mb-1">
                  Zählerdaten nicht verfügbar
                </p>
                <p className="text-xs text-red-800 leading-snug">{fehler}</p>
              </div>
            </div>
          </div>
        )}

        {leer && (
          <div className="bg-white rounded-xl border border-slate-200 p-5 text-center">
            <Database size={28} className="mx-auto text-slate-300 mb-2" />
            <p className="text-sm text-slate-600 mb-1 font-medium">Noch keine Zählerdaten</p>
            <p className="text-xs text-slate-500 mb-4">
              Einmalig die Stammdaten aus der Nebenkostenumlage-Tabelle und den Schlussrechnungen
              importieren: 11 Zähler, 4 Verträge und die Ablesungen ab Oktober 2024.
            </p>
            {istAdmin ? (
              <button
                onClick={importieren}
                disabled={importLaeuft}
                className="px-4 py-2.5 rounded-lg text-white text-sm font-semibold disabled:opacity-50"
                style={{ backgroundColor: 'var(--htv-blue)' }}
              >
                {importLaeuft ? 'Import läuft…' : 'Stammdaten importieren'}
              </button>
            ) : (
              <p className="text-xs text-slate-400">
                Der Import kann nur von einem Administrator gestartet werden.
              </p>
            )}
            {meldung && <p className="text-xs text-slate-600 mt-3">{meldung}</p>}
          </div>
        )}

        {!laedt && !leer && (
          <>
            {tab === 'uebersicht' && (
              <Uebersicht
                vertraege={vertraege}
                ablesungen={ablesungen}
                darfBearbeiten={darfSchreiben}
              />
            )}
            {tab === 'erfassen' && (
              <Erfassung
                zaehler={zaehler}
                ablesungen={ablesungen}
                uid={currentUser?.uid ?? ''}
                name={userProfile?.displayName ?? currentUser?.email ?? ''}
                darfSchreiben={darfSchreiben}
              />
            )}
            {(tab === 'gas' || tab === 'strom' || tab === 'wasser') && (
              <SparteAnsicht sparte={tab} zaehler={zaehler} ablesungen={ablesungen} />
            )}
            {tab === 'jahre' && (
              <Jahresvergleich
                historie={historie}
                vertraege={vertraege}
                ablesungen={ablesungen}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}
