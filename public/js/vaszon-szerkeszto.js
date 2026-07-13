// =====================================================
// vaszon-szerkeszto.js – Egy-vásznas vizuális szerkesztő az Úticélok
// "Bemutató szöveg" mezőjéhez (TipTap/ProseMirror alapon).
//
// A korábbi blokk-szerkesztő utódja: NEM külön dobozok, hanem EGYETLEN
// írófelület, amibe a kurzor pozíciójánál tetszőleges helyre szúrhatók
// a widgetek (kép, kép+szöveg, kép-sor) — meglévő szöveg közepébe is.
// A widgetek a vásznon kis kártyaként jelennek meg saját vezérlőkkel
// (méret, pozíció, mozgatás, törlés), a kép+szöveg widget szövege a
// widgeten BELÜL szerkeszthető.
//
// A TÁROLT FORMÁTUM VÁLTOZATLAN SIMA HTML (tpu-format.js) — a WordPress-
// oldal (travelpont-uticelok ≥1.17.0) és a régi tartalom érintetlen.
// A getHtml() a TipTap-kimenetet átfuttatja a tpu-format
// parse→szerializáláson, így a formátum-invariánsok (üres szélek levágása,
// üres kép+szöveg egyszerűsítése) a szerkesztőtől függetlenül garantáltak.
//
// A séma (tárolt HTML ↔ dokumentum) a tpu-nodes.js-ben él és headless
// tesztelt; ez a fájl a szerkesztő-oldali UI-t adja hozzá (node view-k,
// eszköztár, kép-választó). ÚJ WIDGET receptje: tpu-nodes.js (séma) +
// itt egy node view és beszúró gomb + WP frontend.css.
//
// Függőségek: TipTap ESM (esm.sh, az uticelok.html importmap-jában
// rögzített verzióval). Ha a CDN nem érhető el, az oldal a hívó által
// adott textarea-fallbackre esik vissza (lásd uticelok.html).
// =====================================================

import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {
    TpuKep, TpuKepSzoveg, TpuGaleriaSor, TpuFotomozaik,
    TpuKiemeles, TpuCta, TpuGyik, TpuVideo, TpuTerkepWidget,
    TpuAjanlatWidget, TpuUticelWidget,
} from './tpu-nodes.js';
import { parseTartalom, leirasHtml, escapeHtml, escapeAttr } from './tpu-format.js';

const SOR_MAX_KEP = 3;

const KEP_MERETEK = [
    ['', 'Normál'],
    ['teljes', 'Teljes szélesség'],
    ['kicsi', 'Kicsi'],
];

// ---- Widget-katalógus: a bal oldali paletta és a fejléc-címkék forrása ----
// Az `ikon` a public/icons/szerkeszto/{ikon}.svg fájlra mutat (sziluettként,
// CSS mask-kal színezve); amíg a fájl hiányzik, az emoji-tartalék látszik.
const WIDGETEK = [
    { csoport: 'Kép', cmd: 'kep', nev: 'Kép', rovid: 'Kép', emoji: '🖼️', ikon: 'kep' },
    { csoport: 'Kép', cmd: 'kepszoveg', nev: 'Kép + szöveg', rovid: 'Kép+szöveg', emoji: '🖼️📝', ikon: 'kep-szoveg' },
    { csoport: 'Kép', cmd: 'galeriasor', nev: 'Kép-sor', rovid: 'Kép-sor', emoji: '🖼️🖼️', ikon: 'kep-sor' },
    { csoport: 'Kép', cmd: 'fotomozaik', nev: 'Fotó-mozaik', rovid: 'Mozaik', emoji: '📷', ikon: 'foto-mozaik' },
    { csoport: 'Tartalom', cmd: 'kiemeles', nev: 'Kiemelés-doboz', rovid: 'Kiemelés', emoji: '💡', ikon: 'kiemeles' },
    { csoport: 'Tartalom', cmd: 'cta', nev: 'CTA-gomb', rovid: 'CTA-gomb', emoji: '🔘', ikon: 'cta-gomb' },
    { csoport: 'Tartalom', cmd: 'gyik', nev: 'GYIK-kérdés', rovid: 'GYIK', emoji: '❓', ikon: 'gyik' },
    { csoport: 'Tartalom', cmd: 'video', nev: 'YouTube-videó', rovid: 'Videó', emoji: '▶️', ikon: 'video' },
    { csoport: 'Tartalom', cmd: 'terkep', nev: 'Térkép', rovid: 'Térkép', emoji: '🗺️', ikon: 'terkep' },
    { csoport: 'Tartalom', cmd: 'ajanlat', nev: 'Ajánlat-kártya', rovid: 'Ajánlat', emoji: '🎫', ikon: 'ajanlat' },
    { csoport: 'Tartalom', cmd: 'uticel', nev: 'Úticél-ajánló', rovid: 'Úticél', emoji: '🧭', ikon: 'uticel-ajanlo' },
];
const WIDGET = Object.fromEntries(WIDGETEK.map(w => [w.cmd, w]));

// Ikon-elérhetőség (modul-szintű, munkamenetenként egyszer próbáljuk).
const ikonAllapot = new Map(); // ikon-név → true (betölt) | false (hiányzik)

function ikonHtml(w, kicsi) {
    return `<span class="vaszon-ikonpar${kicsi ? ' vaszon-ikonpar--kicsi' : ''} ikon-hianyzik" data-ikon="${w.ikon}">`
        + `<span class="vaszon-ikon" style="--vaszon-ikon: url('icons/szerkeszto/${w.ikon}.svg')"></span>`
        + `<span class="vaszon-ikon-emoji">${w.emoji}</span></span>`;
}

// A már ismert ikon-állapotok érvényesítése egy DOM-részfán.
function alkalmazIkonok(gyoker) {
    gyoker.querySelectorAll('.vaszon-ikonpar').forEach(el => {
        el.classList.toggle('ikon-hianyzik', ikonAllapot.get(el.dataset.ikon) !== true);
    });
}

