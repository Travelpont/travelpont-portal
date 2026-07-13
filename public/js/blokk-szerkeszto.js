// =====================================================
// blokk-szerkeszto.js – Blokk-alapú tartalomszerkesztő az Úticélok
// "Bemutató szöveg" mezőjéhez.
//
// Blokkok függőleges listája:
//   📝 szöveg          – saját Quill-példány blokkonként
//   🖼️ kép             – galéria-fotó, választható megjelenítési mérettel
//   🖼️📝 kép + szöveg   – kép az egyik oldalon, szöveg mellette
//   🖼️🖼️ kép-sor        – 2-3 galéria-fotó egymás mellett
//
// Műveletek: fel/le gombok, drag & drop (a blokk fejlécénél fogva),
// duplikálás, törlés visszavonás-lehetőséggel, beszúró sávok a blokkok
// között. A kép-blokkok a Galéria-szekcióban feltöltött fotókból
// választanak; ha egy kép már nincs a galériában, a blokk jelzi.
//
// A TÁROLT FORMÁTUM SIMA HTML (lásd tpu-format.js) — a blokkosítás
// tisztán szerkesztő-oldali nézet, bármilyen korábbi HTML betölthető.
// A WordPress-oldali plugin (travelpont-uticelok ≥1.17.0) ugyanezt a
// formátumot alakítja végleges, keretezett kép-blokkokká.
//
// ÖKÖLSZABÁLY (egyszer már megharapott minket): Quill-be tartalmat csak
// a dokumentumhoz MÁR CSATOLT elemen szabad betölteni — a beillesztés
// getComputedStyle-lal ismeri fel a blokk-elemeket (címsor, lista), ami
// leválasztott elemen üreset ad, és a formázás elveszne. Ezért a blokk
// törzse (Quill + tartalom) mindig a DOM-hoz csatolás UTÁN töltődik fel
// (fillBlock a rebuildDom végén).
// =====================================================

import { parseTartalom, leirasHtml, uresSzoveg, escapeHtml, escapeAttr } from './tpu-format.js';

const QUILL_TOOLBAR = [
    [{ header: [2, 3, false] }],
    ['bold', 'italic', 'underline'],
    [{ list: 'ordered' }, { list: 'bullet' }],
    ['blockquote', 'link'],
    ['clean'],
];

const BLOKK_CIMKEK = {
    szoveg: '📝 Szöveg',
    kep: '🖼️ Kép',
    kepszoveg: '🖼️📝 Kép + szöveg',
    galeriasor: '🖼️🖼️ Kép-sor',
};

const KEP_MERETEK = [
    ['', 'Normál (középre igazítva)'],
    ['teljes', 'Teljes szélesség'],
    ['kicsi', 'Kicsi'],
];

const SOR_MAX_KEP = 3;

/**
 * Blokk-szerkesztő létrehozása.
 * @param {Object} opts
 * @param {string} opts.containerId       Üres div, ide épül a szerkesztő.
 * @param {string} opts.initialHtml       A betöltendő tartalom HTML-je.
 * @param {Function} opts.galeriaProvider () => [{id, url, caption}] – mindig a friss galéria.
 * @param {Function} [opts.onUres]        Visszajelzés, ha üres galériából próbálnának képet szúrni.
 * @param {Function} [opts.onChange]      Minden felhasználói módosításkor hívódik (dirty-követéshez).
 * @returns {{getHtml, setHtml, cserelSzoveg, refreshGaleria}}
 */
