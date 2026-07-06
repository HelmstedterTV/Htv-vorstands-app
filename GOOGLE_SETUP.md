# Google Kalender Einrichtung

## Einmalige Einrichtung (ca. 10 Minuten)

### 1. Google Cloud Projekt öffnen

→ https://console.cloud.google.com/

Falls noch kein HTV-Projekt vorhanden: **„Projekt erstellen"** → Name z.B. `htv-vorstands-app`

---

### 2. Google Calendar API aktivieren

1. Im linken Menü: **„APIs und Dienste"** → **„Bibliothek"**
2. Suche: `Google Calendar API`
3. Klick auf das Ergebnis → **„Aktivieren"**

---

### 3. OAuth-Zustimmungsbildschirm konfigurieren

1. **„APIs und Dienste"** → **„OAuth-Zustimmungsbildschirm"**
2. Nutzertyp: **Extern** → Erstellen
3. App-Name: `HTV Vorstands-App`
4. Support-E-Mail: `vorstand.htv@gmail.com`
5. **Speichern und weiter** (Scopes überspringen)
6. Testnutzer → E-Mail-Adresse `vorstand.htv@gmail.com` hinzufügen → **Speichern**

---

### 4. OAuth-Client-ID erstellen

1. **„APIs und Dienste"** → **„Anmeldedaten"**
2. Oben: **„+ Anmeldedaten erstellen"** → **„OAuth-Client-ID"**
3. Anwendungstyp: **Webanwendung**
4. Name: `HTV Vorstands-App`
5. **Autorisierte JavaScript-Ursprünge** → alle drei URLs eintragen:
   - `http://localhost:5173` (lokale Entwicklung)
   - `https://htv-vorstands-app.web.app` (Firebase Hosting – Haupt-URL)
   - `https://htv-vorstands-app.firebaseapp.com` (Firebase Hosting – alternative URL)
6. Klick auf **Erstellen**
7. Die angezeigte **Client-ID** kopieren (endet auf `.apps.googleusercontent.com`)

---

### 5. Client-ID in die App eintragen

Im Projektordner `Vorstands-App`:

1. Datei `.env.local` erstellen (falls nicht vorhanden):
```
VITE_GOOGLE_CLIENT_ID=DEINE_CLIENT_ID.apps.googleusercontent.com
```
2. Entwicklungsserver neu starten: `npm run dev`

---

## Funktionsweise in der App

- Im **Kalender** erscheint oben ein Button **„Google Kalender"**
- Beim ersten Klick öffnet sich ein Google-Login-Fenster
- Nach dem Einloggen (mit `vorstand.htv@gmail.com`) werden die Google-Kalender-Termine **grün** angezeigt
- App-Termine können mit dem **Upload-Symbol** (↑) in den Google Kalender exportiert werden
- Der Sync läuft immer für ±1 Monat um den aktuellen Monat

## Fehler „origin_mismatch" beheben

Wenn der Fehler **„Zugriff blockiert: Autorisierungsfehler – Fehler 400: origin_mismatch"** erscheint:

1. → https://console.cloud.google.com/ öffnen
2. **„APIs und Dienste"** → **„Anmeldedaten"**
3. Den vorhandenen OAuth-Client **„HTV Vorstands-App"** anklicken (Stift-Symbol)
4. Unter **„Autorisierte JavaScript-Ursprünge"** prüfen, ob folgende URLs eingetragen sind:
   - `https://htv-vorstands-app.web.app`
   - `https://htv-vorstands-app.firebaseapp.com`
5. Falls nicht: **„URI hinzufügen"** → URLs eintragen → **Speichern**
6. ⚠️ Google braucht bis zu 5 Minuten, bis die Änderung wirksam wird

> Die aktuelle Client-ID lautet: `466135932782-2fl4v22938ogmqij2t56n3c61e89b5co.apps.googleusercontent.com`

---

## Hinweise

- Der Zugriffs-Token läuft nach 1 Stunde ab → dann neu einloggen
- Wiederholende Termine werden von Google als einzelne Instanzen importiert
- Gäste sehen Google-Events nicht (keine Connect-Schaltfläche)
- Die App schreibt/löscht **nichts** im Google Kalender außer beim expliziten Exportieren
