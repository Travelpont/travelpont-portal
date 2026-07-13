# Szerkesztő widget-ikonok

Ide (a `public/icons/szerkeszto/` mappába) kerülnek a vászon-szerkesztő
widget-ikonjai, SVG formátumban (pl. az svgrepo.com-ról letöltve).

## Fájlnevek (pontosan így!)

| Fájlnév            | Widget         | Mit ábrázoljon (javaslat)                  |
|--------------------|----------------|--------------------------------------------|
| `kep.svg`          | Kép            | egyetlen kép/fotó keretben                 |
| `kep-szoveg.svg`   | Kép + szöveg   | kép és mellette szövegsorok                |
| `kep-sor.svg`      | Kép-sor        | 2-3 kép egymás mellett                     |
| `foto-mozaik.svg`  | Fotó-mozaik    | képrács / galéria (4-6 kis csempe)         |
| `kiemeles.svg`     | Kiemelés-doboz | villanykörte vagy info-buborék             |
| `cta-gomb.svg`     | CTA-gomb       | gomb / kurzor-kattintás                    |
| `gyik.svg`         | GYIK           | kérdőjel (buborékban)                      |
| `video.svg`        | YouTube-videó  | lejátszás-gomb / filmkocka                 |
| `terkep.svg`       | Térkép         | térkép / helyjelző tű                      |
| `ajanlat.svg`      | Ajánlat-kártya | jegy / árcédula / repülő                   |
| `uticel-ajanlo.svg`| Úticél-ajánló  | iránytű / útjelző tábla                    |

## Fontos tudnivalók

- Az ikonokat a felület **sziluettként** használja (CSS mask) és maga
  színezi: alapból világosszürke, hover/aktív állapotban arany. Ezért az
  SVG **színe teljesen mindegy** (fekete is jó) — csak a FORMÁJA számít.
- Egyszerű, tömör (filled vagy vastag vonalas) ikon mutat jól 22 px
  méretben; a túl vékony vonalas belevész.
- Négyzetes viewBox (pl. 24×24) az ideális.
- Amíg egy fájl hiányzik, a felület automatikusan a régi emojit mutatja
  helyette — tehát darabonként is feltölthetők.
- Feltöltés után `firebase deploy --only hosting` (vagy szólj Claude-nak),
  és a Portálon frissítés után már az új ikon látszik.
