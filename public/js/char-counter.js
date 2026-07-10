// =====================================================
// char-counter.js – Élő karakterszámláló SEO-mezőkhöz
// (az aktivbalaton-portal esemenyek.html updateSeoCount()-jának mintájára)
// =====================================================

// inputId: <input>/<textarea> id, countId: az a <span>, ahova a számot írjuk, max: ajánlott hossz
export function attachCharCounter(inputId, countId, max) {
    const el  = document.getElementById(inputId);
    const cnt = document.getElementById(countId);
    if (!el || !cnt) return;

    const update = () => {
        const len = el.value.length;
        cnt.textContent = len;
        cnt.style.color = len > max ? 'var(--red)' : len > max * 0.9 ? 'var(--gold)' : 'var(--text-muted)';
    };
    update();
    el.addEventListener('input', update);
}