export function createBlokkSzerkeszto({ containerId, initialHtml, galeriaProvider, onUres, onChange }) {
    const container = document.getElementById(containerId);
    if (!container) return null;

    // Quill nélkül (CDN-hiba) egyszerű textarea-fallback, hogy a tartalom
    // legalább szerkeszthető maradjon. A .value property-n keresztül töltünk,
    // így nincs HTML-escape gond.
    if (typeof Quill === 'undefined') {
        container.innerHTML = '<textarea class="input-field" style="min-height:180px;"></textarea>';
        const ta = container.querySelector('textarea');
        ta.value = initialHtml || '';
        ta.addEventListener('input', () => { if (onChange) onChange(); });
        return {
            getHtml: () => ta.value,
            setHtml: html => { ta.value = html || ''; },
            cserelSzoveg: html => { ta.value = html || ''; },
            refreshGaleria: () => {},
        };
    }

    // Egy blokk = blokk-leírás (lásd tpu-format.js) + futásidejű mezők:
    // el (gyökér-div), quill (szöveges típusoknál), _html (a Quill
    // feltöltéséig őrzött kezdő tartalom), _kesz (a törzs feltöltve-e).
    let blocks = [];
    let huzott = null; // az éppen drag & droppal mozgatott blokk

    const jelez = () => { if (onChange) onChange(); };

    function blockByEl(el) {
        return blocks.find(b => b.el === el) || null;
    }

    // ---- Esemény-delegáció: minden gomb-kattintás egyetlen listenerben ----
    container.addEventListener('click', e => {
        const gomb = e.target.closest('button[data-mit]');
        if (!gomb) return;
        const mit = gomb.dataset.mit;

        const beszuro = gomb.closest('.blokk-beszuro');
        if (beszuro) { beszuras(beszuro, mit); return; }

        if (mit === 'megse') { zarKepValaszto(); return; }

        const block = blockByEl(gomb.closest('.blokk'));
        if (!block) return;
        if (mit === 'fel') mozgatas(block, -1);
        else if (mit === 'le') mozgatas(block, 1);
        else if (mit === 'torles') torles(block);
        else if (mit === 'duplikalas') duplikalas(block);
        else if (mit === 'sor-kep-hozzaad') sorKepHozzaad(block);
        else if (mit === 'sor-kep-torles') sorKepTorles(block, gomb.dataset.id);
    });

    // ---- Drag & drop a blokk fejlécénél fogva ----
    container.addEventListener('dragstart', e => {
        const fejlec = e.target.closest('.blokk-fejlec');
        if (!fejlec) return; // pl. szöveg-kijelölés húzása a Quillben — nem a miénk
        huzott = blockByEl(fejlec.closest('.blokk'));
        if (!huzott) return;
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', ''); } catch { /* régi böngésző */ }
        huzott.el.classList.add('blokk--huzott');
    });
    container.addEventListener('dragover', e => {
        if (!huzott) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        torolDropJelzest();
        const cel = e.target.closest('.blokk');
        if (!cel || blockByEl(cel) === huzott) return;
        const r = cel.getBoundingClientRect();
        cel.classList.add((e.clientY - r.top) < r.height / 2 ? 'blokk--drop-ele' : 'blokk--drop-utan');
    });
    container.addEventListener('drop', e => {
        if (!huzott) return;
        e.preventDefault();
        const hova = dropHely(e);
        torolDropJelzest();
        if (hova === null) return;
        const innen = blocks.indexOf(huzott);
        let cel = hova;
        blocks.splice(innen, 1);
        if (cel > innen) cel--;
        blocks.splice(cel, 0, huzott);
        rebuildDom();
        jelez();
    });
    container.addEventListener('dragend', () => {
        if (huzott) huzott.el.classList.remove('blokk--huzott');
        torolDropJelzest();
        huzott = null;
    });

    function dropHely(e) {
        const cel = e.target.closest('.blokk');
        if (cel) {
            const block = blockByEl(cel);
            if (!block || block === huzott) return null;
            const r = cel.getBoundingClientRect();
            return blocks.indexOf(block) + ((e.clientY - r.top) < r.height / 2 ? 0 : 1);
        }
        const beszuro = e.target.closest('.blokk-beszuro');
        return beszuro ? parseInt(beszuro.dataset.index, 10) : null;
    }

    function torolDropJelzest() {
        container.querySelectorAll('.blokk--drop-ele, .blokk--drop-utan')
            .forEach(el => el.classList.remove('blokk--drop-ele', 'blokk--drop-utan'));
    }

    // ---- Blokk-DOM építés ----
    function build(leirasok) {
        container.innerHTML = '';
        blocks = leirasok.map(makeBlock);
        rebuildDom();
    }

    // Csak a blokk vázát építi (fejléc + üres törzs) — a tartalom a
    // DOM-csatolás után kerül bele (fillBlock), lásd a fejléc-kommentet.
    function makeBlock(leiras) {
        const el = document.createElement('div');
        el.className = 'blokk blokk--' + leiras.tipus;
        el.innerHTML = '<div class="blokk-fejlec"></div><div class="blokk-torzs"></div>';
        return { ...leiras, el, quill: null, _html: leiras.html || '', _kesz: false };
    }

    // A blokk-elemek újrarendezése a blocks tömb szerint. A meglévő
    // Quill-példányok DOM-elemei áthelyeződnek, nem épülnek újra — a
    // Quill ezt tűri. Az új (üres törzsű) blokkok a csatolás után töltődnek.
    function rebuildDom() {
        zarKepValaszto();
        container.querySelectorAll('.blokk-beszuro').forEach(b => b.remove());
        blocks.forEach(block => container.appendChild(block.el));
        blocks.forEach(fillBlock);
        renderChrome();
    }

    // Idempotens: csak az első hívás tölti fel a blokk törzsét.
    function fillBlock(block) {
        if (block._kesz) return;
        block._kesz = true;
        const torzs = block.el.querySelector('.blokk-torzs');

        if (block.tipus === 'szoveg') {
            block.quill = ujQuill(torzs, block._html);

        } else if (block.tipus === 'kep') {
            torzs.innerHTML = `
                <div class="blokk-kep-elonezet"></div>
                <div class="blokk-opciok">
                    <span>Megjelenés:</span>
                    <select class="input-field">
                        ${KEP_MERETEK.map(([v, cimke]) =>
                            `<option value="${v}" ${(block.kep.meret || '') === v ? 'selected' : ''}>${cimke}</option>`).join('')}
                    </select>
                </div>`;
            torzs.querySelector('select').addEventListener('change', e => {
                block.kep.meret = e.target.value;
                jelez();
            });
            frissitElonezet(block);

        } else if (block.tipus === 'kepszoveg') {
            torzs.innerHTML = `
                <div class="blokk-opciok">
                    <span>Kép helye:</span>
                    <select class="input-field">
                        <option value="bal" ${block.pozicio !== 'jobb' ? 'selected' : ''}>Kép balra, szöveg jobbra</option>
                        <option value="jobb" ${block.pozicio === 'jobb' ? 'selected' : ''}>Kép jobbra, szöveg balra</option>
                    </select>
                </div>
                <div class="blokk-kepszoveg-grid${block.pozicio === 'jobb' ? ' blokk-kepszoveg-grid--jobb' : ''}">
                    <div class="blokk-kep-elonezet"></div>
                    <div class="blokk-kepszoveg-szoveg"></div>
                </div>
                <div class="input-hint" style="padding:0 10px 10px;">Élesben a kép és a szöveg egymás mellett jelenik meg — nagyon rövid szöveg mellett üres tér maradhat, oda inkább sima kép-blokk való.</div>`;
            torzs.querySelector('.blokk-opciok select').addEventListener('change', e => {
                block.pozicio = e.target.value;
                torzs.querySelector('.blokk-kepszoveg-grid')
                    .classList.toggle('blokk-kepszoveg-grid--jobb', block.pozicio === 'jobb');
                jelez();
            });
            block.quill = ujQuill(torzs.querySelector('.blokk-kepszoveg-szoveg'), block._html);
            frissitElonezet(block);

        } else if (block.tipus === 'galeriasor') {
            frissitElonezet(block); // a teljes törzset rajzolja (nincs Quill benne)
        }
    }

    function ujQuill(hova, html) {
        const qEl = document.createElement('div');
        hova.appendChild(qEl);
        const quill = new Quill(qEl, {
            theme: 'snow',
            placeholder: 'Szöveg…',
            modules: { toolbar: QUILL_TOOLBAR },
        });
        if (html) quill.clipboard.dangerouslyPasteHTML(html);
        quill.on('text-change', (delta, elozo, forras) => { if (forras === 'user') jelez(); });
        return quill;
    }

    // ---- Kép-előnézetek (galéria-szinkronnal + hiányzó-kép jelzéssel) ----
    function szinkronKep(kep) {
        const galeria = galeriaProvider() || [];
        const talalat = galeria.find(k => String(k.id) === String(kep.id));
        if (talalat) {
            kep.url = talalat.url;
            kep.felirat = talalat.caption || '';
            kep.hianyzik = false;
        } else {
            kep.hianyzik = true;
        }
    }

    function kepElonezetHtml(kep) {
        return `
            <img src="${escapeAttr(kep.url)}" alt="${escapeAttr(kep.felirat)}">
            ${kep.felirat ? `<div class="blokk-kep-felirat">${escapeHtml(kep.felirat)}</div>` : ''}
            ${kep.hianyzik ? '<div class="blokk-kep-hiba">⚠️ Ez a kép már nincs a Galériában. Élesben egyelőre megjelenik, de érdemes törölni vagy másikra cserélni.</div>' : ''}`;
    }

    // A blokk kép-előnézetének frissítése. Quill-t tartalmazó blokknál CSAK
    // az előnézet-részt írjuk újra, a szerkesztőhöz nem nyúlunk.
    function frissitElonezet(block) {
        if (block.tipus === 'kep' || block.tipus === 'kepszoveg') {
            szinkronKep(block.kep);
            block.el.querySelector('.blokk-kep-elonezet').innerHTML = kepElonezetHtml(block.kep);
        } else if (block.tipus === 'galeriasor') {
            block.kepek.forEach(szinkronKep);
            block.el.querySelector('.blokk-torzs').innerHTML = `
                <div class="blokk-galeriasor">
                    ${block.kepek.map(k => `
                        <div class="blokk-galeriasor-kep" title="${escapeAttr(k.felirat)}">
                            <img src="${escapeAttr(k.url)}">
                            <button type="button" class="blokk-gomb blokk-gomb--torles blokk-galeriasor-torles" data-mit="sor-kep-torles" data-id="${escapeAttr(k.id)}" title="Kép kivétele a sorból">✕</button>
                            ${k.hianyzik ? '<div class="blokk-kep-hiba">⚠️ nincs a Galériában</div>' : ''}
                        </div>`).join('')}
                    ${block.kepek.length < SOR_MAX_KEP ? '<button type="button" class="blokk-galeriasor-add" data-mit="sor-kep-hozzaad" title="Kép hozzáadása a sorhoz">+</button>' : ''}
                </div>
                <div class="input-hint" style="padding:0 10px 10px;">2–3 kép fér el jól egy sorban; élesben egymás mellett jelennek meg, vágás nélkül.</div>`;
        }
    }

    // ---- Blokk-króm: fejléc-gombok + beszúró sávok (minden újrarendezésnél frissül) ----
    function renderChrome() {
        blocks.forEach((block, i) => {
            const fejlec = block.el.querySelector('.blokk-fejlec');
            fejlec.setAttribute('draggable', 'true');
            fejlec.title = 'Fogd meg és húzd az átrendezéshez';
            fejlec.innerHTML = `
                <span class="blokk-cimke">${BLOKK_CIMKEK[block.tipus] || block.tipus}</span>
                <span class="blokk-gombok">
                    <button type="button" class="blokk-gomb" data-mit="duplikalas" title="Blokk duplikálása">⧉</button>
                    <button type="button" class="blokk-gomb" data-mit="fel" title="Mozgatás felfelé" ${i === 0 ? 'disabled' : ''}>↑</button>
                    <button type="button" class="blokk-gomb" data-mit="le" title="Mozgatás lefelé" ${i === blocks.length - 1 ? 'disabled' : ''}>↓</button>
                    <button type="button" class="blokk-gomb blokk-gomb--torles" data-mit="torles" title="Blokk törlése">✕</button>
                </span>`;
            container.insertBefore(ujBeszuro(i), block.el);
        });
        container.appendChild(ujBeszuro(blocks.length));
    }

    function ujBeszuro(index) {
        const b = document.createElement('div');
        b.className = 'blokk-beszuro';
        b.dataset.index = index;
        b.innerHTML = `
            <button type="button" class="blokk-beszuro-gomb" data-mit="szoveg">+ 📝 Szöveg</button>
            <button type="button" class="blokk-beszuro-gomb" data-mit="kep">+ 🖼️ Kép</button>
            <button type="button" class="blokk-beszuro-gomb" data-mit="kepszoveg">+ 🖼️📝 Kép + szöveg</button>
            <button type="button" class="blokk-beszuro-gomb" data-mit="galeriasor">+ 🖼️🖼️ Kép-sor</button>`;
        return b;
    }

    // ---- Műveletek ----
    function beszuras(beszuro, tipus) {
        const index = parseInt(beszuro.dataset.index, 10);
        if (tipus === 'szoveg') {
            const block = makeBlock({ tipus: 'szoveg', html: '' });
            blocks.splice(index, 0, block);
            rebuildDom();
            jelez();
            block.quill.focus();
            return;
        }
        valasszKepet(beszuro, kep => {
            let leiras;
            if (tipus === 'kep') leiras = { tipus: 'kep', kep };
            else if (tipus === 'kepszoveg') leiras = { tipus: 'kepszoveg', kep, pozicio: 'bal', html: '' };
            else leiras = { tipus: 'galeriasor', kepek: [kep] };
            const block = makeBlock(leiras);
            blocks.splice(index, 0, block);
            rebuildDom();
            jelez();
            if (block.quill) block.quill.focus();
        });
    }

    function mozgatas(block, irany) {
        const i = blocks.indexOf(block);
        const j = i + irany;
        if (i === -1 || j < 0 || j >= blocks.length) return;
        [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
        rebuildDom();
        jelez();
    }

    // Törlés confirm helyett visszavonási lehetőséggel: a blokk tárolt
    // HTML-jét őrizzük meg, visszavonáskor abból építjük újra.
    function torles(block) {
        const i = blocks.indexOf(block);
        if (i === -1) return;
        const html = leirasHtml(toLeiras(block));
        blocks.splice(i, 1);
        if (!blocks.length) blocks.push(makeBlock({ tipus: 'szoveg', html: '' }));
        rebuildDom();
        jelez();
        if (html !== '') {
            undoToast('Blokk törölve.', () => {
                const ujak = parseTartalom(html).map(makeBlock);
                blocks.splice(Math.min(i, blocks.length), 0, ...ujak);
                rebuildDom();
                jelez();
            });
        }
    }

    function duplikalas(block) {
        const i = blocks.indexOf(block);
        if (i === -1) return;
        const html = leirasHtml(toLeiras(block));
        const leirasok = html === '' ? [{ tipus: 'szoveg', html: '' }] : parseTartalom(html);
        blocks.splice(i + 1, 0, ...leirasok.map(makeBlock));
        rebuildDom();
        jelez();
    }

    function sorKepHozzaad(block) {
        if (block.kepek.length >= SOR_MAX_KEP) return;
        valasszKepet(block.el, kep => {
            block.kepek.push(kep);
            frissitElonezet(block);
            jelez();
        });
    }

    function sorKepTorles(block, id) {
        const marad = block.kepek.filter(k => String(k.id) !== String(id));
        if (!marad.length) { torles(block); return; } // az utolsó kép kivétele = a blokk törlése (visszavonható)
        block.kepek = marad;
        frissitElonezet(block);
        jelez();
    }

    // ---- Kép-választó popover ----
    function valasszKepet(hova, kivalaszt) {
        const galeria = galeriaProvider() || [];
        if (!galeria.length) {
            if (onUres) onUres();
            return;
        }
        zarKepValaszto();
        const panel = document.createElement('div');
        panel.className = 'blokk-kepvalaszto';
        panel.innerHTML = `
            <div class="input-hint" style="margin-bottom:8px;">Kattints a beszúrandó képre:</div>
            <div class="crud-gallery-grid">
                ${galeria.map(k => `
                    <div class="crud-gallery-item crud-gallery-item--valaszthato" data-id="${escapeAttr(k.id)}" style="cursor:pointer;">
                        <div class="crud-gallery-thumb"><img src="${escapeAttr(k.url)}"></div>
                        ${k.caption ? `<div class="blokk-kep-felirat">${escapeHtml(k.caption)}</div>` : ''}
                    </div>`).join('')}
            </div>
            <button type="button" class="blokk-gomb" style="margin-top:8px;" data-mit="megse">Mégse</button>`;
        hova.after(panel);
        panel.querySelectorAll('.crud-gallery-item--valaszthato').forEach(el => {
            el.addEventListener('click', () => {
                const k = galeria.find(g => String(g.id) === el.dataset.id);
                zarKepValaszto();
                if (k) kivalaszt({ id: k.id, url: k.url, felirat: k.caption || '', meret: '' });
            });
        });
    }

    function zarKepValaszto() {
        container.querySelectorAll('.blokk-kepvalaszto').forEach(p => p.remove());
    }

    // ---- Visszavonás-toast (a portal.css .toast osztályaira épül) ----
    function undoToast(uzenet, onUndo) {
        const tarolo = document.getElementById('toastContainer');
        if (!tarolo) return;
        const el = document.createElement('div');
        el.className = 'toast info toast--undo';
        const szoveg = document.createElement('span');
        szoveg.textContent = uzenet;
        const gomb = document.createElement('button');
        gomb.type = 'button';
        gomb.className = 'toast-undo-gomb';
        gomb.textContent = 'Visszavonás';
        gomb.addEventListener('click', () => { el.remove(); onUndo(); });
        el.append(szoveg, gomb);
        tarolo.appendChild(el);
        setTimeout(() => el.remove(), 7000);
    }

    // ---- Szerializálás ----
    // Blokk → tiszta leírás: a szöveges típusoknál a Quill élő tartalmát vesszük.
    function toLeiras(block) {
        const szoveg = block.quill
            ? (block.quill.getText().trim() === '' ? '' : block.quill.root.innerHTML)
            : (block._html || '');
        switch (block.tipus) {
            case 'kep': return { tipus: 'kep', kep: block.kep };
            case 'galeriasor': return { tipus: 'galeriasor', kepek: block.kepek };
            case 'kepszoveg': return { tipus: 'kepszoveg', kep: block.kep, pozicio: block.pozicio, html: szoveg };
            default: return { tipus: 'szoveg', html: szoveg };
        }
    }

    // ---- Publikus API ----
    function getHtml() {
        return blocks.map(b => leirasHtml(toLeiras(b))).join('');
    }

    function setHtml(html) {
        build(parseTartalom(html));
    }

    // AI-tól (vagy más programtól) érkező szöveg: a szöveg-blokkokat cseréli,
    // a kép-alapú blokkokat (kép, kép-sor, kép+szöveg) a végére megtartja.
    function cserelSzoveg(html) {
        const kepHtml = blocks
            .filter(b => b.tipus !== 'szoveg')
            .map(b => leirasHtml(toLeiras(b)))
            .join('');
        build(parseTartalom((html || '') + kepHtml));
    }

    function refreshGaleria() {
        blocks.forEach(block => {
            if (block.tipus !== 'szoveg') frissitElonezet(block);
        });
    }

    build(parseTartalom(initialHtml));

    return { getHtml, setHtml, cserelSzoveg, refreshGaleria };
}
