# Travelpont Portal – Telepítési útmutató

Ez a lista a hiányzó, **kézzel elvégzendő** lépéseket sorolja fel — a kód
maga (WP REST API, Cloud Functions, frontend) már készen van.

## 1. WordPress Application Password létrehozása

1. Jelentkezz be a travelpont.hu WP adminba.
2. Felhasználók → a saját profilod → görgess az "Alkalmazásjelszavak" (Application Passwords) részhez.
3. Adj meg egy nevet (pl. `travelpont-portal`), majd "Új alkalmazásjelszó hozzáadása".
4. **Másold ki azonnal a megjelenő jelszót** (csak egyszer látszik) — ez lesz a `WP_APP_PASSWORD` secret.

## 2. Firebase projekt létrehozása

1. https://console.firebase.google.com → "Add project" → név: `travelpont-portal`.
2. A projektben válts **Blaze** (pay-as-you-go) csomagra — ez kell a Cloud Functions kimenő
   hívásaihoz (WP + OpenAI felé). A várható havi költség centekben mérhető ennél a
   forgalomnál.
3. Authentication → Sign-in method → **Email/Password** engedélyezése.
4. Authentication → Users → két felhasználó kézzel felvétele:
   - `ngabor.blelle@gmail.com`
   - `npetra0821@gmail.com`
   (adj meg nekik egy kezdő jelszót, amit ők az első belépéskor megváltoztathatnak).
5. Project settings → General → "Your apps" → Web app hozzáadása → másold ki a
   `firebaseConfig` objektumot, és illeszd be **`public/js/firebase-config.js`**-be
   a `TODO-...` helyekre.

## 3. Firebase CLI

```
npm install -g firebase-tools
firebase login
cd D:\travelpont-portal
firebase use travelpont-portal
cd functions
npm install
cd ..
```

## 4. Secret Manager – hitelesítő adatok

```
firebase functions:secrets:set WP_USERNAME
firebase functions:secrets:set WP_APP_PASSWORD
firebase functions:secrets:set OPENAI_API_KEY
```

(A `WP_USERNAME` a WP admin felhasználóneved, a `WP_APP_PASSWORD` az 1. pontban
generált jelszó — szóközök nélkül másold be, a Portal proxy automatikusan
base64-kódolja. Az `OPENAI_API_KEY` egy `sk-...`-vel kezdődő OpenAI API kulcs.)

## 5. Első deploy – Cloud Functions

```
firebase deploy --only functions
```

A terminál a végén kiírja a 4 function tényleges HTTPS URL-jét
(`generateContent`, `serverStatus`, `ajanlatProxy`, `uticelProxy`,
europe-west1 régió). Másold be ezeket **`public/js/api-config.js`**-be a
`TODO-...` helyekre.

## 6. Deploy – Hosting + Storage szabályok

```
firebase deploy --only hosting,storage
```

Ezután a Portal elérhető: `https://travelpont-portal.web.app`

## 7. Végponttól-végpontig ellenőrzés

Lásd a jóváhagyott terv "Verifikáció" szakaszát – röviden:
1. Bejelentkezés mindkét fiókkal.
2. Új Úticél létrehozása (szülő nélkül, pl. "Horvátország"), AI-szöveggel.
3. Gyerek Úticél létrehozása szülő-választással (pl. "Isztria" ← "Horvátország").
4. Kép feltöltés mindkét modulban.
5. Ajánlat létrehozása, Úticél-hozzárendeléssel.
6. Ellenőrzés a WP adminban és élesben (travelpont.hu).

## Helyi fejlesztés (Firebase Emulator)

```
firebase emulators:start --only functions,hosting
```

Ekkor a `public/js/api-config.js` automatikusan a `localhost` ágra vált
(`isLocal` detektálás), a Cloud Functions pedig `127.0.0.1:5001`-en futnak.
