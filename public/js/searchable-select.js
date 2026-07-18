// =====================================================
// searchable-select.js – Gépelős, kereshető legördülő (combobox)
//
// Nagy (200+ elemű) hierarchikus úticél-listákhoz: a felhasználó gépel, a
// találati lista azonnal szűkül (ékezet-érzéketlen, a teljes címkére – így az
// "Ország › Régió › Város" bármelyik szintjére – keres). Kiválasztáskor a
// LÁTHATÓ input a címkét mutatja, egy REJTETT input pedig a valódi ID-t tárolja,
// amit a mentés-logika változatlanul olvas (document.getElementById(hiddenId).value).
//
// Nincs külső függőség; a Portál sötét témájához a portal.css .ss-* szabályai
// adják a megjelenést.
// =====================================================

function esc(s) {
    return (s ?? '').toString().replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// Ékezet- és kisbetű-független normalizálás a kereséshez (Stájerország → stajerorszag)
function norm(s) {
    return (s ?? '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * @param {HTMLElement} mountEl  Üres konténer, ide épül a komponens.
 * @param {Object} opts
 *   options    {Array<{id, label}>}  a választható elemek
 *   selectedId {string|number}       a kezdetben kiválasztott ID ('' = nincs)
 *   hiddenId   {string}              a rejtett <input> id-je (ezt olvassa a mentés)
 *   placeholder{string}
 *   emptyLabel {string}              a "nincs kiválasztva" elem címkéje
 *   onSelect   {function(id, label)} opcionális – a FELHASZNÁLÓI választáskor fut
 *                                    (init/blur-visszaálláskor nem), pl. társmezők
 *                                    automatikus kitöltéséhez
 * @returns {{ getValue, setValue, destroy, getEl }}
 */
export function createSearchableSelect(mountEl, opts = {}) {
    const options     = Array.isArray(opts.options) ? opts.options : [];
    const hiddenId    = opts.hiddenId || '';
    const placeholder = opts.placeholder || 'Kezdj gépelni a kereséshez…';
    const emptyLabel  = opts.emptyLabel || '— nincs kiválasztva —';

    // A választható elemek: az "üres" (ID='') elem legelöl, majd az átadottak.
    const items = [{ id: '', label: emptyLabel }].concat(
        options.map(o => ({ id: String(o.id), label: String(o.label ?? '') }))
    );

    let value      = (opts.selectedId === undefined || opts.selectedId === null) ? '' : String(opts.selectedId);
    let open        = false;
    let filtered    = items;
    let activeIndex = 0;

    mountEl.classList.add('ss-wrap');
    mountEl.innerHTML =
        `<input type="text" class="ss-input" role="combobox" aria-expanded="false" autocomplete="off" placeholder="${esc(placeholder)}">` +
        `<input type="hidden"${hiddenId ? ` id="${esc(hiddenId)}"` : ''}>` +
        `<div class="ss-menu" hidden></div>`;

    const input  = mountEl.querySelector('.ss-input');
    const hidden = mountEl.querySelector('input[type="hidden"]');
    const menu   = mountEl.querySelector('.ss-menu');

    function labelFor(id) {
        const found = items.find(it => it.id === String(id));
        return found ? found.label : '';
    }

    function applyValue(id) {
        value = String(id);
        hidden.value = value;                       // '' az "üres" elemnél
        input.value  = value === '' ? '' : labelFor(value);
    }

    function renderMenu() {
        if (!filtered.length) {
            menu.innerHTML = `<div class="ss-empty">Nincs találat</div>`;
            return;
        }
        menu.innerHTML = filtered.map((it, i) =>
            `<div class="ss-item${i === activeIndex ? ' ss-item--active' : ''}" data-id="${esc(it.id)}" data-i="${i}">${esc(it.label)}</div>`
        ).join('');
    }

    function filter(query) {
        const q = norm(query.trim());
        filtered = q === '' ? items : items.filter(it => it.id === '' || norm(it.label).includes(q));
        activeIndex = filtered.findIndex(it => it.id !== '');
        if (activeIndex < 0) activeIndex = 0;
        renderMenu();
    }

    function openMenu() {
        open = true;
        menu.hidden = false;
        input.setAttribute('aria-expanded', 'true');
        renderMenu();
    }

    function closeMenu() {
        open = false;
        menu.hidden = true;
        input.setAttribute('aria-expanded', 'false');
    }

    function pick(i) {
        const it = filtered[i];
        if (!it) return;
        applyValue(it.id);
        closeMenu();
        input.blur();
        if (typeof opts.onSelect === 'function') opts.onSelect(it.id, it.label);
    }

    // ── Események ─────────────────────────────────────────────────────────────
    input.addEventListener('focus', () => { input.value = ''; filter(''); openMenu(); });

    input.addEventListener('input', () => { filter(input.value); if (!open) openMenu(); });

    input.addEventListener('keydown', e => {
        if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { filter(input.value); openMenu(); return; }
        if (e.key === 'ArrowDown')      { e.preventDefault(); activeIndex = Math.min(activeIndex + 1, filtered.length - 1); renderMenu(); scrollActive(); }
        else if (e.key === 'ArrowUp')   { e.preventDefault(); activeIndex = Math.max(activeIndex - 1, 0); renderMenu(); scrollActive(); }
        else if (e.key === 'Enter')     { e.preventDefault(); pick(activeIndex); }
        else if (e.key === 'Escape')    { closeMenu(); input.blur(); }
    });

    // Egérrel: mousedown (a blur ELŐTT), hogy a választás ne vesszen el.
    menu.addEventListener('mousedown', e => {
        const el = e.target.closest('.ss-item');
        if (!el) return;
        e.preventDefault();
        pick(parseInt(el.dataset.i, 10));
    });

    // Fókusz elvesztésekor visszaáll az utolsó érvényes választás címkéjére.
    input.addEventListener('blur', () => { closeMenu(); input.value = value === '' ? '' : labelFor(value); });

    function scrollActive() {
        const el = menu.querySelector('.ss-item--active');
        if (el) el.scrollIntoView({ block: 'nearest' });
    }

    // Kezdőérték beállítása.
    applyValue(value);

    return {
        getValue: () => hidden.value,
        setValue: id => applyValue(id),
        getEl: () => mountEl,
        destroy: () => { mountEl.innerHTML = ''; },
    };
}
