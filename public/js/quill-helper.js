// =====================================================
// quill-helper.js – Rich text szerkesztő a hosszabb HTML-tartalmú mezőkhöz
// (jelenleg az Ajánlatok "Leírás" mezője használja) – a Quill.js CDN-t az
// adott oldal <head>-jébe kell betölteni (quill.snow.min.css + quill.min.js),
// az aktivbalaton-portal esemenyek.html/helyszinek.html mintája szerint,
// egyszerűsített eszköztárral (nincs kép/emoji-beszúrás, mert nincs médiatár).
//
// Az Úticélok "Bemutató szöveg" mezője NEM ezt használja, hanem a saját
// blokk-szerkesztőjét (blokk-szerkeszto.js).
// =====================================================

// ---- Új Quill-szerkesztő létrehozása egy konténer div-ben ----
// containerId: üres <div> az oldalon, hiddenInputId: <input type="hidden">,
// aminek a .value-ja mindig szinkronban van a szerkesztő HTML-tartalmával
// (ezt olvassa a mentés-logika, változatlanul).
export function setupQuillEditor(containerId, hiddenInputId, initialHtml, placeholder) {
    const container = document.getElementById(containerId);
    const hidden = document.getElementById(hiddenInputId);
    if (!container) return null;

    if (typeof Quill === 'undefined') {
        // Fallback, ha a CDN nem töltött be: sima textarea, hogy legalább
        // szerkeszthető maradjon. A .value property-n keresztül töltünk,
        // így nincs HTML-escape gond.
        container.innerHTML = `<textarea class="input-field" style="min-height:180px;" placeholder="${placeholder || ''}"></textarea>`;
        const ta = container.querySelector('textarea');
        ta.value = initialHtml || '';
        ta.addEventListener('input', () => { if (hidden) hidden.value = ta.value; });
        if (hidden) hidden.value = initialHtml || '';
        return null;
    }

    const quill = new Quill(`#${containerId}`, {
        theme: 'snow',
        placeholder: placeholder || '',
        modules: {
            toolbar: [
                [{ header: [2, 3, false] }],
                ['bold', 'italic', 'underline'],
                [{ list: 'ordered' }, { list: 'bullet' }],
                ['blockquote', 'link'],
                ['clean'],
            ],
        },
    });

    if (initialHtml) quill.clipboard.dangerouslyPasteHTML(initialHtml);
    if (hidden) hidden.value = initialHtml || '';

    quill.on('text-change', () => {
        if (hidden) hidden.value = quill.root.innerHTML;
    });

    return quill;
}

// ---- AI-generált (vagy egyéb programozott) HTML beillesztése a szerkesztőbe ----
export function setQuillContent(quill, hiddenInputId, html) {
    if (!quill) {
        // Fallback módban (nincs Quill) a container textarea-ját frissítjük közvetlenül.
        const hidden = document.getElementById(hiddenInputId);
        if (hidden) hidden.value = html || '';
        return;
    }
    quill.setText('');
    quill.clipboard.dangerouslyPasteHTML(html || '');
    const hidden = document.getElementById(hiddenInputId);
    if (hidden) hidden.value = quill.root.innerHTML;
}
