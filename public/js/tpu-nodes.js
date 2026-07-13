// =====================================================
// tpu-nodes.js – A Travelpont-widgetek TipTap node-definíciói
//
// Ez a modul CSAK a sémát (tárolt HTML ↔ szerkesztő-dokumentum leképezést)
// tartalmazza, DOM-os szerkesztő-UI (node view) nélkül — így Node.js alatt
// headless is tesztelhető (@tiptap/html generateJSON/generateHTML).
// A szerkesztő-oldali megjelenés a vaszon-szerkeszto.js node view-iban él.
//
// A tárolt formátum a tpu-format.js-ben dokumentált SIMA HTML — a jelölő-
// felismerés itt DOM-alapú (attribútum-sorrendtől természeténél fogva
// független), a kimenetet pedig mi írjuk, stabil attribútum-sorrenddel.
//
// ÚJ WIDGET BEKÖTÉSE (a bővíthetőség receptje):
//   1. Itt egy új Node.create({...}) a tárolt HTML-alakkal (parseHTML/renderHTML)
//   2. A vaszon-szerkeszto.js-ben node view (szerkesztő-oldali UI) + beszúró gomb
//   3. A WP-oldali frontend.css-ben a látogatói megjelenés
// =====================================================

import { Node } from '@tiptap/core';

// A kép-jelölő közös attribútumai.
const KEP_ATTRS = {
    id: { default: '' },
    url: { default: '' },
    felirat: { default: '' },
    meret: { default: '' }, // '' (normál) | 'teljes' | 'kicsi'
};

function kepAttrsFromImg(img) {
    return {
        id: img.getAttribute('data-id') || '',
        url: img.getAttribute('src') || '',
        felirat: img.getAttribute('alt') || '',
        meret: img.getAttribute('data-meret') || '',
    };
}

// A jelölő <img> attribútum-objektuma szerializáláshoz (stabil sorrend).
export function markerAttrs(kep) {
    const attrs = {
        class: 'tpu-inline-kep',
        'data-id': kep.id,
        src: kep.url,
        alt: kep.felirat || '',
    };
    if (kep.meret === 'teljes' || kep.meret === 'kicsi') {
        attrs['data-meret'] = kep.meret;
    }
    return attrs;
}

// ---- 🖼️ Kép-blokk: <img class="tpu-inline-kep" data-id … [data-meret]> ----
export const TpuKep = Node.create({
    name: 'tpuKep',
    group: 'block',
    atom: true,
    draggable: true,

    addAttributes() {
        return { ...KEP_ATTRS };
    },

    parseHTML() {
        return [{
            tag: 'img.tpu-inline-kep',
            getAttrs: el => kepAttrsFromImg(el),
        }];
    },

    renderHTML({ node }) {
        return ['img', markerAttrs(node.attrs)];
    },
});

// ---- 🖼️📝 Kép+szöveg páros:
// <div class="tpu-kep-szoveg tpu-kep-szoveg--bal|--jobb">
//     jelölő + <div class="tpu-kep-szoveg-torzs">szerkeszthető tartalom</div>
// </div> ----
// A tartalmat hordozó widgetek belseje: csak szöveg-jellegű blokkok — widget
// widgetbe nem ágyazható (és nincs div a belsejükben, ami a tpu-format.js
// lusta regexeit is biztonságossá teszi).
const SZOVEG_TARTALOM = '(paragraph | heading | bulletList | orderedList | blockquote)+';

export const TpuKepSzoveg = Node.create({
    name: 'tpuKepSzoveg',
    group: 'block',
    content: SZOVEG_TARTALOM,
    draggable: true,
    isolating: true, // a szöveg a widgeten belül marad, kijelölés nem folyik át

    addAttributes() {
        return { ...KEP_ATTRS, pozicio: { default: 'bal' } };
    },

    parseHTML() {
        return [{
            tag: 'div.tpu-kep-szoveg',
            contentElement: '.tpu-kep-szoveg-torzs',
            getAttrs: el => {
                const img = el.querySelector('img.tpu-inline-kep');
                if (!img) return false; // kép nélküli (sérült) csoport — nem ez a szabály kezeli
                const osztaly = el.getAttribute('class') || '';
                return {
                    ...kepAttrsFromImg(img),
                    pozicio: osztaly.indexOf('tpu-kep-szoveg--jobb') !== -1 ? 'jobb' : 'bal',
                };
            },
        }];
    },

    renderHTML({ node }) {
        const pozicio = node.attrs.pozicio === 'jobb' ? 'jobb' : 'bal';
        return ['div', { class: `tpu-kep-szoveg tpu-kep-szoveg--${pozicio}` },
            ['img', markerAttrs(node.attrs)],
            ['div', { class: 'tpu-kep-szoveg-torzs' }, 0],
        ];
    },
});

