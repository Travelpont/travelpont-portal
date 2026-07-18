// =====================================================
// iata-airports.js – Európai nemzetközi repülőterek (+ pár népszerű, Európán
// kívüli üdülő-célpont), az ajánlat-form reptér-választójához és a Kiwi-link
// builder "Honnan"/"Hova" mezőihez.
// NEM teljes világlista – a Budapestről reálisan elérhető/keresett célok,
// könnyen bővíthető: egy sor = egy reptér.
// =====================================================

export const AIRPORTS = [
    // ── Magyarország ──
    { code: 'BUD', label: 'Budapest' },
    { code: 'DEB', label: 'Debrecen' },

    // ── Olaszország ──
    { code: 'FCO', label: 'Róma (Fiumicino)' },
    { code: 'CIA', label: 'Róma (Ciampino)' },
    { code: 'MXP', label: 'Milánó (Malpensa)' },
    { code: 'BGY', label: 'Milánó (Bergamo)' },
    { code: 'LIN', label: 'Milánó (Linate)' },
    { code: 'VCE', label: 'Velence' },
    { code: 'TSF', label: 'Velence (Treviso)' },
    { code: 'VRN', label: 'Verona' },
    { code: 'BLQ', label: 'Bologna' },
    { code: 'PSA', label: 'Pisa' },
    { code: 'FLR', label: 'Firenze' },
    { code: 'NAP', label: 'Nápoly' },
    { code: 'BRI', label: 'Bari' },
    { code: 'BDS', label: 'Brindisi' },
    { code: 'CTA', label: 'Catania (Szicília)' },
    { code: 'PMO', label: 'Palermo (Szicília)' },
    { code: 'CAG', label: 'Cagliari (Szardínia)' },
    { code: 'OLB', label: 'Olbia (Szardínia)' },
    { code: 'AHO', label: 'Alghero (Szardínia)' },
    { code: 'TRN', label: 'Torino' },

    // ── Spanyolország ──
    { code: 'BCN', label: 'Barcelona' },
    { code: 'MAD', label: 'Madrid' },
    { code: 'PMI', label: 'Palma de Mallorca' },
    { code: 'IBZ', label: 'Ibiza' },
    { code: 'MAH', label: 'Menorca' },
    { code: 'AGP', label: 'Málaga' },
    { code: 'ALC', label: 'Alicante' },
    { code: 'VLC', label: 'Valencia' },
    { code: 'SVQ', label: 'Sevilla' },
    { code: 'BIO', label: 'Bilbao' },
    { code: 'TFS', label: 'Tenerife (dél)' },
    { code: 'LPA', label: 'Gran Canaria' },
    { code: 'ACE', label: 'Lanzarote' },
    { code: 'FUE', label: 'Fuerteventura' },

    // ── Görögország ──
    { code: 'ATH', label: 'Athén' },
    { code: 'SKG', label: 'Thesszaloniki' },
    { code: 'JTR', label: 'Santorini' },
    { code: 'JMK', label: 'Mykonos' },
    { code: 'HER', label: 'Heraklion (Kréta)' },
    { code: 'CHQ', label: 'Chania (Kréta)' },
    { code: 'RHO', label: 'Rodosz' },
    { code: 'KGS', label: 'Kos' },
    { code: 'CFU', label: 'Korfu' },
    { code: 'ZTH', label: 'Zakynthos' },
    { code: 'EFL', label: 'Kefalonia' },
    { code: 'PVK', label: 'Preveza (Lefkada)' },
    { code: 'SKU', label: 'Skiathos' },
    { code: 'KLX', label: 'Kalamata' },

    // ── Horvátország / Adria ──
    { code: 'DBV', label: 'Dubrovnik' },
    { code: 'SPU', label: 'Split' },
    { code: 'ZAD', label: 'Zadar' },
    { code: 'PUY', label: 'Pula' },
    { code: 'ZAG', label: 'Zágráb' },
    { code: 'TIV', label: 'Tivat (Montenegró)' },
    { code: 'TGD', label: 'Podgorica (Montenegró)' },
    { code: 'TIA', label: 'Tirana (Albánia)' },
    { code: 'LJU', label: 'Ljubljana' },
    { code: 'SJJ', label: 'Szarajevó' },
    { code: 'BEG', label: 'Belgrád' },
    { code: 'SKP', label: 'Szkopje' },

    // ── Portugália ──
    { code: 'LIS', label: 'Lisszabon' },
    { code: 'OPO', label: 'Porto' },
    { code: 'FAO', label: 'Faro (Algarve)' },
    { code: 'FNC', label: 'Funchal (Madeira)' },
    { code: 'PDL', label: 'Ponta Delgada (Azori)' },

    // ── Franciaország ──
    { code: 'CDG', label: 'Párizs (Charles de Gaulle)' },
    { code: 'ORY', label: 'Párizs (Orly)' },
    { code: 'BVA', label: 'Párizs (Beauvais)' },
    { code: 'NCE', label: 'Nizza' },
    { code: 'MRS', label: 'Marseille' },
    { code: 'LYS', label: 'Lyon' },
    { code: 'TLS', label: 'Toulouse' },
    { code: 'BOD', label: 'Bordeaux' },

    // ── Egyesült Királyság / Írország ──
    { code: 'LHR', label: 'London (Heathrow)' },
    { code: 'LGW', label: 'London (Gatwick)' },
    { code: 'STN', label: 'London (Stansted)' },
    { code: 'LTN', label: 'London (Luton)' },
    { code: 'MAN', label: 'Manchester' },
    { code: 'EDI', label: 'Edinburgh' },
    { code: 'DUB', label: 'Dublin' },

    // ── Németország / Ausztria / Svájc ──
    { code: 'BER', label: 'Berlin' },
    { code: 'MUC', label: 'München' },
    { code: 'FRA', label: 'Frankfurt' },
    { code: 'DUS', label: 'Düsseldorf' },
    { code: 'CGN', label: 'Köln' },
    { code: 'HAM', label: 'Hamburg' },
    { code: 'STR', label: 'Stuttgart' },
    { code: 'NUE', label: 'Nürnberg' },
    { code: 'VIE', label: 'Bécs' },
    { code: 'SZG', label: 'Salzburg' },
    { code: 'INN', label: 'Innsbruck' },
    { code: 'GRZ', label: 'Graz' },
    { code: 'ZRH', label: 'Zürich' },
    { code: 'GVA', label: 'Genf' },
    { code: 'BSL', label: 'Bázel' },

    // ── Benelux / Skandinávia / Baltikum ──
    { code: 'AMS', label: 'Amszterdam' },
    { code: 'BRU', label: 'Brüsszel' },
    { code: 'CRL', label: 'Brüsszel (Charleroi)' },
    { code: 'EIN', label: 'Eindhoven' },
    { code: 'CPH', label: 'Koppenhága' },
    { code: 'OSL', label: 'Oslo' },
    { code: 'ARN', label: 'Stockholm (Arlanda)' },
    { code: 'HEL', label: 'Helsinki' },
    { code: 'KEF', label: 'Reykjavík (Keflavík)' },
    { code: 'RIX', label: 'Riga' },
    { code: 'VNO', label: 'Vilnius' },
    { code: 'TLL', label: 'Tallinn' },

    // ── Közép-Európa / Balkán ──
    { code: 'PRG', label: 'Prága' },
    { code: 'BRQ', label: 'Brno' },
    { code: 'BTS', label: 'Pozsony' },
    { code: 'KSC', label: 'Kassa' },
    { code: 'KRK', label: 'Krakkó' },
    { code: 'WAW', label: 'Varsó' },
    { code: 'GDN', label: 'Gdańsk' },
    { code: 'WRO', label: 'Wrocław' },
    { code: 'OTP', label: 'Bukarest' },
    { code: 'CLJ', label: 'Kolozsvár' },
    { code: 'TSR', label: 'Temesvár' },
    { code: 'SOF', label: 'Szófia' },
    { code: 'BOJ', label: 'Burgasz' },
    { code: 'VAR', label: 'Várna' },
    { code: 'KIV', label: 'Chișinău' },

    // ── Ciprus / Málta / Törökország ──
    { code: 'LCA', label: 'Larnaka (Ciprus)' },
    { code: 'PFO', label: 'Páfosz (Ciprus)' },
    { code: 'MLA', label: 'Málta' },
    { code: 'IST', label: 'Isztambul' },
    { code: 'SAW', label: 'Isztambul (Sabiha Gökçen)' },
    { code: 'AYT', label: 'Antalya' },
    { code: 'ADB', label: 'Izmir' },
    { code: 'BJV', label: 'Bodrum' },
    { code: 'DLM', label: 'Dalaman' },

    // ── Európán kívüli népszerű célok ──
    { code: 'TLV', label: 'Tel-Aviv' },
    { code: 'HRG', label: 'Hurghada' },
    { code: 'SSH', label: 'Sharm el-Sheikh' },
    { code: 'CAI', label: 'Kairó' },
    { code: 'RAK', label: 'Marrákes' },
    { code: 'AGA', label: 'Agadir' },
    { code: 'RMF', label: 'Marsa Alam' },
    { code: 'DXB', label: 'Dubai' },
    { code: 'AUH', label: 'Abu-Dzabi' },
    { code: 'DOH', label: 'Doha' },
    { code: 'BKK', label: 'Bangkok' },
    { code: 'CUN', label: 'Cancún' },
    { code: 'PUJ', label: 'Punta Cana' },
    { code: 'MLE', label: 'Malé (Maldív-szigetek)' },
    { code: 'MRU', label: 'Mauritius' },
    { code: 'CMB', label: 'Colombo (Srí Lanka)' },
    { code: 'ZNZ', label: 'Zanzibár' },
];

// Reptér keresése kód alapján ('BUD' → { code, label } vagy undefined)
export function airportByCode(code) {
    const c = (code || '').trim().toUpperCase();
    return AIRPORTS.find(a => a.code === c);
}

// <datalist> option-ök HTML-je a Kiwi-link builder Honnan/Hova mezőihez
export function airportDatalistOptionsHtml() {
    return AIRPORTS.map(a => `<option value="${a.code}">${a.label} (${a.code})</option>`).join('');
}
