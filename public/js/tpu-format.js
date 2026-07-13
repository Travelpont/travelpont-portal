// =====================================================
// tpu-format.js – A "Bemutató szöveg" tárolt HTML-formátumának közös kezelése
//
// A tárolt formátum SIMA HTML (visszafelé kompatibilis, a WP-oldal
// egyszerűsége miatt): szöveg-szakaszok + kép-jelölők
//     <img class="tpu-inline-kep" data-id="…" src="…" alt="…"
//          [data-meret="teljes|kicsi"]>
// és opcionálisan két csoportosító elem:
//     <div class="tpu-kep-szoveg tpu-kep-szoveg--bal|--jobb">
//         jelölő + <div class="tpu-kep-szoveg-torzs">szöveg-HTML</div>
//     </div>
//     <div class="tpu-galeria-sor"> 2-3 jelölő </div>
//     <div class="tpu-fotomozaik"></div>  ← helyjelző: ide kerül a szövegben
//         fel nem használt galéria-képek rácsa (a tartalmát a WP tölti ki)
//
// A WordPress-oldali plugin (travelpont-uticelok ≥1.17.0) ugyanezt a
// formátumot ismeri fel. A jelölő-felismerés MINDKÉT oldalon attribútum-
// sorrend-független: a tagre illesztünk, az attribútumot a talált tagen
// BELÜL keressük (a böngésző/Quill tetszőleges sorrendben szerializálhat).
//
// Ez a modul tisztán szöveg-műveleteket tartalmaz (nincs DOM, nincs Quill),
// ezért Node-tesztekkel közvetlenül ellenőrizhető.
// =====================================================