function inditIkonProba(kesz) {
    WIDGETEK.forEach(w => {
        if (ikonAllapot.has(w.ikon)) return;
        const img = new Image();
        img.onload = () => { ikonAllapot.set(w.ikon, true); kesz(); };
        img.onerror = () => { ikonAllapot.set(w.ikon, false); kesz(); };
        img.src = `icons/szerkeszto/${w.ikon}.svg`;
    });
}

// A stored-formátum invariánsainak érvényesítése a szerkesztő kimenetén.
function normalizal(html) {
    return parseTartalom(html || '').map(leirasHtml).join('');
}

/**
 * Vászon-szerkesztő létrehozása. Ugyanaz az API-ja, mint a korábbi
 * blokk-szerkesztőé volt (drop-in csere az uticelok.html-ben).
 * @param {Object} opts
 * @param {string} opts.containerId       Üres div, ide épül a szerkesztő.
 * @param {string} opts.initialHtml       A betöltendő tartalom HTML-je.
 * @param {Function} opts.galeriaProvider () => [{id, url, caption}] – mindig a friss galéria.
 * @param {Function} [opts.onUres]        Visszajelzés, ha üres galériából próbálnának képet szúrni.
 * @param {Function} [opts.onChange]      Minden felhasználói módosításkor hívódik (dirty-követéshez).
 * @param {Function} [opts.onUzenet]      Rövid tájékoztató üzenet a felhasználónak (pl. toast).
 * @param {Function} [opts.ajanlatProvider] async () => [{id, cim, kep}] – Ajánlatok a kártya-választóhoz.
 * @param {Function} [opts.uticelProvider]  async () => [{id, cim, kep}] – Úticélek az ajánló-választóhoz.
 * @returns {{getHtml, setHtml, cserelSzoveg, refreshGaleria, destroy}}
 */
