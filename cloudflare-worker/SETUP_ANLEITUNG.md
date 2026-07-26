# Push-Benachrichtigungen einrichten – Schritt-für-Schritt (FCM)

## Übersicht

Die Lösung nutzt **Firebase Cloud Messaging (FCM)**. FCM übernimmt die komplette
Verschlüsselung der Push-Nachrichten – das war vorher selbst gebaut und fehlerhaft.

1. **App-Code** – holt über Firebase ein Geräte-Token und meldet es beim Worker an.
2. **Cloudflare Worker** – speichert die Tokens und ruft die FCM-API auf, um zu
   benachrichtigen. Bleibt kostenlos, keine Kreditkarte nötig.

Wichtig für iPhone/iPad: Die App muss über *Teilen → „Zum Home-Bildschirm"*
installiert und von dort geöffnet sein. Im normalen Safari-Tab gibt es auf iOS
grundsätzlich keine Push-Benachrichtigungen (iOS/iPadOS 16.4+ erforderlich).

---

## Schritt 1: FCM in Firebase aktivieren + Web-Push-Schlüssel holen

1. [Firebase Console](https://console.firebase.google.com/) → Projekt `htv-vorstands-app`
2. Zahnrad → **Projekteinstellungen** → Reiter **Cloud Messaging**
3. Abschnitt **Web Push certificates** → falls leer: **„Generate key pair"**
4. Den angezeigten Schlüssel (langer Base64-String) kopieren → das ist der
   `VITE_FCM_VAPID_KEY` (siehe Schritt 6).

---

## Schritt 2: Service-Account-Schlüssel erstellen (für den Worker)

1. Firebase Console → **Projekteinstellungen** → Reiter **Dienstkonten**
2. **„Neuen privaten Schlüssel generieren"** → eine JSON-Datei wird heruntergeladen.
3. Diese JSON enthält u.a. `project_id`, `client_email`, `private_key` – die
   brauchen wir gleich für die Worker-Secrets. **JSON sicher aufbewahren, nicht committen!**

---

## Schritt 3: Cloudflare-Account + KV Namespace

1. [cloudflare.com](https://cloudflare.com) → kostenlosen Account anlegen (keine Kreditkarte).
2. **Workers & Pages** → **KV** → „Create a namespace" → Name: `PUSH_SUBS`.
3. Namespace-ID notieren.

---

## Schritt 4: Worker anlegen

1. **Workers & Pages** → „Create application" → „Create Worker" → Name: `htv-push-worker` → „Deploy".
2. Den generierten Code löschen und den Inhalt von `worker.js` (aus diesem Ordner) einfügen → „Deploy".
3. **Settings** → **Variables** → **KV Namespace Bindings** → „Add binding":
   - Variable name: `PUSH_SUBS`
   - KV namespace: `PUSH_SUBS`

---

## Schritt 5: Secrets (Schlüssel) im Worker setzen

Im Worker: **Settings** → **Variables** → **Environment Variables** → jeweils
„Add variable" und als **Secret** markieren. Werte stammen aus der
Service-Account-JSON aus Schritt 2:

| Variable | Wert |
|---|---|
| `FIREBASE_PROJECT_ID` | `htv-vorstands-app` (Feld `project_id`) |
| `FIREBASE_CLIENT_EMAIL` | Feld `client_email` aus der JSON |
| `FIREBASE_PRIVATE_KEY` | Feld `private_key` aus der JSON – komplett inkl. `-----BEGIN PRIVATE KEY-----` … `-----END PRIVATE KEY-----`. Die `\n` aus der JSON können so übernommen werden. |
| `NOTIFY_SECRET` | Selbst gewähltes Passwort (z.B. `HTV-Push-2026`) |

→ „Save and deploy". Worker-URL oben notieren (z.B. `https://htv-push-worker.DEIN-NAME.workers.dev`).

---

## Schritt 6: .env.local in der App eintragen

Im Hauptordner der Vorstands-App (neben `package.json`):

```
VITE_FCM_VAPID_KEY=<Web-Push-Zertifikat aus Schritt 1>
VITE_WORKER_URL=https://htv-push-worker.DEIN-NAME.workers.dev
VITE_NOTIFY_SECRET=HTV-Push-2026
```

⚠️ `VITE_NOTIFY_SECRET` muss identisch zum `NOTIFY_SECRET` im Worker sein.

---

## Schritt 7: App deployen

```bash
cd ~/Claude/Projects/Vorstands-App && npm run deploy
```

---

## Schritt 8: Push aktivieren (jedes Vorstandsmitglied einmalig)

1. App **vom Home-Bildschirm-Icon** öffnen (nicht im Safari-Tab).
2. **Profil** → „Push-Benachrichtigungen aktivieren" → Dialog bestätigen.
3. Fertig – Benachrichtigungen kommen jetzt auch, wenn die App zu ist.

---

## Funktionsweise

```
Nutzer A schickt Nachricht
    ↓
App ruft Cloudflare Worker auf (/notify)
    ↓
Worker holt ein Google-Access-Token (Service-Account) und liest alle FCM-Tokens aus KV
    ↓
Worker ruft die FCM-API auf – FCM verschlüsselt und stellt zu (Apple/Google/Firefox)
    ↓
Service Worker zeigt Benachrichtigung + setzt Icon-Badge – auch wenn App zu ist
```

**Datenschutz:** Über den Worker läuft nur `Autorname + Kanalname`. Der eigentliche
Nachrichteninhalt bleibt in Firebase.

---

## Kosten

Cloudflare-Worker (Free-Tier) und FCM sind für dieses Volumen kostenlos.
Keine Kreditkarte nötig.

---

## Wenn es nicht funktioniert – Diagnose

- **`/notify` testen:** Antwortet der Worker mit `{"sent":N,"results":[...]}`? Steht
  dort `status: 200`, hat FCM die Nachricht angenommen. Bei `error` stimmt meist
  ein Secret nicht (Service-Account / Private-Key).
- **Token vorhanden?** Nach „Push aktivieren" sollte im KV ein Eintrag `sub_<uid>` stehen.
- **iOS:** App wirklich als Home-Screen-App geöffnet? iOS 16.4+? Erlaubnis erteilt?