export function escapeHtml(s) {
    return (s ?? '').toString().replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

export function escapeAttr(s) {
    return (s ?? '').toString().replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// Mindig friss regexet adunk (a /g miatt a lastIndex állapotos lenne).
export function markerRe() {
    return /<img[^>]*\btpu-inline-kep\b[^>]*>/gi;
}

// Egy attribútum értéke a megtalált tagen belül (sorrend-független).
export function markerAttr(tag, name) {
    const m = tag.match(new RegExp(name + '="([^"]*)"', 'i'));
    return m ? m[1] : '';
}

// Igaz, ha a HTML-ben nincs látható tartalom (csak tagek/űr).
export function uresSzoveg(html) {
    return (html || '').replace(/<[^>]+>|&nbsp;|\s/g, '') === '';
}

const MERETEK = ['teljes', 'kicsi']; // '' (nincs attribútum) = normál

// Kép-jelölő szerializálása. kep: { id, url, felirat, meret }
export function markerHtml(kep) {
    const meret = MERETEK.includes(kep.meret) ? kep.meret : '';
    return `<img class="tpu-inline-kep" data-id="${escapeAttr(kep.id)}" src="${escapeAttr(kep.url)}" alt="${escapeAttr(kep.felirat || '')}"${meret ? ` data-meret="${meret}"` : ''}>`;
}

function kepAdat(tag) {
    return {
        id: markerAttr(tag, 'data-id'),
        url: markerAttr(tag, 'src'),
        felirat: markerAttr(tag, 'alt'),
        meret: markerAttr(tag, 'data-meret'),
    };
}

// Csoportosító elemek. A belső szöveg-tartalomban sosem fordul elő <div>
// (a Quill csak p/h/ul/ol/blockquote elemeket ír), ezért a kép+szöveg
// blokknál a jelölő-rész nem léphet át másik div-be, a lezárást pedig a
// legelső </div></div> ill. </div> adja.
const KEPSZOVEG_RE = /<div[^>]*class="[^"]*tpu-kep-szoveg[^"]*"[^>]*>((?:(?!<div)[\s\S])*?)<div[^>]*class="[^"]*tpu-kep-szoveg-torzs[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
const GALERIASOR_RE = /<div[^>]*class="[^"]*tpu-galeria-sor[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
// Fotó-mozaik helyjelző: a WP-oldal EZEN a ponton rajzolja ki a szövegben
// fel nem használt galéria-képek rácsát (üres div, tartalmát a WP adja).
const FOTOMOZAIK_RE = /<div[^>]*class="[^"]*tpu-fotomozaik[^"]*"[^>]*>\s*<\/div>/gi;

// Tartalmi widgetek. A kiemelés-doboz és a GYIK-válasz belseje ugyanarra a
// szűkített készletre korlátozott, mint a kép+szöveg torzs (nincs benne div),
// ezért a lusta lezárás biztonságos.
const KIEMELES_RE = /<div[^>]*class="[^"]*tpu-kiemeles[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
const CTA_RE = /<a[^>]*\btpu-cta\b[^>]*>([\s\S]*?)<\/a>/gi;
const GYIK_RE = /<details[^>]*class="[^"]*tpu-gyik[^"]*"[^>]*>\s*<summary[^>]*>([\s\S]*?)<\/summary>\s*<div[^>]*class="[^"]*tpu-gyik-valasz[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/details>/gi;

// Szerver-adatos helyjelzők (üres div, a tartalmát a WP tölti ki). Ezeket
// kizárólag a mi szerializálónk írja, ezért az osztály-érték pontosan
// illeszthető (nincs osztály-változat).
const VIDEO_RE = /<div[^>]*class="tpu-video"[^>]*>\s*<\/div>/gi;
const TERKEPW_RE = /<div[^>]*class="tpu-terkep-widget"[^>]*>\s*<\/div>/gi;
const AJANLATW_RE = /<div[^>]*class="tpu-ajanlat-widget"[^>]*>\s*<\/div>/gi;
const UTICELW_RE = /<div[^>]*class="tpu-uticel-widget"[^>]*>\s*<\/div>/gi;

const KIEMELES_VARIANSOK = ['jotudni', 'tipp', 'figyelem'];
const TERKEP_PREFIX = 'https://www.google.com/maps/embed';
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{6,15}$/;

// Sima szöveg kinyerése egy HTML-darabból (summary/CTA-felirat parse-hoz).
function szovegtelenit(html) {
    return (html || '')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
        .trim();
}

function talal(re, s, poz) {
    re.lastIndex = poz;
    return re.exec(s);
}

// Szöveg-szakasz hozzáadása: a széleken lévő üres <p></p>-ket (wpautop/Quill
// maradékok) leszedjük; csak látható tartalommal bíró szakasz kerül be.
function pushSzoveg(lista, html) {
    const tiszta = (html || '').trim()
        .replace(/^(?:<p>(?:\s|&nbsp;)*<\/p>\s*)+/gi, '')
        .replace(/(?:\s*<p>(?:\s|&nbsp;)*<\/p>)+$/gi, '');
    if (!uresSzoveg(tiszta)) lista.push({ tipus: 'szoveg', html: tiszta });
}

/**
 * Tárolt HTML → blokk-leírások listája.
 * Leírás-típusok:
 *   { tipus:'szoveg',     html }
 *   { tipus:'kep',        kep:{id,url,felirat,meret} }
 *   { tipus:'kepszoveg',  kep, pozicio:'bal'|'jobb', html }
 *   { tipus:'galeriasor', kepek:[kep,…] }
 * Jelölő nélküli (régi) tartalom = egyetlen szöveg-blokk.
 */
export function parseTartalom(html) {
    const nyers = (html || '').trim();
    const lista = [];
    let poz = 0;

    while (poz < nyers.length) {
        const talalatok = [
            ['kepszoveg', talal(KEPSZOVEG_RE, nyers, poz)],
            ['galeriasor', talal(GALERIASOR_RE, nyers, poz)],
            ['fotomozaik', talal(FOTOMOZAIK_RE, nyers, poz)],
            ['kiemeles', talal(KIEMELES_RE, nyers, poz)],
            ['cta', talal(CTA_RE, nyers, poz)],
            ['gyik', talal(GYIK_RE, nyers, poz)],
            ['video', talal(VIDEO_RE, nyers, poz)],
            ['terkepw', talal(TERKEPW_RE, nyers, poz)],
            ['ajanlatw', talal(AJANLATW_RE, nyers, poz)],
            ['uticelw', talal(UTICELW_RE, nyers, poz)],
            ['kep', talal(markerRe(), nyers, poz)],
        ].filter(t => t[1]);
        if (!talalatok.length) break;

        // A legkorábbi találat nyer — így a wrapperen BELÜLI jelölőket nem
        // fogjuk külön kép-blokknak nézni (a wrapper nyitó tagje előbb áll).
        talalatok.sort((a, b) => a[1].index - b[1].index);
        const [tipus, m] = talalatok[0];

        pushSzoveg(lista, nyers.slice(poz, m.index));

        const nyitoTag = m[0].slice(0, m[0].indexOf('>') + 1);

        if (tipus === 'kep') {
            lista.push({ tipus: 'kep', kep: kepAdat(m[0]) });
        } else if (tipus === 'fotomozaik') {
            lista.push({ tipus: 'fotomozaik' });
        } else if (tipus === 'kiemeles') {
            const vm = nyitoTag.match(/tpu-kiemeles--(jotudni|tipp|figyelem)/i);
            lista.push({ tipus: 'kiemeles', variant: vm ? vm[1].toLowerCase() : 'jotudni', html: m[1].trim() });
        } else if (tipus === 'cta') {
            lista.push({ tipus: 'cta', felirat: szovegtelenit(m[1]), url: markerAttr(nyitoTag, 'href').replace(/&amp;/g, '&') });
        } else if (tipus === 'gyik') {
            lista.push({ tipus: 'gyik', kerdes: szovegtelenit(m[1]), html: m[2].trim() });
        } else if (tipus === 'video') {
            lista.push({ tipus: 'video', youtube: markerAttr(nyitoTag, 'data-youtube') });
        } else if (tipus === 'terkepw') {
            // Az attribútum escapelve tárolódik (& → &amp;) — visszafejtjük.
            lista.push({ tipus: 'terkepw', src: markerAttr(nyitoTag, 'data-src').replace(/&amp;/g, '&') });
        } else if (tipus === 'ajanlatw') {
            lista.push({ tipus: 'ajanlatw', id: markerAttr(nyitoTag, 'data-id'), cim: szovegtelenit(markerAttr(nyitoTag, 'data-cim')) });
        } else if (tipus === 'uticelw') {
            lista.push({ tipus: 'uticelw', id: markerAttr(nyitoTag, 'data-id'), cim: szovegtelenit(markerAttr(nyitoTag, 'data-cim')) });
        } else if (tipus === 'galeriasor') {
            const kepek = (m[1].match(markerRe()) || []).map(kepAdat);
            if (kepek.length) lista.push({ tipus: 'galeriasor', kepek });
        } else {
            const nyito = m[0].slice(0, m[0].indexOf('>') + 1);
            const jelolok = m[1].match(markerRe());
            if (jelolok) {
                lista.push({
                    tipus: 'kepszoveg',
                    kep: kepAdat(jelolok[0]),
                    pozicio: /tpu-kep-szoveg--jobb/i.test(nyito) ? 'jobb' : 'bal',
                    html: m[2].trim(),
                });
            } else {
                pushSzoveg(lista, m[2]); // sérült csoport (nincs képe): a szövegét megtartjuk
            }
        }
        poz = m.index + m[0].length;
    }

    pushSzoveg(lista, nyers.slice(poz));
    if (!lista.length) lista.push({ tipus: 'szoveg', html: '' });
    return lista;
}

/**
 * Egy blokk-leírás → tárolt HTML. (A teljes tartalom a leírások
 * leirasHtml-jeinek összefűzése, üres string a láthatatlan blokkokra.)
 */
export function leirasHtml(l) {
    switch (l.tipus) {
        case 'kep':
            return markerHtml(l.kep);
        case 'fotomozaik':
            return '<div class="tpu-fotomozaik"></div>';
        case 'kiemeles': {
            if (uresSzoveg(l.html)) return '';
            const v = KIEMELES_VARIANSOK.includes(l.variant) ? l.variant : 'jotudni';
            return `<div class="tpu-kiemeles tpu-kiemeles--${v}">${l.html}</div>`;
        }
        case 'cta': {
            const felirat = (l.felirat || '').trim();
            if (!felirat) return '';
            return `<a class="tpu-cta" href="${escapeAttr(l.url || '')}">${escapeHtml(felirat)}</a>`;
        }
        case 'gyik': {
            const kerdes = (l.kerdes || '').trim();
            if (!kerdes) return '';
            return `<details class="tpu-gyik"><summary>${escapeHtml(kerdes)}</summary><div class="tpu-gyik-valasz">${uresSzoveg(l.html) ? '' : l.html}</div></details>`;
        }
        case 'video':
            return YOUTUBE_ID_RE.test(l.youtube || '')
                ? `<div class="tpu-video" data-youtube="${l.youtube}"></div>`
                : '';
        case 'terkepw':
            return (l.src || '').indexOf(TERKEP_PREFIX) === 0
                ? `<div class="tpu-terkep-widget" data-src="${escapeAttr(l.src)}"></div>`
                : '';
        case 'ajanlatw':
            return /^\d+$/.test(String(l.id || ''))
                ? `<div class="tpu-ajanlat-widget" data-id="${l.id}" data-cim="${escapeAttr(l.cim || '')}"></div>`
                : '';
        case 'uticelw':
            return /^\d+$/.test(String(l.id || ''))
                ? `<div class="tpu-uticel-widget" data-id="${l.id}" data-cim="${escapeAttr(l.cim || '')}"></div>`
                : '';
        case 'galeriasor':
            return (l.kepek && l.kepek.length)
                ? `<div class="tpu-galeria-sor">${l.kepek.map(markerHtml).join('')}</div>`
                : '';
        case 'kepszoveg':
            if (uresSzoveg(l.html)) return markerHtml(l.kep); // szöveg nélkül sima kép-blokká egyszerűsödik
            return `<div class="tpu-kep-szoveg tpu-kep-szoveg--${l.pozicio === 'jobb' ? 'jobb' : 'bal'}">${markerHtml(l.kep)}<div class="tpu-kep-szoveg-torzs">${l.html}</div></div>`;
        default:
            return uresSzoveg(l.html) ? '' : l.html;
    }
}