// ---- 🖼️🖼️ Kép-sor: <div class="tpu-galeria-sor"> 2-3 jelölő </div> ----
export const TpuGaleriaSor = Node.create({
    name: 'tpuGaleriaSor',
    group: 'block',
    atom: true,
    draggable: true,

    addAttributes() {
        return { kepek: { default: [] } }; // [{id, url, felirat, meret}]
    },

    parseHTML() {
        return [{
            tag: 'div.tpu-galeria-sor',
            getAttrs: el => {
                const kepek = Array.from(el.querySelectorAll('img.tpu-inline-kep')).map(kepAttrsFromImg);
                return kepek.length ? { kepek } : false; // üres sor nem kerül be
            },
        }];
    },

    renderHTML({ node }) {
        return ['div', { class: 'tpu-galeria-sor' },
            ...node.attrs.kepek.map(k => ['img', markerAttrs(k)]),
        ];
    },
});

// ---- 📷 Fotó-mozaik helyjelző: <div class="tpu-fotomozaik"></div> ----
// A WP-oldal ezen a ponton rajzolja ki a szövegben fel nem használt
// galéria-képek rácsát. A szerkesztőben tájékoztató kártyaként jelenik meg.
export const TpuFotomozaik = Node.create({
    name: 'tpuFotomozaik',
    group: 'block',
    atom: true,
    draggable: true,

    parseHTML() {
        return [{ tag: 'div.tpu-fotomozaik' }];
    },

    renderHTML() {
        return ['div', { class: 'tpu-fotomozaik' }];
    },
});

// ---- 💡 Kiemelés-doboz: <div class="tpu-kiemeles tpu-kiemeles--{variáns}">…</div> ----
export const TpuKiemeles = Node.create({
    name: 'tpuKiemeles',
    group: 'block',
    content: SZOVEG_TARTALOM,
    draggable: true,
    isolating: true,

    addAttributes() {
        return { variant: { default: 'jotudni' } }; // jotudni | tipp | figyelem
    },

    parseHTML() {
        return [{
            tag: 'div.tpu-kiemeles',
            getAttrs: el => {
                const osztaly = el.getAttribute('class') || '';
                const m = osztaly.match(/tpu-kiemeles--(jotudni|tipp|figyelem)/i);
                return { variant: m ? m[1].toLowerCase() : 'jotudni' };
            },
        }];
    },

    renderHTML({ node }) {
        const v = ['tipp', 'figyelem'].includes(node.attrs.variant) ? node.attrs.variant : 'jotudni';
        return ['div', { class: `tpu-kiemeles tpu-kiemeles--${v}` }, 0];
    },
});

// ---- 🔘 CTA-gomb: <a class="tpu-cta" href="…">Felirat</a> ----
// A felirat és a link attribútum (a node view-ban szerkeszthető), nem
// folyószöveg — így a gomb egyben mozog/törlődik.
export const TpuCta = Node.create({
    name: 'tpuCta',
    group: 'block',
    atom: true,
    draggable: true,

    addAttributes() {
        return { felirat: { default: '' }, url: { default: '' } };
    },

    parseHTML() {
        return [{
            tag: 'a.tpu-cta',
            // A StarterKit Link markja (a[href]) elé kell vágnunk, különben
            // a CTA sima linkelt szöveggé esne szét beillesztéskor.
            priority: 100,
            getAttrs: el => ({
                felirat: (el.textContent || '').trim(),
                url: el.getAttribute('href') || '',
            }),
        }];
    },

    renderHTML({ node }) {
        return ['a', { class: 'tpu-cta', href: node.attrs.url || '' }, node.attrs.felirat || ''];
    },
});

