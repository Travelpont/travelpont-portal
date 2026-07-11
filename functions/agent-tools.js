// =====================================================
// agent-tools.js – Az AI Műhely agent tool-definíciói és futtatójuk
//
// Olvasó toolok: az agent szabadon hívja őket (tpu/tpa REST + WP core
// /wp/v2/posts), Basic Auth-tal, a runWpProxy-val azonos hitelesítéssel.
// propose_save: NEM ment semmit – az index.js agent-loopja fogja el, és
// jóváhagyó kártyaként küldi le a kliensnek.
// =====================================================

const WP_BASE = 'https://travelpont.hu/wp-json';

// ---- Tool-definíciók (Anthropic input_schema formátum) ----
const AGENT_TOOL_DEFINITIONS = [
    {
        name: 'list_uticelok',
        description: 'A weboldal úticéljainak listázása (ország → tájegység → város hierarchia). Használd, mielőtt úticélról írnál: létezik-e már, mi a címe/ID-ja/szülője. A search paraméterrel cím szerint szűrhetsz.',
        input_schema: {
            type: 'object',
            properties: {
                search: { type: 'string', description: 'Keresőszó a címben (opcionális)' },
                parent: { type: 'integer', description: 'Csak egy adott szülő úticél gyerekei (opcionális, ID)' },
            },
        },
    },
    {
        name: 'get_uticel',
        description: 'Egy úticél teljes tartalmának lekérése ID alapján: cím, rövid leírás (tpu_leiras), bemutató szöveg (content), szülő, státusz, SEO-mezők.',
        input_schema: {
            type: 'object',
            properties: {
                id: { type: 'integer', description: 'Az úticél ID-ja (a list_uticelok-ból)' },
            },
            required: ['id'],
        },
    },
    {
        name: 'list_ajanlatok',
        description: 'A weboldal utazási ajánlatainak (repjegy+szállás kombók) listázása: célállomás, ár, időpont, érvényesség. Használd FB-poszthoz, tartalomnaptárhoz, vagy ha egy úticélhoz tartozó ajánlatokra hivatkoznál.',
        input_schema: {
            type: 'object',
            properties: {
                search: { type: 'string', description: 'Keresőszó (opcionális)' },
                uticel_id: { type: 'integer', description: 'Csak egy adott úticélhoz kapcsolt ajánlatok (opcionális)' },
            },
        },
    },
    {
        name: 'get_ajanlat',
        description: 'Egy ajánlat teljes adatlapja ID alapján: leírás, árak, időpont, affiliate linkek.',
        input_schema: {
            type: 'object',
            properties: {
                id: { type: 'integer', description: 'Az ajánlat ID-ja (a list_ajanlatok-ból)' },
            },
            required: ['id'],
        },
    },
    {
        name: 'list_blogposztok',
        description: 'A weboldal blog-bejegyzéseinek listázása (cím, státusz, dátum). Használd, mielőtt esemény-cikket írnál: van-e már hasonló cikk.',
        input_schema: {
            type: 'object',
            properties: {
                search: { type: 'string', description: 'Keresőszó a címben/tartalomban (opcionális)' },
            },
        },
    },
    {
        name: 'propose_save',
        description: 'Kész tartalom mentési JAVASLATA a weboldalra. NEM ment közvetlenül: a javaslat jóváhagyó kártyán jelenik meg a szerkesztőnek, aki átnézheti, szerkesztheti és ő menti el. Csak akkor hívd, ha a szerkesztő menteni akar (vagy kifejezetten tartalmat kért az oldalra), és a tartalom kész. Hívás után ne ismételd meg a teljes szöveget.',
        input_schema: {
            type: 'object',
            properties: {
                tipus: {
                    type: 'string',
                    enum: ['uticel_update', 'uticel_create', 'blog_draft'],
                    description: 'uticel_update: meglévő úticél leírásának frissítése (id kötelező). uticel_create: új úticél létrehozása piszkozatként. blog_draft: új blog-bejegyzés piszkozatként (pl. esemény-cikk).',
                },
                id: { type: 'integer', description: 'uticel_update esetén a frissítendő úticél ID-ja' },
                cim: { type: 'string', description: 'Cím (uticel_create és blog_draft esetén kötelező)' },
                parent_id: { type: 'integer', description: 'uticel_create esetén a szülő úticél ID-ja (országnál hagyd el)' },
                kapcsolt_uticel_id: { type: 'integer', description: 'blog_draft esetén a cikkhez kapcsolódó úticél ID-ja (opcionális)' },
                leiras: { type: 'string', description: 'Úticél rövid teaser-leírása, 1-2 mondat (uticel_* típusnál)' },
                tartalom_html: { type: 'string', description: 'A fő szöveg HTML-ben (<p>, <h3>, <ul> tagekkel)' },
                seo_title: { type: 'string', description: 'SEO cím, max 60 karakter (opcionális)' },
                seo_metadesc: { type: 'string', description: 'SEO meta-leírás, max 155 karakter (opcionális)' },
                indoklas: { type: 'string', description: '1 mondat a szerkesztőnek: mit és miért javasolsz menteni' },
            },
            required: ['tipus', 'tartalom_html', 'indoklas'],
        },
    },
];

