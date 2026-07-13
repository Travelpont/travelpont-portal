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
import { TpuKep, TpuKepSzoveg, TpuGaleriaSor } from './tpu-nodes.js';
import { parseTartalom, leirasHtml, escapeHtml, escapeAttr } from './tpu-format.js';

const SOR_MAX_KEP = 3;

const KEP_MERETEK = [
    ['', 'Normál'],
    ['teljes', 'Teljes szélesség'],
    ['kicsi', 'Kicsi'],
];

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
 * @returns {{getHtml, setHtml, cserelSzoveg, refreshGaleria, destroy}}
 */
export function createVaszonSzerkeszto({ containerId, initialHtml, galeriaProvider, onUres, onChange }) {
    const container = document.getElementById(containerId);
    if (!container) return null;

    // Az élő node view-példányok — a refreshGaleria rajtuk keresztül tudja
    // frissíteni a "hiányzó kép" jelzést akkor is, ha a doc nem változott.
    const nezetek = new Set();

    function galeriaKep(id) {
        const galeria = galeriaProvider() || [];
        return galeria.find(k => String(k.id) === String(id)) || null;
    }

    // ---- Váz: eszköztár + írólap ----
    container.innerHTML = `
        <div class="vaszon">
            <div class="vaszon-toolbar"></div>
            <div class="vaszon-lap"></div>
        </div>`;
    const toolbarEl = container.querySelector('.vaszon-toolbar');
    const lapEl = container.querySelector('.vaszon-lap');

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

    function widgetFejlecHtml(cimke, extra) {
        return `
            <span class="vaszon-widget-cimke">${cimke}</span>
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
                <div class="vaszon-widget-fejlec">${widgetFejlecHtml('🖼️ Kép', `
                    <select class="vaszon-select" title="Megjelenítési méret">
                        ${KEP_MERETEK.map(([v, c]) => `<option value="${v}" ${(aktNode.attrs.meret || '') === v ? 'selected' : ''}>${c}</option>`).join('')}
                    </select>`)}
                </div>
                <div class="vaszon-kep-resz">${kepReszHtml(aktNode.attrs)}</div>`;
            dom.querySelector('.vaszon-select').addEventListener('change', e => attrCsere(editor, getPos, { meret: e.target.value }));
            kossFejlecGombok(dom.querySelector('.vaszon-widget-fejlec'), editor, getPos);
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
            fejlec.innerHTML = widgetFejlecHtml('🖼️📝 Kép + szöveg', `
                <select class="vaszon-select" title="A kép helye">
                    <option value="bal" ${aktNode.attrs.pozicio !== 'jobb' ? 'selected' : ''}>Kép balra</option>
                    <option value="jobb" ${aktNode.attrs.pozicio === 'jobb' ? 'selected' : ''}>Kép jobbra</option>
                </select>`);
            fejlec.querySelector('.vaszon-select').addEventListener('change', e => attrCsere(editor, getPos, { pozicio: e.target.value }));
            kossFejlecGombok(fejlec, editor, getPos);
            grid.classList.toggle('vaszon-kepszoveg-grid--jobb', aktNode.attrs.pozicio === 'jobb');
            kepResz.innerHTML = kepReszHtml(aktNode.attrs);
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
                <div class="vaszon-widget-fejlec">${widgetFejlecHtml('🖼️🖼️ Kép-sor')}</div>
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
        { cmd: 'kep', jel: '🖼️ Kép', tip: 'Kép beszúrása a kurzorhoz' },
        { cmd: 'kepszoveg', jel: '🖼️📝', tip: 'Kép + szöveg beszúrása a kurzorhoz' },
        { cmd: 'galeriasor', jel: '🖼️🖼️', tip: 'Kép-sor beszúrása a kurzorhoz' },
        { elvalaszto: true },
        { cmd: 'undo', jel: '↺', tip: 'Visszavonás (Ctrl+Z)' },
        { cmd: 'redo', jel: '↻', tip: 'Újra (Ctrl+Y)' },
    ];

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
        cserelSzoveg: html => {
            const widgetHtml = parseTartalom(editor.getHTML())
                .filter(l => l.tipus !== 'szoveg')
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