// ---- ❓ GYIK: <details class="tpu-gyik"><summary>Kérdés</summary>
//              <div class="tpu-gyik-valasz">válasz</div></details> ----
// A látogatói oldalon natív lenyíló (JS nélkül); a WP FAQPage JSON-LD-t
// készít belőle a Google rich resulthoz.
export const TpuGyik = Node.create({
    name: 'tpuGyik',
    group: 'block',
    content: SZOVEG_TARTALOM,
    draggable: true,
    isolating: true,

    addAttributes() {
        return { kerdes: { default: '' } };
    },

    parseHTML() {
        return [{
            tag: 'details.tpu-gyik',
            contentElement: 'div.tpu-gyik-valasz',
            getAttrs: el => {
                const summary = el.querySelector('summary');
                return { kerdes: summary ? (summary.textContent || '').trim() : '' };
            },
        }];
    },

    renderHTML({ node }) {
        return ['details', { class: 'tpu-gyik' },
            ['summary', {}, node.attrs.kerdes || ''],
            ['div', { class: 'tpu-gyik-valasz' }, 0],
        ];
    },
});

// ---- ▶️ YouTube-videó helyjelző: <div class="tpu-video" data-youtube="ID"> ----
// A WP kattintásra töltő, youtube-nocookie beágyazást renderel belőle.
export const TpuVideo = Node.create({
    name: 'tpuVideo',
    group: 'block',
    atom: true,
    draggable: true,

    addAttributes() {
        return { youtube: { default: '' } };
    },

    parseHTML() {
        return [{
            tag: 'div.tpu-video',
            getAttrs: el => ({ youtube: el.getAttribute('data-youtube') || '' }),
        }];
    },

    renderHTML({ node }) {
        return ['div', { class: 'tpu-video', 'data-youtube': node.attrs.youtube || '' }];
    },
});

// ---- 🗺️ Térkép helyjelző: <div class="tpu-terkep-widget" data-src="…"> ----
// Csak https://www.google.com/maps/embed kezdetű URL-t renderel a WP.
export const TpuTerkepWidget = Node.create({
    name: 'tpuTerkepWidget',
    group: 'block',
    atom: true,
    draggable: true,

    addAttributes() {
        return { src: { default: '' } };
    },

    parseHTML() {
        return [{
            tag: 'div.tpu-terkep-widget',
            getAttrs: el => ({ src: el.getAttribute('data-src') || '' }),
        }];
    },

    renderHTML({ node }) {
        return ['div', { class: 'tpu-terkep-widget', 'data-src': node.attrs.src || '' }];
    },
});

// ---- 🎫 / 🧭 Beszúrt kártya-helyjelzők: a WP a data-id alapján a meglévő
// kártya-sablonokkal renderel; a data-cim csak szerkesztő-oldali felirat. ----
function kartyaWidget(name, cssClass) {
    return Node.create({
        name,
        group: 'block',
        atom: true,
        draggable: true,

        addAttributes() {
            return { id: { default: '' }, cim: { default: '' } };
        },

        parseHTML() {
            return [{
                tag: `div.${cssClass}`,
                getAttrs: el => ({
                    id: el.getAttribute('data-id') || '',
                    cim: el.getAttribute('data-cim') || '',
                }),
            }];
        },

        renderHTML({ node }) {
            return ['div', { class: cssClass, 'data-id': node.attrs.id || '', 'data-cim': node.attrs.cim || '' }];
        },
    });
}

export const TpuAjanlatWidget = kartyaWidget('tpuAjanlatWidget', 'tpu-ajanlat-widget');
export const TpuUticelWidget = kartyaWidget('tpuUticelWidget', 'tpu-uticel-widget');

export const TPU_WIDGET_NEVEK = [
    'tpuKep', 'tpuKepSzoveg', 'tpuGaleriaSor', 'tpuFotomozaik',
    'tpuKiemeles', 'tpuCta', 'tpuGyik', 'tpuVideo', 'tpuTerkepWidget',
    'tpuAjanlatWidget', 'tpuUticelWidget',
];
