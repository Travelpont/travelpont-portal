// Kliens-oldali WebP-optimalizálás feltöltés ELŐTT.
// A böngésző canvas.toBlob('image/webp')-jével alakít át — a kepkonvertalo.html bevált logikája.
// Alapértelmezés: a leghosszabb oldal max 1920px, minőség 80%.
//
// Cél: a szerkesztő az EREDETI (jpg/png) képet választja a NAS-ról, és a Portál
// feltöltéskor automatikusan webp-et készít belőle — nincs külön konvertálás/mentés lépés.

const ALAP = { maxDim: 1920, quality: 0.80 };

function betoltKep(url) {
    return new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = rej;
        img.src = url;
    });
}

function alapNev(nev) {
    const i = nev.lastIndexOf('.');
    return i > 0 ? nev.slice(0, i) : nev;
}

// file -> File (image/webp). Bármilyen hiba / nem-kép esetén az EREDETI fájlt adja vissza,
// hogy a feltöltés sose törjön el a konvertálás miatt.
export async function optimalizaltWebp(file, opts = {}) {
    const { maxDim, quality } = { ...ALAP, ...opts };
    if (!file || !file.type || !file.type.startsWith('image/')) return file;
    if (file.type === 'image/gif') return file; // animációt ne bántsuk

    const url = URL.createObjectURL(file);
    try {
        const img = await betoltKep(url);
        const w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) return file;

        const ratio = Math.min(maxDim / w, maxDim / h, 1);
        // Ha már webp ÉS nem kell kicsinyíteni -> ne kódoljuk újra feleslegesen.
        if (file.type === 'image/webp' && ratio === 1) return file;

        const nw = Math.max(1, Math.round(w * ratio));
        const nh = Math.max(1, Math.round(h * ratio));
        const canvas = document.createElement('canvas');
        canvas.width = nw; canvas.height = nh;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, nw, nh);

        const blob = await new Promise(r => canvas.toBlob(r, 'image/webp', quality));
        if (!blob) return file; // a böngésző nem tudott webp-et készíteni -> eredeti
        // Ha az újrakódolt nagyobb lenne, és az eredeti már webp volt, tartsuk az eredetit.
        if (blob.size >= file.size && file.type === 'image/webp') return file;

        return new File([blob], alapNev(file.name) + '.webp', { type: 'image/webp', lastModified: Date.now() });
    } catch (e) {
        return file; // bármilyen hiba -> az eredeti megy fel
    } finally {
        URL.revokeObjectURL(url);
    }
}
