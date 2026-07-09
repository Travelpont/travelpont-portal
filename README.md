# Travelpont Portal

Vizuális, WP admin nélküli tartalomkezelő a travelpont.hu Ajánlatok és
Úticélok szerkesztéséhez — az [aktivbalaton-portal](https://github.com/)
mintájára épült (vanilla HTML/JS + Firebase), a Travelpont márkaszíneivel.

## Architektúra

A böngésző sosem hívja közvetlenül a WordPress REST API-t. A Firebase Cloud
Functions proxy-réteg (`functions/index.js`) Secret Managerből olvasott WP
Application Password-del (Basic Auth) hívja a travelpont.hu `tpa/v1`
(Ajánlatok) és `tpu/v1` (Úticélok) végpontjait — ezeket a
`travelpont-ajanlatok`/`travelpont-uticelok` WP plugin implementálja
(lásd ott az `includes/rest-api.php` fájlokat).

- **Auth**: Firebase Auth (email/jelszó) + email-allowlist a Cloud Function oldalon.
- **Adat-igazságforrás**: WordPress — nincs Firestore-ban tartalom-duplikáció.
- **Képfeltöltés**: kliens → Firebase Storage → proxy → WP sideload (média könyvtár).
- **AI-segítség**: OpenAI (gpt-4o) proxy a `generateContent` function-ön át, a
  leírás-mezők melletti "✨ AI segítség" gombbal — a generált szöveg sosem
  ment automatikusan, mindig a felhasználó hagyja jóvá.

## Mappák

```
public/           ← Firebase Hosting (statikus fájlok, bundler nélkül)
  css/portal.css  ← közös design-rendszer
  js/             ← firebase-config, api-config, auth-guard, sidebar, ai-helper
  login.html, index.html, ajanlatok.html, uticelok.html
functions/        ← Cloud Functions (generateContent, serverStatus, ajanlatProxy, uticelProxy)
storage.rules     ← Firebase Storage biztonsági szabályok
```

## Telepítés

Lásd [DEPLOY.md](DEPLOY.md) — a Firebase-projekt létrehozása, Secret Manager
feltöltés és az első deploy lépésről lépésre.

## V1 hatókör

Ajánlatok + Úticélok CRUD, kiemelt kép feltöltés, hierarchikus szülő-választó
(Úticélok), AI-alapú szövegírás-segítség. **Nincs** benne (tudatos
egyszerűsítés): galéria (több kép/bejegyzés), törlés a Portálból (WP adminban
lehetséges), PWA/service worker, médiatár-böngésző, statisztikák.