// ---- Token-takarékosság: kép-URL-eket, galériát, admin-linkeket nem adjuk az agentnek ----
const STRIP_KEYS = ['thumbnail_url', 'galeria', 'edit_url', 'kep_url'];
function slim(obj) {
    if (Array.isArray(obj)) return obj.map(slim);
    if (obj && typeof obj === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(obj)) {
            if (STRIP_KEYS.includes(k)) continue;
            out[k] = slim(v);
        }
        return out;
    }
    return obj;
}

// ---- WP hívás Basic Auth-tal (a runWpProxy hitelesítési mintája) ----
async function wpFetch(url, authHeader) {
    const wpRes = await fetch(url, { method: 'GET', headers: authHeader });
    const data = await wpRes.json();
    if (!wpRes.ok) {
        throw new Error(data.message || data.error || `WordPress API hiba (${wpRes.status})`);
    }
    return data;
}

// ---- Egy (olvasó) tool futtatása. Visszatérés: string a tool_result-ba. ----
async function runAgentTool(name, input, authHeader) {
    switch (name) {
        case 'list_uticelok': {
            const params = new URLSearchParams({ per_page: '200', status: 'any' });
            if (input.search) params.set('search', input.search);
            if (input.parent) params.set('parent', String(input.parent));
            const data = await wpFetch(`${WP_BASE}/tpu/v1/uticelok?${params}`, authHeader);
            return JSON.stringify(slim(data.items || data));
        }
        case 'get_uticel': {
            const data = await wpFetch(`${WP_BASE}/tpu/v1/uticel/${input.id}`, authHeader);
            return JSON.stringify(slim(data));
        }
        case 'list_ajanlatok': {
            const params = new URLSearchParams({ per_page: '100', status: 'any' });
            if (input.search) params.set('search', input.search);
            if (input.uticel_id) params.set('uticel_id', String(input.uticel_id));
            const data = await wpFetch(`${WP_BASE}/tpa/v1/ajanlatok?${params}`, authHeader);
            return JSON.stringify(slim(data.items || data));
        }
        case 'get_ajanlat': {
            const data = await wpFetch(`${WP_BASE}/tpa/v1/ajanlat/${input.id}`, authHeader);
            return JSON.stringify(slim(data));
        }
        case 'list_blogposztok': {
            const params = new URLSearchParams({
                per_page: '50', status: 'publish,draft',
                _fields: 'id,title,status,date,link',
            });
            if (input.search) params.set('search', input.search);
            const data = await wpFetch(`${WP_BASE}/wp/v2/posts?${params}`, authHeader);
            return JSON.stringify(data.map(p => ({
                id: p.id, cim: p.title?.rendered ?? p.title, status: p.status, datum: p.date,
            })));
        }
        default:
            throw new Error(`Ismeretlen tool: ${name}`);
    }
}

// ---- Státusz-szövegek a kliens folyamatjelzőjéhez ----
const TOOL_STATUS_LABELS = {
    list_uticelok:    '🌍 Úticélok lekérése a weboldalról…',
    get_uticel:       '🌍 Úticél tartalmának beolvasása…',
    list_ajanlatok:   '✈️ Ajánlatok lekérése a weboldalról…',
    get_ajanlat:      '✈️ Ajánlat adatainak beolvasása…',
    list_blogposztok: '📝 Blogbejegyzések lekérése…',
    propose_save:     '💾 Mentési javaslat összeállítása…',
    web_search:       '🔍 Keresés a neten…',
};

module.exports = { AGENT_TOOL_DEFINITIONS, runAgentTool, TOOL_STATUS_LABELS, WP_BASE };
