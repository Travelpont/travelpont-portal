// =====================================================
// kiwi-link-builder.js – Kiwi.com/Travelpayouts deep-link összeállítása
// Lásd: D:\travelpont.hu\_Dokumentumok\affiliate-regisztraciok.md
// (a manuális recept, amit ez a modul automatizál)
// =====================================================

// Travelpayouts saját azonosítók – ha bármelyik változna, csak itt kell módosítani.
const SHMARKER = '748075';
const PROMO_ID = '3791';

const IATA_RE = /^[A-Za-z]{3}$/;

// ---- A teljes, becsomagolt affiliate link összeállítása ----
// { from, to }: 3 betűs IATA kód; { departure, returnDate }: 'YYYY-MM-DD'
// Dobás: Error, ha valamelyik bemenet hiányzik/érvénytelen (a hívó fél jelenítse meg a hibát).
export function buildKiwiLink({ from, to, departure, returnDate }) {
    from = (from || '').trim().toUpperCase();
    to = (to || '').trim().toUpperCase();

    if (!IATA_RE.test(from)) throw new Error('A "Honnan" mezőbe 3 betűs IATA kód kell (pl. BUD).');
    if (!IATA_RE.test(to)) throw new Error('A "Hova" mezőbe 3 betűs IATA kód kell (pl. FCO).');
    if (!departure) throw new Error('A kiindulás dátuma kötelező.');
    if (!returnDate) throw new Error('A visszaút dátuma kötelező.');

    const deepUrl = `https://www.kiwi.com/deep?from=${from}&to=${to}&departure=${departure}&return=${returnDate}`;
    const encoded = encodeURIComponent(deepUrl);

    return `https://c111.travelpayouts.com/click?shmarker=${SHMARKER}&promo_id=${PROMO_ID}&source_type=customlink&type=click&custom_url=${encoded}`;
}
