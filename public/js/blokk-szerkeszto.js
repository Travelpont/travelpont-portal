// =====================================================
// blokk-szerkeszto.js – Blokk-alapú tartalomszerkesztő az Úticélok
// "Bemutató szöveg" mezőjéhez.
//
// Blokkok függőleges listája: 📝 szöveg-blokk (saját Quill-példány) és
// 🖼️ kép-blokk (a Galéria-szekcióban feltöltött fotókból). Fel/le
// mozgatás, törlés, beszúrás bárhova.
//
// A TÁROLT FORMÁTUM VÁLTOZATLAN HTML: a szöveg-blokkok HTML-je + a
// kép-blokkok <img class="tpu-inline-kep" data-id="…"> jelölői, a
// blokkok sorrendjében összefűzve. A WordPress-oldali plugin
// (travelpont-uticelok ≥1.16.1) ezt a jelölőt alakítja keretezett,
// vágásmentes kép-blokká. A blokkosítás tisztán szerkesztő-oldali
// nézet: bármilyen korábbi HTML betölthető (jelölő nélküli tartalom
// egyetlen szöveg-blokk lesz).
// =====================================================

const QUILL_TOOLBAR = [
    [{ header: [2, 3, false] }],
    ['bold', 'italic', 'underline'],
    [{ list: 'ordered' }, { list: 'bullet' }],
    ['blockquote', 'link'],
    ['clean'],
];

// Jelölő-felismerés attribútum-sorrendtől függetlenül (mint a WP-oldalon).
const MARKER_RE = /<img[^>]*\btpu-inline-kep\b[^>]*>/gi;

function markerAttr(tag, name) {
    const m = tag.match(new RegExp(name + '="([^"]*)"', 'i'));
    return m ? m[1] : '';
}

