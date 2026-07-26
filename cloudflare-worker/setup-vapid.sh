#!/bin/bash
# Erzeugt ein VAPID-Schlüsselpaar (für den direkten iOS-Web-Push) und setzt es:
#  - VITE_VAPID_PUBLIC  -> ../.env.local   (öffentlicher Schlüssel, für die App)
#  - VAPID_PUBLIC       -> Worker-Secret
#  - VAPID_PRIVATE      -> Worker-Secret   (privat, bleibt auf diesem Rechner)
#
# Danach: App neu bauen/deployen UND Worker deployen (siehe Ausgabe am Ende).
set -e
cd "$(dirname "$0")"

echo "→ Erzeuge VAPID-Schlüsselpaar und schreibe VITE_VAPID_PUBLIC in .env.local ..."
node -e '
const crypto=require("crypto"),fs=require("fs");
const kp=crypto.generateKeyPairSync("ec",{namedCurve:"prime256v1"});
const jwk=kp.privateKey.export({format:"jwk"});
const f=s=>Buffer.from(s,"base64url");
const pub=Buffer.concat([Buffer.from([4]),f(jwk.x),f(jwk.y)]).toString("base64url");
const priv=f(jwk.d).toString("base64url");
fs.writeFileSync(".vapid-tmp.json",JSON.stringify({pub,priv}));
const envPath="../.env.local";
let env=fs.existsSync(envPath)?fs.readFileSync(envPath,"utf8"):"";
env=env.split("\n").filter(l=>!l.startsWith("VITE_VAPID_PUBLIC=")).join("\n").replace(/\n+$/,"")+"\n";
env+="VITE_VAPID_PUBLIC="+pub+"\n";
fs.writeFileSync(envPath,env);
console.log("  Public Key:",pub);
'

PUB=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(".vapid-tmp.json")).pub)')
PRIV=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(".vapid-tmp.json")).priv)')

echo "→ Setze Worker-Secret VAPID_PUBLIC ..."
printf "%s" "$PUB" | npx wrangler secret put VAPID_PUBLIC
echo "→ Setze Worker-Secret VAPID_PRIVATE ..."
printf "%s" "$PRIV" | npx wrangler secret put VAPID_PRIVATE

rm -f .vapid-tmp.json

echo ""
echo "✓ VAPID-Schlüssel gesetzt (Worker-Secrets + .env.local)."
echo ""
echo "Jetzt deployen (Reihenfolge wichtig – App zuerst, damit der Public Key eingebaut wird):"
echo "  cd \"$(pwd)/..\" && npm run deploy"
echo "  cd \"$(pwd)\" && npx wrangler deploy"
