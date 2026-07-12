// =====================================================
// quill-helper.js – Rich text szerkesztő a hosszabb HTML-tartalmú mezőkhöz
// (Ajánlat/Úticél "Leírás" / "Bemutató szöveg") – a Quill.js CDN-t az adott
// oldal <head>-jébe kell betölteni (quill.snow.min.css + quill.min.js),
// az aktivbalaton-portal esemenyek.html/helyszinek.html mintája szerint,
// egyszerűsített eszköztárral (nincs kép/emoji-beszúrás, mert nincs médiatár).
//
// Az Úticélok oldal ezt a "kép a szövegbe" funkcióval bővíti (lásd
// registerTpuKepBlot / insertTpuKep) – ez a Galéria-szekcióban már
// feltöltött fotókra épít, NEM önálló feltöltési útvonal.
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
        // Fallback, ha a CDN nem töltött be: sima textarea, hogy legalább szerkeszthető maradjon.
        container.innerHTML = `<textarea class="input-field" style="min-height:180px;" placeholder="${placeholder || ''}">${initialHtml || ''}</textarea>`;
        const ta = container.querySelector('textarea');
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

// ---- Egyedi Quill blot regisztrálása a szövegbe kézzel beillesztett képekhez ----
// Az Úticélok plugin (travelpont-uticelok) a <img class="tpu-inline-kep" data-id="…">
// jelölőt keresi a mentett HTML-ben és alakítja végleges, keretezett képpé –
// ezt a jelölőt hozza létre ez a blot. Csak egyszer regisztráljuk (idempotens).
let _tpuKepBlotRegistered = false;

export function registerTpuKepBlot() {
    if (_tpuKepBlotRegistered || typeof Quill === 'undefined') return;

    const BlockEmbed = Quill.import('blots/block/embed');
    class TpuKepBlot extends BlockEmbed {
        static create(value) {
            const node = super.create();
            node.setAttribute('src', value.url);
            node.setAttribute('data-id', value.id);
            node.setAttribute('alt', value.felirat || '');
            node.setAttribute('class', 'tpu-inline-kep');
            return node;
        }
        static value(node) {
            return {
                id: node.getAttribute('data-id'),
                url: node.getAttribute('src'),
                felirat: node.getAttribute('alt') || '',
            };
        }
    }
    TpuKepBlot.blotName = 'tpuKep';
    TpuKepBlot.tagName = 'img';

    Quill.register(TpuKepBlot);
    _tpuKepBlotRegistered = true;
}

// ---- Kép beszúrása a szerkesztő aktuális (vagy utoljára ismert) kurzorpozíciójába ----
// range: a quill.getSelection() eredménye VAGY az utoljára ismert pozíció (a
// szerkesztőn kívüli gombra kattintva a fókusz elveszik, ezért a hívó oldalon
// egy 'selection-change' listenerrel érdemes cache-elni az utolsó pozíciót).
export function insertTpuKep(quill, range, kep) {
    if (!quill) return;
    const index = range ? range.index : quill.getLength();
    quill.insertEmbed(index, 'tpuKep', kep, 'user');
    quill.setSelection(index + 1, 0, 'user');
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