function escapeAttr(s) {
    return (s ?? '').toString().replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * Blokk-szerkesztő létrehozása.
 * @param {Object} opts
 * @param {string} opts.containerId      Üres div, ide épül a szerkesztő.
 * @param {string} opts.initialHtml      A betöltendő tartalom HTML-je.
 * @param {Function} opts.galeriaProvider () => [{id, url, caption}] – mindig a friss galéria.
 * @param {Function} [opts.onUres]       Toast-szerű visszajelzés, ha üres galériából próbálnának képet szúrni.
 * @returns {{getHtml: Function, setHtml: Function, refreshGaleria: Function}}
 */
export function createBlokkSzerkeszto({ containerId, initialHtml, galeriaProvider, onUres }) {
    const container = document.getElementById(containerId);
    if (!container) return null;

    // Quill nélkül (CDN-hiba) egyszerű textarea-fallback, mint a quill-helper-ben.
    if (typeof Quill === 'undefined') {
        container.innerHTML = `<textarea class="input-field" style="min-height:180px;">${initialHtml || ''}</textarea>`;
        const ta = container.querySelector('textarea');
        return {
            getHtml: () => ta.value,
            setHtml: html => { ta.value = html || ''; },
            refreshGaleria: () => {},
        };
    }

    let blocks = []; // { tipus:'szoveg', el, quill } | { tipus:'kep', el, id, url, felirat }

    // ---- HTML → blokkok ----
    function parseHtml(html) {
        const nyers = (html || '').trim();
        const eredmeny = [];
        let utolso = 0;
        for (const m of nyers.matchAll(MARKER_RE)) {
            const elotte = nyers.slice(utolso, m.index).trim()
                .replace(/^<p>\s*<\/p>|<p>\s*<\/p>$/g, ''); // wpautop-maradék üres p-k a széleken
            if (elotte.replace(/<[^>]+>|&nbsp;|\s/g, '') !== '') {
                eredmeny.push({ tipus: 'szoveg', html: elotte });
            }
            eredmeny.push({
                tipus: 'kep',
                id: markerAttr(m[0], 'data-id'),
                url: markerAttr(m[0], 'src'),
                felirat: markerAttr(m[0], 'alt'),
            });
            utolso = m.index + m[0].length;
        }
        const maradek = nyers.slice(utolso).trim();
        if (maradek.replace(/<[^>]+>|&nbsp;|\s/g, '') !== '') {
            eredmeny.push({ tipus: 'szoveg', html: maradek });
        }
        if (!eredmeny.length) eredmeny.push({ tipus: 'szoveg', html: '' });
        return eredmeny;
    }

    // ---- Blokk-DOM építés ----
    function build(leirasok) {
        blocks = [];
        container.innerHTML = '';
        leirasok.forEach(l => appendBlock(makeBlock(l)));
        renderChrome();
    }

    function makeBlock(leiras) {
        const el = document.createElement('div');
        el.className = 'blokk blokk--' + leiras.tipus;

        const fejlec = document.createElement('div');
        fejlec.className = 'blokk-fejlec';
        el.appendChild(fejlec);

        const torzs = document.createElement('div');
        torzs.className = 'blokk-torzs';
        el.appendChild(torzs);

        if (leiras.tipus === 'szoveg') {
            const qEl = document.createElement('div');
            torzs.appendChild(qEl);
            const quill = new Quill(qEl, {
                theme: 'snow',
                placeholder: 'Szöveg…',
                modules: { toolbar: QUILL_TOOLBAR },
            });
            if (leiras.html) quill.clipboard.dangerouslyPasteHTML(leiras.html);
            return { tipus: 'szoveg', el, quill };
        }

        // kép-blokk
        const block = { tipus: 'kep', el, id: leiras.id, url: leiras.url, felirat: leiras.felirat };
        renderKepTorzs(block, torzs);
        return block;
    }

    function renderKepTorzs(block, torzs) {
        // Ha a galéria ismeri az id-t, onnan frissítjük az url/feliratot
        // (feltöltés óta változhatott a felirat).
        const galeria = galeriaProvider() || [];
        const talalat = galeria.find(k => String(k.id) === String(block.id));
        if (talalat) {
            block.url = talalat.url;
            block.felirat = talalat.caption || '';
        }
        torzs.innerHTML = `
            <div class="blokk-kep-elonezet">
                <img src="${escapeAttr(block.url)}" alt="${escapeAttr(block.felirat)}">
                ${block.felirat ? `<div class="blokk-kep-felirat">${escapeAttr(block.felirat)}</div>` : ''}
            </div>`;
    }

    function appendBlock(block, index = blocks.length) {
        blocks.splice(index, 0, block);
        const next = container.children[index] || null;
        container.insertBefore(block.el, next);
    }

    // ---- Blokk-króm (fejléc-gombok + beszúró sávok) újrarajzolása ----
    function renderChrome() {
        blocks.forEach((block, i) => {
            const fejlec = block.el.querySelector('.blokk-fejlec');
            fejlec.innerHTML = `
                <span class="blokk-cimke">${block.tipus === 'kep' ? '🖼️ Kép' : '📝 Szöveg'}</span>
                <span class="blokk-gombok">
                    <button type="button" class="blokk-gomb" data-mit="fel" title="Mozgatás felfelé" ${i === 0 ? 'disabled' : ''}>↑</button>
                    <button type="button" class="blokk-gomb" data-mit="le" title="Mozgatás lefelé" ${i === blocks.length - 1 ? 'disabled' : ''}>↓</button>
                    <button type="button" class="blokk-gomb blokk-gomb--torles" data-mit="torles" title="Blokk törlése">✕</button>
                </span>`;
            fejlec.querySelectorAll('.blokk-gomb').forEach(gomb => {
                gomb.addEventListener('click', () => blokkMuvelet(block, gomb.dataset.mit));
            });

            // Beszúró sáv minden blokk ELÉ (és a végére, lásd lent).
            ensureBeszuro(block.el, i);
        });
        ensureBeszuro(null, blocks.length); // záró beszúró a lista végén
        // Fölösleges (árva) beszúrók eltakarítása
        container.querySelectorAll('.blokk-beszuro').forEach(b => {
            const idx = parseInt(b.dataset.index, 10);
            if (idx > blocks.length) b.remove();
        });
    }

    function ensureBeszuro(blokkEl, index) {
        // Egy beszúró sáv: "+ Szöveg | + Kép" — a blokk elé (vagy a lista végére).
        let beszuro = blokkEl
            ? (blokkEl.previousElementSibling?.classList?.contains('blokk-beszuro') ? blokkEl.previousElementSibling : null)
            : (container.lastElementChild?.classList?.contains('blokk-beszuro') ? container.lastElementChild : null);
        if (!beszuro) {
            beszuro = document.createElement('div');
            beszuro.className = 'blokk-beszuro';
            beszuro.innerHTML = `
                <button type="button" class="blokk-beszuro-gomb" data-mit="szoveg">+ 📝 Szöveg</button>
                <button type="button" class="blokk-beszuro-gomb" data-mit="kep">+ 🖼️ Kép</button>`;
            container.insertBefore(beszuro, blokkEl);
            beszuro.querySelectorAll('.blokk-beszuro-gomb').forEach(gomb => {
                gomb.addEventListener('click', () => beszuras(beszuro, gomb.dataset.mit));
            });
        }
        beszuro.dataset.index = index;
    }

    function beszuras(beszuro, tipus) {
        const index = parseInt(beszuro.dataset.index, 10);
        if (tipus === 'szoveg') {
            const block = makeBlock({ tipus: 'szoveg', html: '' });
            blocks.splice(index, 0, block);
            container.insertBefore(block.el, beszuro.nextElementSibling);
            rebuildDom();
            block.quill.focus();
            return;
        }
        // kép: galéria-választó
        const galeria = galeriaProvider() || [];
        if (!galeria.length) {
            if (onUres) onUres();
            return;
        }
        nyitKepValaszto(beszuro, kep => {
            const block = makeBlock({ tipus: 'kep', id: kep.id, url: kep.url, felirat: kep.caption || '' });
            blocks.splice(index, 0, block);
            rebuildDom();
        });
    }

    function nyitKepValaszto(hova, kivalaszt) {
        zarKepValaszto();
        const galeria = galeriaProvider() || [];
        const panel = document.createElement('div');
        panel.className = 'blokk-kepvalaszto';
        panel.innerHTML = `
            <div class="input-hint" style="margin-bottom:8px;">Kattints a beszúrandó képre:</div>
            <div class="crud-gallery-grid">
                ${galeria.map(k => `
                    <div class="crud-gallery-item crud-gallery-item--valaszthato" data-id="${k.id}" style="cursor:pointer;">
                        <div class="crud-gallery-thumb"><img src="${escapeAttr(k.url)}"></div>
                        ${k.caption ? `<div class="blokk-kep-felirat">${escapeAttr(k.caption)}</div>` : ''}
                    </div>`).join('')}
            </div>
            <button type="button" class="blokk-gomb" style="margin-top:8px;" data-mit="megse">Mégse</button>`;
        hova.after(panel);
        panel.querySelectorAll('.crud-gallery-item--valaszthato').forEach(el => {
            el.addEventListener('click', () => {
                const kep = galeria.find(k => String(k.id) === el.dataset.id);
                zarKepValaszto();
                if (kep) kivalaszt(kep);
            });
        });
        panel.querySelector('[data-mit="megse"]').addEventListener('click', zarKepValaszto);
    }

    function zarKepValaszto() {
        container.querySelectorAll('.blokk-kepvalaszto').forEach(p => p.remove());
    }

    function blokkMuvelet(block, mit) {
        const i = blocks.indexOf(block);
        if (mit === 'torles') {
            const nemUres = block.tipus === 'szoveg' && block.quill.getText().trim() !== '';
            if (nemUres && !confirm('Biztosan törlöd ezt a szöveg-blokkot?')) return;
            blocks.splice(i, 1);
            if (!blocks.length) blocks.push(makeBlock({ tipus: 'szoveg', html: '' }));
        } else if (mit === 'fel' && i > 0) {
            [blocks[i - 1], blocks[i]] = [blocks[i], blocks[i - 1]];
        } else if (mit === 'le' && i < blocks.length - 1) {
            [blocks[i], blocks[i + 1]] = [blocks[i + 1], blocks[i]];
        } else {
            return;
        }
        rebuildDom();
    }

    // A blokk-elemek újrarendezése a blocks tömb szerint. A Quill-példányok
    // DOM-elemei áthelyeződnek, nem épülnek újra — a Quill ezt tűri.
    function rebuildDom() {
        zarKepValaszto();
        container.querySelectorAll('.blokk-beszuro').forEach(b => b.remove());
        blocks.forEach(block => container.appendChild(block.el));
        renderChrome();
    }

    // ---- Publikus API ----
    function getHtml() {
        return blocks.map(block => {
            if (block.tipus === 'kep') {
                return `<img class="tpu-inline-kep" data-id="${escapeAttr(block.id)}" src="${escapeAttr(block.url)}" alt="${escapeAttr(block.felirat)}">`;
            }
            const html = block.quill.root.innerHTML;
            return block.quill.getText().trim() === '' ? '' : html;
        }).join('');
    }

    function setHtml(html) {
        build(parseHtml(html));
    }

    function refreshGaleria() {
        blocks.forEach(block => {
            if (block.tipus === 'kep') {
                renderKepTorzs(block, block.el.querySelector('.blokk-torzs'));
            }
        });
    }

    build(parseHtml(initialHtml));

    return { getHtml, setHtml, refreshGaleria };
}
