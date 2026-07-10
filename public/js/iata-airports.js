// =====================================================
// iata-airports.js – Gyakori repülőterek (Budapestről elérhető népszerű
// üdülőhelyek), a Kiwi-link builder "Honnan"/"Hova" mezőinek datalist-jéhez.
// NEM teljes lista – csak a leggyakoribb célállomások, könnyen bővíthető.
// =====================================================

export const AIRPORTS = [
    { code: 'BUD', label: 'Budapest' },
    { code: 'FCO', label: 'Róma (Fiumicino)' },
    { code: 'CIA', label: 'Róma (Ciampino)' },
    { code: 'MXP', label: 'Milánó (Malpensa)' },
    { code: 'BGY', label: 'Milánó (Bergamo)' },
    { code: 'VCE', label: 'Velence' },
    { code: 'NAP', label: 'Nápoly' },
    { code: 'BLQ', label: 'Bologna' },
    { code: 'BCN', label: 'Barcelona' },
    { code: 'MAD', label: 'Madrid' },
    { code: 'PMI', label: 'Palma de Mallorca' },
    { code: 'AGP', label: 'Málaga' },
    { code: 'ATH', label: 'Athén' },
    { code: 'JTR', label: 'Santorini' },
    { code: 'HER', label: 'Heraklion (Kréta)' },
    { code: 'RHO', label: 'Rodosz' },
    { code: 'CFU', label: 'Korfu' },
    { code: 'DBV', label: 'Dubrovnik' },
    { code: 'SPU', label: 'Split' },
    { code: 'ZAD', label: 'Zadar' },
    { code: 'PUY', label: 'Pula' },
    { code: 'NCE', label: 'Nizza' },
    { code: 'CDG', label: 'Párizs (Charles de Gaulle)' },
    { code: 'ORY', label: 'Párizs (Orly)' },
    { code: 'LHR', label: 'London (Heathrow)' },
    { code: 'STN', label: 'London (Stansted)' },
    { code: 'LTN', label: 'London (Luton)' },
    { code: 'LIS', label: 'Lisszabon' },
    { code: 'FAO', label: 'Faro' },
    { code: 'TFS', label: 'Tenerife' },
    { code: 'LPA', label: 'Gran Canaria' },
    { code: 'LCA', label: 'Larnaka (Ciprus)' },
    { code: 'AYT', label: 'Antalya' },
    { code: 'IST', label: 'Isztambul' },
    { code: 'SAW', label: 'Isztambul (Sabiha Gökçen)' },
    { code: 'VIE', label: 'Bécs' },
    { code: 'PRG', label: 'Prága' },
    { code: 'CPH', label: 'Koppenhága' },
    { code: 'AMS', label: 'Amszterdam' },
    { code: 'BER', label: 'Berlin' },
    { code: 'DXB', label: 'Dubai' },
    { code: 'BKK', label: 'Bangkok' },
    { code: 'CUN', label: 'Cancún' },
];

// <datalist> option-ök HTML-je a Kiwi-link builder Honnan/Hova mezőihez
export function airportDatalistOptionsHtml() {
    return AIRPORTS.map(a => `<option value="${a.code}">${a.label} (${a.code})</option>`).join('');
}