export function createVaszonSzerkeszto({ containerId, initialHtml, galeriaProvider, onUres, onChange, onUzenet, ajanlatProvider, uticelProvider }) {
    const container = document.getElementById(containerId);
    if (!container) return null;

    // Az élő node view-példányok — a refreshGaleria rajtuk keresztül tudja
    // frissíteni a "hiányzó kép" jelzést akkor is, ha a doc nem változott.
    const nezetek = new Set();

    function galeriaKep(id) {
        const galeria = galeriaProvider() || [];
        return galeria.find(k => String(k.id) === String(id)) || null;
    }

    // ---- Váz: bal oldali widget-paletta + eszköztár + írólap ----
    container.innerHTML = `
        <div class="vaszon">
            <div class="vaszon-paletta">
                <div class="vaszon-paletta-belso">
                    ${['Kép', 'Tartalom'].map(csoport => `
                        <div class="vaszon-paletta-cim">${csoport}</div>
                        ${WIDGETEK.filter(w => w.csoport === csoport).map(w => `
                            <button type="button" class="vaszon-paletta-gomb" data-cmd="${w.cmd}" title="${w.nev} beszúrása a kurzorhoz">
                                ${ikonHtml(w)}
                                <span class="vaszon-paletta-felirat">${w.rovid}</span>
                            </button>`).join('')}`).join('')}
                </div>
            </div>
            <div class="vaszon-fo">
                <div class="vaszon-toolbar"></div>
                <div class="vaszon-lap"></div>
            </div>
        </div>`;
    const toolbarEl = container.querySelector('.vaszon-toolbar');
    const lapEl = container.querySelector('.vaszon-lap');

    container.querySelector('.vaszon-paletta').addEventListener('click', e => {
        const gomb = e.target.closest('button[data-cmd]');
        if (gomb) futtatParancs(gomb.dataset.cmd);
    });

    inditIkonProba(() => alkalmazIkonok(container));

    // ---- Node view-k (szerkesztő-oldali widget-UI) ----

    // Közös: kép-előnézet rész HTML-je.
    function kepReszHtml(kep) {
        const friss = galeriaKep(kep.id);
        const url = friss ? friss.url : kep.url;
        const felirat = friss ? (friss.caption || '') : (kep.felirat || '');
        return `
            <img src="${escapeAttr(url)}" alt="${escapeAttr(felirat)}">
            ${felirat ? `<div class="vaszon-kep-felirat">${escapeHtml(felirat)}</div>` : ''}
            ${!friss ? '<div class="vaszon-kep-hiba">⚠️ Ez a kép már nincs a Galériában — érdemes törölni vagy cserélni.</div>' : ''}`;
    }

    function widgetFejlecHtml(w, extra) {
        return `
            <span class="vaszon-widget-cimke">${ikonHtml(w, true)}${w.nev}</span>
            <span class="vaszon-widget-gombok">
                ${extra || ''}
                <button type="button" class="vaszon-gomb" data-mit="fel" title="Mozgatás felfelé">↑</button>
                <button type="button" class="vaszon-gomb" data-mit="le" title="Mozgatás lefelé">↓</button>
                <button type="button" class="vaszon-gomb vaszon-gomb--torles" data-mit="torles" title="Widget törlése">✕</button>
            </span>`;
    }

    // A widget-fejléc közös gombjainak bekötése (mozgatás, törlés).
    function kossFejlecGombok(fejlec, editor, getPos) {
        fejlec.querySelector('[data-mit="fel"]').addEventListener('click', () => mozgatWidget(editor, getPos, -1));
        fejlec.querySelector('[data-mit="le"]').addEventListener('click', () => mozgatWidget(editor, getPos, 1));
        fejlec.querySelector('[data-mit="torles"]').addEventListener('click', () => torolWidget(editor, getPos));
    }

    function attrCsere(editor, getPos, ujAttrs) {
        const view = editor.view;
        const pos = getPos();
        if (typeof pos !== 'number') return;
        const node = view.state.doc.nodeAt(pos);
        if (!node) return;
        view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...ujAttrs }));
    }

    function torolWidget(editor, getPos) {
        const pos = getPos();
        if (typeof pos !== 'number') return;
        const node = editor.view.state.doc.nodeAt(pos);
        if (!node) return;
        editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
    }

    // Felfelé/lefelé csere a legfelső szinten (a widgetek ott élnek).
    function mozgatWidget(editor, getPos, irany) {
        const pos = getPos();
        if (typeof pos !== 'number') return;
        const state = editor.view.state;
        const $pos = state.doc.resolve(pos);
        if ($pos.depth !== 0) return;
        const idx = $pos.index(0);
        const celIdx = idx + irany;
        if (celIdx < 0 || celIdx >= state.doc.childCount) return;
        const sajat = state.doc.child(idx);
        const masik = state.doc.child(celIdx);
        let tr = state.tr.delete(pos, pos + sajat.nodeSize);
        const ujPos = irany < 0 ? pos - masik.nodeSize : pos + masik.nodeSize;
        tr = tr.insert(ujPos, sajat);
        editor.view.dispatch(tr);
        editor.commands.focus();
    }

    // 🖼️ Kép widget node view-ja.
    function kepNezet({ node, editor, getPos }) {
        const dom = document.createElement('div');
        dom.className = 'vaszon-widget vaszon-widget--kep';
        let aktNode = node;

        function rajzol() {
            dom.innerHTML = `
                <div class="vaszon-widget-fejlec">${widgetFejlecHtml(WIDGET.kep, `
                    <select class="vaszon-select" title="Megjelenítési méret">
                        ${KEP_MERETEK.map(([v, c]) => `<option value="${v}" ${(aktNode.attrs.meret || '') === v ? 'selected' : ''}>${c}</option>`).join('')}
                    </select>`)}
                </div>
                <div class="vaszon-kep-resz">${kepReszHtml(aktNode.attrs)}</div>`;
            dom.querySelector('.vaszon-select').addEventListener('change', e => attrCsere(editor, getPos, { meret: e.target.value }));
            kossFejlecGombok(dom.querySelector('.vaszon-widget-fejlec'), editor, getPos);
            alkalmazIkonok(dom);
        }
        rajzol();

        const peldany = { frissit: rajzol };
        nezetek.add(peldany);
        return {
            dom,
            update(n) {
                if (n.type.name !== 'tpuKep') return false;
                aktNode = n;
                rajzol();
                return true;
            },
            destroy() { nezetek.delete(peldany); },
        };
    }

    // 🖼️📝 Kép+szöveg widget node view-ja (a szöveg a widgeten belül szerkeszthető).
    function kepSzovegNezet({ node, editor, getPos }) {
        const dom = document.createElement('div');
        dom.className = 'vaszon-widget vaszon-widget--kepszoveg';

        const fejlec = document.createElement('div');
        fejlec.className = 'vaszon-widget-fejlec';
        const grid = document.createElement('div');
        grid.className = 'vaszon-kepszoveg-grid';
        const kepResz = document.createElement('div');
        kepResz.className = 'vaszon-kep-resz';
        kepResz.contentEditable = 'false';
        const tartalom = document.createElement('div');
        tartalom.className = 'vaszon-kepszoveg-tartalom';
        grid.append(kepResz, tartalom);
        dom.append(fejlec, grid);

        let aktNode = node;

        function rajzol() {
            fejlec.innerHTML = widgetFejlecHtml(WIDGET.kepszoveg, `
                <select class="vaszon-select" title="A kép helye">
                    <option value="bal" ${aktNode.attrs.pozicio !== 'jobb' ? 'selected' : ''}>Kép balra</option>
                    <option value="jobb" ${aktNode.attrs.pozicio === 'jobb' ? 'selected' : ''}>Kép jobbra</option>
                </select>`);
            fejlec.querySelector('.vaszon-select').addEventListener('change', e => attrCsere(editor, getPos, { pozicio: e.target.value }));
            kossFejlecGombok(fejlec, editor, getPos);
            grid.classList.toggle('vaszon-kepszoveg-grid--jobb', aktNode.attrs.pozicio === 'jobb');
            kepResz.innerHTML = kepReszHtml(aktNode.attrs);
            alkalmazIkonok(fejlec);
        }
        rajzol();

        const peldany = { frissit: rajzol };
        nezetek.add(peldany);
        return {
            dom,
            contentDOM: tartalom,
            update(n) {
                if (n.type.name !== 'tpuKepSzoveg') return false;
                aktNode = n;
                rajzol();
                return true;
            },
            destroy() { nezetek.delete(peldany); },
        };
    }

    // 🖼️🖼️ Kép-sor widget node view-ja.
    function galeriaSorNezet({ node, editor, getPos }) {
        const dom = document.createElement('div');
        dom.className = 'vaszon-widget vaszon-widget--galeriasor';
        let aktNode = node;

        function rajzol() {
            const kepek = aktNode.attrs.kepek || [];
            dom.innerHTML = `
                <div class="vaszon-widget-fejlec">${widgetFejlecHtml(WIDGET.galeriasor)}</div>
                <div class="vaszon-galeriasor">
                    ${kepek.map((k, i) => `
                        <div class="vaszon-galeriasor-kep">${kepReszHtml(k)}
                            <button type="button" class="vaszon-gomb vaszon-gomb--torles vaszon-galeriasor-torles" data-index="${i}" title="Kép kivétele a sorból">✕</button>
                        </div>`).join('')}
                    ${kepek.length < SOR_MAX_KEP ? '<button type="button" class="vaszon-galeriasor-add" title="Kép hozzáadása a sorhoz">+</button>' : ''}
                </div>`;
            kossFejlecGombok(dom.querySelector('.vaszon-widget-fejlec'), editor, getPos);
            dom.querySelectorAll('.vaszon-galeriasor-torles').forEach(gomb => {
                gomb.addEventListener('click', () => {
                    const marad = (aktNode.attrs.kepek || []).filter((_, i) => i !== parseInt(gomb.dataset.index, 10));
                    if (!marad.length) { torolWidget(editor, getPos); return; }
                    attrCsere(editor, getPos, { kepek: marad });
                });
            });
            const add = dom.querySelector('.vaszon-galeriasor-add');
            if (add) add.addEventListener('click', () => {
                valasszKepet(kep => attrCsere(editor, getPos, { kepek: [...(aktNode.attrs.kepek || []), kep] }));
            });
            alkalmazIkonok(dom);
        }
        rajzol();

        const peldany = { frissit: rajzol };
        nezetek.add(peldany);
        return {
            dom,
            update(n) {
                if (n.type.name !== 'tpuGaleriaSor') return false;
                aktNode = n;
                rajzol();
                return true;
            },
            destroy() { nezetek.delete(peldany); },
        };
    }

    // 📷 Fotó-mozaik helyjelző node view-ja: tájékoztató kártya, ami mutatja,
    // hogy JELENLEG mely (a szövegben fel nem használt) képek kerülnének bele.
    function fotomozaikNezet({ editor, getPos }) {
        const dom = document.createElement('div');
        dom.className = 'vaszon-widget vaszon-widget--fotomozaik';

        function hasznaltIdk() {
            const idk = new Set();
            editor.state.doc.descendants(n => {
                if (n.type.name === 'tpuKep' || n.type.name === 'tpuKepSzoveg') idk.add(String(n.attrs.id));
                else if (n.type.name === 'tpuGaleriaSor') (n.attrs.kepek || []).forEach(k => idk.add(String(k.id)));
            });
            return idk;
        }

        function rajzol() {
            const hasznalt = hasznaltIdk();
            const maradek = (galeriaProvider() || []).filter(k => !hasznalt.has(String(k.id)));
            dom.innerHTML = `
                <div class="vaszon-widget-fejlec">${widgetFejlecHtml(WIDGET.fotomozaik)}</div>
                <div class="vaszon-fotomozaik-info">A szövegben fel nem használt galéria-képek jelennek meg itt rácsban, vágás nélkül. Tipp: tegyél elé egy címsort (pl. „További fotóink").</div>
                ${maradek.length ? `
                    <div class="vaszon-fotomozaik-kepek">
                        ${maradek.map(k => `<img src="${escapeAttr(k.url)}" title="${escapeAttr(k.caption || '')}">`).join('')}
                    </div>`
                    : '<div class="vaszon-fotomozaik-info vaszon-fotomozaik-info--ures">Jelenleg minden galéria-kép szerepel a szövegben — a mozaik üresen marad (élesben nem látszik semmi).</div>'}`;
            kossFejlecGombok(dom.querySelector('.vaszon-widget-fejlec'), editor, getPos);
            alkalmazIkonok(dom);
        }
        rajzol();

        const peldany = { frissit: rajzol };
        nezetek.add(peldany);
        return {
            dom,
            update(n) {
                if (n.type.name !== 'tpuFotomozaik') return false;
                rajzol();
                return true;
            },
            destroy() { nezetek.delete(peldany); },
        };
    }

    // 💡 Kiemelés-doboz node view-ja (a tartalom a widgeten belül szerkeszthető).
    function kiemelesNezet({ node, editor, getPos }) {
        const dom = document.createElement('div');
        dom.className = 'vaszon-widget vaszon-widget--kiemeles';
        const fejlec = document.createElement('div');
        fejlec.className = 'vaszon-widget-fejlec';
        const torzs = document.createElement('div');
        torzs.className = 'vaszon-kiemeles-torzs';
        dom.append(fejlec, torzs);

        let aktNode = node;
        function rajzol() {
            fejlec.innerHTML = widgetFejlecHtml(WIDGET.kiemeles, `
                <select class="vaszon-select" title="A doboz típusa">
                    <option value="jotudni" ${aktNode.attrs.variant !== 'tipp' && aktNode.attrs.variant !== 'figyelem' ? 'selected' : ''}>ℹ️ Jó tudni</option>
                    <option value="tipp" ${aktNode.attrs.variant === 'tipp' ? 'selected' : ''}>💡 Tipp</option>
                    <option value="figyelem" ${aktNode.attrs.variant === 'figyelem' ? 'selected' : ''}>⚠️ Figyelem</option>
                </select>`);
            fejlec.querySelector('.vaszon-select').addEventListener('change', e => attrCsere(editor, getPos, { variant: e.target.value }));
            kossFejlecGombok(fejlec, editor, getPos);
            torzs.className = 'vaszon-kiemeles-torzs vaszon-kiemeles-torzs--' + (aktNode.attrs.variant || 'jotudni');
            alkalmazIkonok(fejlec);
        }
        rajzol();

        return {
            dom,
            contentDOM: torzs,
            update(n) {
                if (n.type.name !== 'tpuKiemeles') return false;
                aktNode = n;
                rajzol();
                return true;
            },
        };
    }

    // 🔘 CTA-gomb node view-ja: felirat + link szerkesztése, élő gomb-előnézettel.
    function ctaNezet({ node, editor, getPos }) {
        const dom = document.createElement('div');
        dom.className = 'vaszon-widget vaszon-widget--cta';
        dom.innerHTML = `
            <div class="vaszon-widget-fejlec"></div>
            <div class="vaszon-cta-szerk">
                <label class="vaszon-mezo">Gomb felirata
                    <input class="input-field" data-mezo="felirat" placeholder="pl. Nézd meg az ajánlatokat">
                </label>
                <label class="vaszon-mezo">Link (https://…)
                    <input class="input-field" data-mezo="url" placeholder="https://…">
                </label>
                <div class="vaszon-cta-elonezet"><span class="vaszon-cta-minta"></span></div>
                <div class="input-hint">Külső (pl. affiliate) linknél élesben automatikusan új fülön nyílik, sponsored jelöléssel.</div>
            </div>`;
        const fejlec = dom.querySelector('.vaszon-widget-fejlec');
        const feliratInput = dom.querySelector('[data-mezo="felirat"]');
        const urlInput = dom.querySelector('[data-mezo="url"]');
        const minta = dom.querySelector('.vaszon-cta-minta');

        // Gépelés közben csak az előnézet frissül; az attribútum a mezőből
        // kilépve (change) íródik, hogy a fókusz ne ugorjon el.
        feliratInput.addEventListener('input', () => { minta.textContent = feliratInput.value || 'CTA-gomb'; });
        feliratInput.addEventListener('change', () => attrCsere(editor, getPos, { felirat: feliratInput.value.trim() }));
        urlInput.addEventListener('change', () => attrCsere(editor, getPos, { url: urlInput.value.trim() }));

        let aktNode = node;
        function rajzol() {
            fejlec.innerHTML = widgetFejlecHtml(WIDGET.cta);
            kossFejlecGombok(fejlec, editor, getPos);
            alkalmazIkonok(fejlec);
            if (document.activeElement !== feliratInput) feliratInput.value = aktNode.attrs.felirat || '';
            if (document.activeElement !== urlInput) urlInput.value = aktNode.attrs.url || '';
            minta.textContent = aktNode.attrs.felirat || 'CTA-gomb';
        }
        rajzol();

        return {
            dom,
            update(n) {
                if (n.type.name !== 'tpuCta') return false;
                aktNode = n;
                rajzol();
                return true;
            },
        };
    }

    // ❓ GYIK node view-ja: kérdés-mező + a widgeten belül szerkeszthető válasz.
    function gyikNezet({ node, editor, getPos }) {
        const dom = document.createElement('div');
        dom.className = 'vaszon-widget vaszon-widget--gyik';
        const fejlec = document.createElement('div');
        fejlec.className = 'vaszon-widget-fejlec';
        const kerdesSor = document.createElement('div');
        kerdesSor.className = 'vaszon-gyik-kerdes';
        kerdesSor.innerHTML = '<input class="input-field" placeholder="A kérdés (pl. Kell-e vízum?)">';
        kerdesSor.contentEditable = 'false';
        const torzs = document.createElement('div');
        torzs.className = 'vaszon-gyik-valasz';
        dom.append(fejlec, kerdesSor, torzs);

        const kerdesInput = kerdesSor.querySelector('input');
        kerdesInput.addEventListener('change', () => attrCsere(editor, getPos, { kerdes: kerdesInput.value.trim() }));

        let aktNode = node;
        function rajzol() {
            fejlec.innerHTML = widgetFejlecHtml(WIDGET.gyik);
            kossFejlecGombok(fejlec, editor, getPos);
            alkalmazIkonok(fejlec);
            if (document.activeElement !== kerdesInput) kerdesInput.value = aktNode.attrs.kerdes || '';
        }
        rajzol();

        return {
            dom,
            contentDOM: torzs,
            update(n) {
                if (n.type.name !== 'tpuGyik') return false;
                aktNode = n;
                rajzol();
                return true;
            },
        };
    }

    // Bármilyen YouTube-linkből (watch/shorts/embed/youtu.be) videó-ID.
    function kinyerYoutubeId(s) {
        s = (s || '').trim();
        if (/^[A-Za-z0-9_-]{6,15}$/.test(s)) return s;
        const m = s.match(/(?:youtube\.com\/(?:watch\?[^#\s]*v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,15})/i);
        return m ? m[1] : '';
    }

    // ▶️ YouTube-videó node view-ja.
    function videoNezet({ node, editor, getPos }) {
        const dom = document.createElement('div');
        dom.className = 'vaszon-widget vaszon-widget--video';
        let aktNode = node;

        function rajzol() {
            const id = aktNode.attrs.youtube || '';
            dom.innerHTML = `
                <div class="vaszon-widget-fejlec">${widgetFejlecHtml(WIDGET.video)}</div>
                <div class="vaszon-video-szerk">
                    <label class="vaszon-mezo">YouTube-link vagy videó-azonosító
                        <input class="input-field" placeholder="https://www.youtube.com/watch?v=…">
                    </label>
                    ${id
                        ? `<div class="vaszon-video-elonezet"><img src="https://i.ytimg.com/vi/${escapeAttr(id)}/hqdefault.jpg" alt=""><span class="vaszon-video-play">▶</span></div>`
                        : '<div class="input-hint">Illeszd be a videó linkjét — élesben kattintásra induló, gyors beágyazás lesz belőle.</div>'}
                </div>`;
            const input = dom.querySelector('input');
            input.value = id;
            input.addEventListener('change', () => {
                const uj = kinyerYoutubeId(input.value);
                if (!uj && input.value.trim() !== '') {
                    if (onUzenet) onUzenet('Ez nem tűnik YouTube-linknek — másold a videó teljes URL-jét.');
                    return;
                }
                attrCsere(editor, getPos, { youtube: uj });
            });
            kossFejlecGombok(dom.querySelector('.vaszon-widget-fejlec'), editor, getPos);
            alkalmazIkonok(dom);
        }
        rajzol();

        return {
            dom,
            update(n) {
                if (n.type.name !== 'tpuVideo') return false;
                aktNode = n;
                rajzol();
                return true;
            },
        };
    }

    // 🗺️ Térkép node view-ja (csak Google Maps beágyazási URL).
    const TERKEP_PREFIX = 'https://www.google.com/maps/embed';
    function terkepNezet({ node, editor, getPos }) {
        const dom = document.createElement('div');
        dom.className = 'vaszon-widget vaszon-widget--terkep';
        let aktNode = node;

        function rajzol() {
            const src = aktNode.attrs.src || '';
            const ervenyes = src.indexOf(TERKEP_PREFIX) === 0;
            dom.innerHTML = `
                <div class="vaszon-widget-fejlec">${widgetFejlecHtml(WIDGET.terkep)}</div>
                <div class="vaszon-video-szerk">
                    <label class="vaszon-mezo">Google Maps beágyazási URL
                        <input class="input-field" placeholder="${TERKEP_PREFIX}?pb=…">
                    </label>
                    ${ervenyes
                        ? `<iframe class="vaszon-terkep-elonezet" src="${escapeAttr(src)}" loading="lazy"></iframe>`
                        : '<div class="input-hint">Google Maps → Megosztás → Térkép beágyazása → a HTML „src” értékét másold ide. Csak a https://www.google.com/maps/embed… kezdetű URL működik.</div>'}
                </div>`;
            const input = dom.querySelector('input');
            input.value = src;
            input.addEventListener('change', () => {
                const uj = input.value.trim();
                if (uj !== '' && uj.indexOf(TERKEP_PREFIX) !== 0) {
                    if (onUzenet) onUzenet('Csak Google Maps beágyazási URL használható (https://www.google.com/maps/embed…).');
                    return;
                }
                attrCsere(editor, getPos, { src: uj });
            });
            kossFejlecGombok(dom.querySelector('.vaszon-widget-fejlec'), editor, getPos);
            alkalmazIkonok(dom);
        }
        rajzol();

        return {
            dom,
            update(n) {
                if (n.type.name !== 'tpuTerkepWidget') return false;
                aktNode = n;
                rajzol();
                return true;
            },
        };
    }

    // 🎫 / 🧭 Beszúrt kártya node view (közös az ajánlatnak és az úticélnak).
    function kartyaNezet(widgetDef, nodeName, provider, megjegyzes) {
        return ({ node, editor, getPos }) => {
            const dom = document.createElement('div');
            dom.className = 'vaszon-widget vaszon-widget--kartya';
            let aktNode = node;

            function rajzol() {
                dom.innerHTML = `
                    <div class="vaszon-widget-fejlec">${widgetFejlecHtml(widgetDef, `
                        <button type="button" class="vaszon-gomb vaszon-kartya-csere">Csere</button>`)}
                    </div>
                    <div class="vaszon-kartya-torzs">
                        ${ikonHtml(widgetDef)}
                        <div>
                            <div class="vaszon-kartya-cim">${escapeHtml(aktNode.attrs.cim || `#${aktNode.attrs.id}`)}</div>
                            <div class="input-hint">Élesben teljes kártyaként jelenik meg. ${megjegyzes}</div>
                        </div>
                    </div>`;
                kossFejlecGombok(dom.querySelector('.vaszon-widget-fejlec'), editor, getPos);
                dom.querySelector('.vaszon-kartya-csere').addEventListener('click', () => {
                    valasszElem(widgetDef.nev, provider, elem => attrCsere(editor, getPos, { id: String(elem.id), cim: elem.cim }));
                });
                alkalmazIkonok(dom);
            }
            rajzol();

            return {
                dom,
                update(n) {
                    if (n.type.name !== nodeName) return false;
                    aktNode = n;
                    rajzol();
                    return true;
                },
            };
        };
    }

    // ---- Általános elem-választó modal (ajánlat / úticél listákhoz) ----
    async function valasszElem(cim, provider, kivalaszt) {
        if (!provider) return;
        let lista;
        try {
            lista = await provider();
        } catch (e) {
            if (onUzenet) onUzenet('A lista betöltése nem sikerült: ' + e.message);
            return;
        }
        if (!lista || !lista.length) {
            if (onUzenet) onUzenet('Nincs választható elem.');
            return;
        }
        zarKepValaszto();
        const overlay = document.createElement('div');
        overlay.className = 'vaszon-kepvalaszto-overlay';
        overlay.innerHTML = `
            <div class="vaszon-kepvalaszto">
                <div class="vaszon-kepvalaszto-fejlec">
                    <span>${escapeHtml(cim)} — kattints a beszúrandóra</span>
                    <button type="button" class="vaszon-gomb" data-mit="megse">Mégse</button>
                </div>
                <div class="vaszon-lista">
                    ${lista.map(e => `
                        <div class="vaszon-lista-elem" data-id="${escapeAttr(e.id)}">
                            ${e.kep ? `<img src="${escapeAttr(e.kep)}">` : '<div class="vaszon-lista-kep-ures"></div>'}
                            <span>${escapeHtml(e.cim)}</span>
                        </div>`).join('')}
                </div>
            </div>`;
        overlay.addEventListener('click', e => {
            if (e.target === overlay || e.target.closest('[data-mit="megse"]')) { zarKepValaszto(); return; }
            const sor = e.target.closest('.vaszon-lista-elem');
            if (!sor) return;
            const elem = lista.find(x => String(x.id) === sor.dataset.id);
            zarKepValaszto();
            if (elem) kivalaszt(elem);
        });
        document.body.appendChild(overlay);
    }

    // ---- Szerkesztő létrehozása ----
    const editor = new Editor({
        element: lapEl,
        extensions: [
            StarterKit.configure({
                heading: { levels: [2, 3] },
                code: false,
                codeBlock: false,
                link: { openOnClick: false },
                dropcursor: { color: '#f59e0b', width: 2 },
            }),
            TpuKep.extend({ addNodeView() { return kepNezet; } }),
            TpuKepSzoveg.extend({ addNodeView() { return kepSzovegNezet; } }),
            TpuGaleriaSor.extend({ addNodeView() { return galeriaSorNezet; } }),
            TpuFotomozaik.extend({ addNodeView() { return fotomozaikNezet; } }),
            TpuKiemeles.extend({ addNodeView() { return kiemelesNezet; } }),
            TpuCta.extend({ addNodeView() { return ctaNezet; } }),
            TpuGyik.extend({ addNodeView() { return gyikNezet; } }),
            TpuVideo.extend({ addNodeView() { return videoNezet; } }),
            TpuTerkepWidget.extend({ addNodeView() { return terkepNezet; } }),
            TpuAjanlatWidget.extend({ addNodeView() { return kartyaNezet(WIDGET.ajanlat, 'tpuAjanlatWidget', ajanlatProvider, 'Ha az ajánlatot visszavonod/lejár, magától eltűnik.'); } }),
            TpuUticelWidget.extend({ addNodeView() { return kartyaNezet(WIDGET.uticel, 'tpuUticelWidget', uticelProvider, 'Fotó-csempe + cím, a saját oldalára linkelve.'); } }),
        ],
        content: initialHtml || '',
        onUpdate: () => { if (onChange) onChange(); },
        onTransaction: () => frissitToolbar(),
    });

    // ---- Eszköztár ----
    const TOOLBAR = [
        { cmd: 'bold', jel: '<b>B</b>', tip: 'Félkövér' },
        { cmd: 'italic', jel: '<i>I</i>', tip: 'Dőlt' },
        { cmd: 'underline', jel: '<u>U</u>', tip: 'Aláhúzott' },
        { elvalaszto: true },
        { cmd: 'h2', jel: 'H2', tip: 'Nagy címsor' },
        { cmd: 'h3', jel: 'H3', tip: 'Alcím' },
        { elvalaszto: true },
        { cmd: 'bullet', jel: '•≡', tip: 'Felsorolás' },
        { cmd: 'ordered', jel: '1≡', tip: 'Számozott lista' },
        { cmd: 'blockquote', jel: '❝', tip: 'Idézet' },
        { cmd: 'hr', jel: '—', tip: 'Elválasztó vonal' },
        { cmd: 'link', jel: '🔗', tip: 'Link beszúrása / eltávolítása' },
        { elvalaszto: true },
        { cmd: 'undo', jel: '↺', tip: 'Visszavonás (Ctrl+Z)' },
        { cmd: 'redo', jel: '↻', tip: 'Újra (Ctrl+Y)' },
    ];
    // A widget-beszúró gombok a bal oldali palettán élnek (lásd fent) —
    // a felső sávban csak a szöveg-formázás maradt.

    toolbarEl.innerHTML = TOOLBAR.map(t => t.elvalaszto
        ? '<span class="vaszon-toolbar-elvalaszto"></span>'
        : `<button type="button" class="vaszon-toolbar-gomb" data-cmd="${t.cmd}" title="${t.tip}">${t.jel}</button>`
    ).join('');

    toolbarEl.addEventListener('click', e => {
        const gomb = e.target.closest('button[data-cmd]');
        if (!gomb) return;
        futtatParancs(gomb.dataset.cmd);
    });

    function futtatParancs(cmd) {
        const lanc = editor.chain().focus();
        switch (cmd) {
            case 'bold': lanc.toggleBold().run(); break;
            case 'italic': lanc.toggleItalic().run(); break;
            case 'underline': lanc.toggleUnderline().run(); break;
            case 'h2': lanc.toggleHeading({ level: 2 }).run(); break;
            case 'h3': lanc.toggleHeading({ level: 3 }).run(); break;
            case 'bullet': lanc.toggleBulletList().run(); break;
            case 'ordered': lanc.toggleOrderedList().run(); break;
            case 'blockquote': lanc.toggleBlockquote().run(); break;
            case 'hr': lanc.setHorizontalRule().run(); break;
            case 'link': {
                if (editor.isActive('link')) { lanc.unsetLink().run(); break; }
                const url = prompt('Link címe (https://…):');
                if (url) lanc.extendMarkRange('link').setLink({ href: url }).run();
                break;
            }
            case 'kep':
                valasszKepet(kep => editor.chain().focus().insertContent({ type: 'tpuKep', attrs: { ...kep } }).run());
                break;
            case 'kepszoveg':
                valasszKepet(kep => editor.chain().focus().insertContent({
                    type: 'tpuKepSzoveg',
                    attrs: { ...kep, pozicio: 'bal' },
                    content: [{ type: 'paragraph' }],
                }).run());
                break;
            case 'galeriasor':
                valasszKepet(kep => editor.chain().focus().insertContent({
                    type: 'tpuGaleriaSor',
                    attrs: { kepek: [kep] },
                }).run());
                break;
            case 'fotomozaik': {
                let mar = false;
                editor.state.doc.descendants(n => {
                    if (n.type.name === 'tpuFotomozaik') { mar = true; return false; }
                });
                if (mar) {
                    if (onUzenet) onUzenet('Fotó-mozaik már van a tartalomban — egy elég belőle.');
                    break;
                }
                editor.chain().focus().insertContent({ type: 'tpuFotomozaik' }).run();
                break;
            }
            case 'kiemeles':
                editor.chain().focus().insertContent({
                    type: 'tpuKiemeles',
                    attrs: { variant: 'jotudni' },
                    content: [{ type: 'paragraph' }],
                }).run();
                break;
            case 'cta':
                editor.chain().focus().insertContent({
                    type: 'tpuCta',
                    attrs: { felirat: 'Nézd meg az ajánlatokat', url: '' },
                }).run();
                break;
            case 'gyik':
                editor.chain().focus().insertContent({
                    type: 'tpuGyik',
                    attrs: { kerdes: '' },
                    content: [{ type: 'paragraph' }],
                }).run();
                break;
            case 'video':
                editor.chain().focus().insertContent({ type: 'tpuVideo', attrs: { youtube: '' } }).run();
                break;
            case 'terkep':
                editor.chain().focus().insertContent({ type: 'tpuTerkepWidget', attrs: { src: '' } }).run();
                break;
            case 'ajanlat':
                valasszElem('Ajánlat-kártya', ajanlatProvider, elem => {
                    editor.chain().focus().insertContent({
                        type: 'tpuAjanlatWidget',
                        attrs: { id: String(elem.id), cim: elem.cim },
                    }).run();
                });
                break;
            case 'uticel':
                valasszElem('Úticél-ajánló', uticelProvider, elem => {
                    editor.chain().focus().insertContent({
                        type: 'tpuUticelWidget',
                        attrs: { id: String(elem.id), cim: elem.cim },
                    }).run();
                });
                break;
            case 'undo': lanc.undo().run(); break;
            case 'redo': lanc.redo().run(); break;
        }
    }

    function frissitToolbar() {
        const aktiv = {
            bold: editor.isActive('bold'),
            italic: editor.isActive('italic'),
            underline: editor.isActive('underline'),
            h2: editor.isActive('heading', { level: 2 }),
            h3: editor.isActive('heading', { level: 3 }),
            bullet: editor.isActive('bulletList'),
            ordered: editor.isActive('orderedList'),
            blockquote: editor.isActive('blockquote'),
            link: editor.isActive('link'),
        };
        toolbarEl.querySelectorAll('button[data-cmd]').forEach(gomb => {
            gomb.classList.toggle('aktiv', !!aktiv[gomb.dataset.cmd]);
        });
    }

    // ---- Kép-választó (modal) ----
    function valasszKepet(kivalaszt) {
        const galeria = galeriaProvider() || [];
        if (!galeria.length) {
            if (onUres) onUres();
            return;
        }
        zarKepValaszto();
        const overlay = document.createElement('div');
        overlay.className = 'vaszon-kepvalaszto-overlay';
        overlay.innerHTML = `
            <div class="vaszon-kepvalaszto">
                <div class="vaszon-kepvalaszto-fejlec">
                    <span>Kattints a beszúrandó képre</span>
                    <button type="button" class="vaszon-gomb" data-mit="megse">Mégse</button>
                </div>
                <div class="crud-gallery-grid">
                    ${galeria.map(k => `
                        <div class="crud-gallery-item crud-gallery-item--valaszthato" data-id="${escapeAttr(k.id)}">
                            <div class="crud-gallery-thumb"><img src="${escapeAttr(k.url)}"></div>
                            ${k.caption ? `<div class="vaszon-kep-felirat">${escapeHtml(k.caption)}</div>` : ''}
                        </div>`).join('')}
                </div>
            </div>`;
        overlay.addEventListener('click', e => {
            if (e.target === overlay || e.target.closest('[data-mit="megse"]')) { zarKepValaszto(); return; }
            const elem = e.target.closest('.crud-gallery-item--valaszthato');
            if (!elem) return;
            const k = galeria.find(g => String(g.id) === elem.dataset.id);
            zarKepValaszto();
            if (k) kivalaszt({ id: k.id, url: k.url, felirat: k.caption || '', meret: '' });
        });
        document.body.appendChild(overlay);
    }

    function zarKepValaszto() {
        document.querySelectorAll('.vaszon-kepvalaszto-overlay').forEach(o => o.remove());
    }

    // ---- Galéria-szinkron: feliratok/URL-ek átvezetése a dokumentumba ----
    // (felirat-átírás vagy kép-törlés a Galériában → a widgetek kövessék).
    function galeriaSzinkron() {
        const view = editor.view;
        let tr = view.state.tr;
        let valtozott = false;
        view.state.doc.descendants((node, pos) => {
            if (node.type.name === 'tpuKep' || node.type.name === 'tpuKepSzoveg') {
                const friss = galeriaKep(node.attrs.id);
                if (friss && (friss.url !== node.attrs.url || (friss.caption || '') !== node.attrs.felirat)) {
                    tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, url: friss.url, felirat: friss.caption || '' });
                    valtozott = true;
                }
            } else if (node.type.name === 'tpuGaleriaSor') {
                const kepek = (node.attrs.kepek || []).map(k => {
                    const friss = galeriaKep(k.id);
                    return friss ? { ...k, url: friss.url, felirat: friss.caption || '' } : k;
                });
                if (JSON.stringify(kepek) !== JSON.stringify(node.attrs.kepek)) {
                    tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, kepek });
                    valtozott = true;
                }
            }
        });
        if (valtozott) {
            tr.setMeta('addToHistory', false);
            view.dispatch(tr);
        }
        // A "hiányzó kép" jelzés attr-változás nélkül is frissüljön:
        nezetek.forEach(n => n.frissit());
    }

    // Betöltéskor egyszer: a mentett jelölők feliratai frissüljenek a galériából.
    galeriaSzinkron();

    // ---- Publikus API (azonos a blokk-szerkesztőével) ----
    return {
        getHtml: () => normalizal(editor.getHTML()),

        setHtml: html => { editor.commands.setContent(html || ''); },

        // AI-tól érkező szöveg: a szöveges részt cseréli, a widgeteket a
        // tartalom végére megtartja.
        // Megjegyzés: a szöveges JELLEGŰ widgetek (kiemelés, GYIK) is cserélődnek,
        // mert az AI maga is írhat ilyeneket — csak a kép-alapú és szerver-adatos
        // widgetek (kép, kép-sor, mozaik, CTA, videó, térkép, kártyák) maradnak meg.
        cserelSzoveg: html => {
            const SZOVEGES = ['szoveg', 'kiemeles', 'gyik'];
            const widgetHtml = parseTartalom(editor.getHTML())
                .filter(l => !SZOVEGES.includes(l.tipus))
                .map(leirasHtml)
                .join('');
            editor.commands.setContent((html || '') + widgetHtml);
        },

        refreshGaleria: galeriaSzinkron,

        destroy: () => {
            zarKepValaszto();
            editor.destroy();
        },
    };
}
