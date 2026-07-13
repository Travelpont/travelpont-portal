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
export const TpuKepSzoveg = Node.create({
    name: 'tpuKepSzoveg',
    group: 'block',
    // Csak szöveg-jellegű blokkok engedettek benne — widget widgetbe nem ágyazható.
    content: '(paragraph | heading | bulletList | orderedList | blockquote)+',
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

export const TPU_WIDGET_NEVEK = ['tpuKep', 'tpuKepSzoveg', 'tpuGaleriaSor'];
