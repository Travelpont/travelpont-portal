// =====================================================
// elonezet.js – "Élő" előnézet az Úticélok Bemutató szövegéhez
//
// A WordPress-oldali megjelenítés KÖZELÍTŐ tükrözése a Portálon belül:
// a kép-jelölőket ugyanúgy keretezett <figure>-ré alakítja, mint a
// travelpont-uticelok plugin (szoveg-kepek.php), a szövegben fel nem
// használt galéria-képek mozaikja pedig a szerkesztő által elhelyezett
// 📷 fotó-mozaik helyjelzőnél jelenik meg (helyjelző nélkül sehol —
// mint élesben). A stílusok a portal.css .tpu-elonezet szekciójában élnek, a
// plugin frontend.css-ének fényvilágát követve (fehér lap, 16:9 contain,
// SOSEM vág). Nem pixelpontos — arra való, hogy mentés előtt látsszon a
// szerkezet és a képek helye.
// =====================================================

import { markerRe, markerAttr, escapeHtml, escapeAttr } from './tpu-format.js';

/**
 * Előnézet-modal megnyitása.
 * @param {Object} opts
 * @param {string} opts.title       Az úticél címe.
 * @param {string} opts.leiras      Rövid leíró szöveg (teaser).
 * @param {string} opts.contentHtml A tárolt tartalom-HTML (jelölőkkel).
 * @param {Array}  opts.galeria     [{id, url, caption}] – a teljes galéria.
 */
export function showElonezet({ title, leiras, contentHtml, galeria }) {
    const kepek = galeria || [];
    const hasznalt = new Set();

    // Jelölő → figure, mint a WP-oldalon (tpu_kep_blokk_figure).
    function figureHtml(tag) {
        const id = markerAttr(tag, 'data-id');
        hasznalt.add(String(id));
        const g = kepek.find(k => String(k.id) === String(id));
        const url = g ? g.url : markerAttr(tag, 'src');
        const felirat = g ? (g.caption || '') : markerAttr(tag, 'alt');
        const meret = markerAttr(tag, 'data-meret');
        const cls = 'tpu-kep-blokk' + ((meret === 'teljes' || meret === 'kicsi') ? ` tpu-kep-blokk--${meret}` : '');
        return `<figure class="${cls}"><img src="${escapeAttr(url)}" alt="${escapeAttr(felirat)}">`
            + (felirat ? `<figcaption>${escapeHtml(felirat)}</figcaption>` : '')
            + '</figure>';
    }

    let tartalom = (contentHtml || '').replace(markerRe(), figureHtml);

    // Fotó-mozaik a helyjelzőnél (az első előfordulásnál; a többi eltűnik).
    const maradek = kepek.filter(k => !hasznalt.has(String(k.id)));
    const mozaikHtml = maradek.length ? `
        <div class="tpu-elonezet-mozaik">
            ${maradek.map(k => `
                <div class="tpu-elonezet-csempe">
                    <img src="${escapeAttr(k.url)}">
                    ${k.caption ? `<span>${escapeHtml(k.caption)}</span>` : ''}
                </div>`).join('')}
        </div>` : '';
    let voltMozaik = false;
    tartalom = tartalom.replace(/<div[^>]*\btpu-fotomozaik\b[^>]*>\s*<\/div>/gi, () => {
        if (voltMozaik) return '';
        voltMozaik = true;
        return mozaikHtml;
    });

    const overlay = document.createElement('div');
    overlay.className = 'elonezet-overlay';
    overlay.innerHTML = `
        <div class="elonezet-lap">
            <div class="elonezet-fejlec">
                <span>👁️ Közelítő előnézet — a betűk/színek élesben kicsit eltérhetnek</span>
                <button type="button" class="elonezet-bezar" title="Bezárás (Esc)">✕</button>
            </div>
            <div class="elonezet-tartalom tpu-elonezet">
                <h1>${escapeHtml(title || '(cím nélkül)')}</h1>
                ${leiras ? `<p class="tpu-elonezet-lead">${escapeHtml(leiras)}</p>` : ''}
                ${tartalom}
            </div>
        </div>`;

    function zar() {
        overlay.remove();
        document.removeEventListener('keydown', esc);
    }
    function esc(e) {
        if (e.key === 'Escape') zar();
    }
    overlay.addEventListener('click', e => { if (e.target === overlay) zar(); });
    overlay.querySelector('.elonezet-bezar').addEventListener('click', zar);
    document.addEventListener('keydown', esc);
    document.body.appendChild(overlay);
}
