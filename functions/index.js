// =====================================================
// Travelpont Portal – Firebase Cloud Functions
// Verzió: 1.1.0 – galeria_add/galeria_remove action mindkét proxyban (több kép/bejegyzés)
//
// Architektúra (az aktivbalaton-portal mintáját követve): a böngésző sosem
// hívja közvetlenül a WordPress REST API-t. Ez a proxy-réteg Secret
// Managerből olvasott WP Application Password-del (Basic Auth) hívja a
// travelpont.hu tpa/v1 (Ajánlatok) és tpu/v1 (Úticélok) végpontjait, a
// kliens felől Firebase ID-token + email-allowlith alapú auth-hal védve.
//
// V1 hatókör: generateContent (OpenAI proxy AI-szövegíráshoz), ajanlatProxy,
// uticelProxy, serverStatus. NINCS Firestore/push/collector – a WP marad az
// egyetlen adat-igazságforrás, élő proxyval elérve.
// =====================================================

const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');

admin.initializeApp();

// ---- Secrets – Secret Manager-ből ----
const openaiKey  = defineSecret('OPENAI_API_KEY');
const wpUser     = defineSecret('WP_USERNAME');
const wpPassword = defineSecret('WP_APP_PASSWORD');

// ---- WordPress alap URL ----
const WP_BASE = 'https://travelpont.hu/wp-json';

// =====================================================
// ENGEDÉLYEZETT SZERKESZTŐK – email allowlist
// Érvényes Firebase-token önmagában NEM elég: csak az itt felsorolt
// fiókok érhetik el a Cloud Function-öket (verifyAuth ellenőrzi).
// ÚJ SZERKESZTŐ FELVÉTELEKOR: add hozzá az emailjét ehhez a listához (kisbetűvel).
const ALLOWED_EMAILS = [
    'ngabor.blelle@gmail.com',
    'npetra0821@gmail.com',
];

// ---- CORS helper ----
function setCORS(res) {
    res.set('Access-Control-Allow-Origin',  '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// ---- Auth token ellenőrzés ----
async function verifyAuth(req, res) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Hitelesítés szükséges' });
        return null;
    }
    let decoded;
    try {
        decoded = await admin.auth().verifyIdToken(authHeader.split('Bearer ')[1]);
    } catch {
        res.status(401).json({ error: 'Érvénytelen token' });
        return null;
    }

    const email = (decoded.email || '').toLowerCase();
    if (!email || !ALLOWED_EMAILS.includes(email)) {
        console.warn('[verifyAuth] 403 – elutasítva. token.email=' + JSON.stringify(decoded.email) +
            ' | normalizált=' + JSON.stringify(email) +
            ' | allowlist=' + JSON.stringify(ALLOWED_EMAILS));
        res.status(403).json({ error: 'Nincs jogosultság ehhez a fiókhoz' });
        return null;
    }

    return decoded;
}

// =====================================================
// 1. OpenAI tartalom generálás
// POST /generateContent
// =====================================================
exports.generateContent = onRequest(
    { region: 'europe-west1', timeoutSeconds: 120, memory: '256MiB', secrets: [openaiKey], invoker: 'public' },
    async (req, res) => {

    setCORS(res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'POST')    { res.status(405).json({ error: 'Method not allowed' }); return; }

    const user = await verifyAuth(req, res);
    if (!user) return;

    const apiKey = openaiKey.value();
    if (!apiKey) {
        res.status(500).json({ error: 'OpenAI API kulcs nincs beállítva!' });
        return;
    }

    try {
        const { model, messages, max_tokens, temperature } = req.body;
        if (!model || !messages) {
            res.status(400).json({ error: 'Hiányzó paraméterek: model, messages' });
            return;
        }

        const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
            method:  'POST',
            headers: {
                'Content-Type':  'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model,
                messages,
                max_tokens:  max_tokens  ?? 3000,
                temperature: temperature ?? 0.7
            })
        });

        const data = await openaiRes.json();
        if (!openaiRes.ok) {
            res.status(openaiRes.status).json({ error: data.error?.message || 'OpenAI hiba' });
            return;
        }

        res.status(200).json(data);

    } catch (err) {
        console.error('generateContent hiba:', err);
        res.status(500).json({ error: 'Szerver hiba: ' + err.message });
    }
});

// =====================================================
// 2. Szerver állapot ellenőrzés
// GET /serverStatus
// =====================================================
exports.serverStatus = onRequest(
    { region: 'europe-west1', secrets: [openaiKey], invoker: 'public' },
    (req, res) => {

    setCORS(res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

    const configured = !!(openaiKey.value()?.startsWith('sk-'));

    res.status(200).json({
        status:    'ok',
        configured,
        version:   '1.0.0',
        region:    'europe-west1',
        timestamp: new Date().toISOString()
    });
});

// =====================================================
// Közös WP-proxy futtató – a query-alapú "action" mintát a
// bsza/abe proxyk aktivbalaton-portalbeli mintája adja.
// =====================================================
async function runWpProxy(req, res, routeBuilder) {
    setCORS(res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

    const user = await verifyAuth(req, res);
    if (!user) return;

    const username    = wpUser.value();
    const appPassword = wpPassword.value();
    if (!username || !appPassword) {
        res.status(500).json({ error: 'WordPress hitelesítő adatok hiányoznak' }); return;
    }
    const credentials = Buffer.from(`${username}:${appPassword}`).toString('base64');
    const authHeader  = { 'Authorization': `Basic ${credentials}`, 'Content-Type': 'application/json' };

    const action = req.query.action || 'list';
    const id     = req.query.id ? parseInt(req.query.id) : null;

    let route;
    try {
        route = routeBuilder(action, id, req);
    } catch (err) {
        res.status(400).json({ error: err.message }); return;
    }
    if (!route) { res.status(400).json({ error: `Ismeretlen action: ${action}` }); return; }

    try {
        const fetchOpts = { method: route.method, headers: authHeader };
        if (route.body) fetchOpts.body = route.body;

        const wpRes  = await fetch(route.url, fetchOpts);
        const wpData = await wpRes.json();

        if (!wpRes.ok) {
            console.error(`[wpProxy] WP hiba (${action}):`, wpData);
            res.status(wpRes.status).json({
                error: wpData.message || wpData.error || 'WordPress API hiba',
                code:  wpData.code    || 'wp_error',
                wpStatus: wpRes.status
            });
            return;
        }

        res.status(200).json(wpData);

    } catch (err) {
        console.error('[wpProxy] Szerver hiba:', err);
        res.status(500).json({ error: 'Szerver hiba: ' + err.message });
    }
}

function requireId(id) {
    if (!id) { const e = new Error('id paraméter szükséges'); throw e; }
    return id;
}

// =====================================================
// 3. Ajánlatok proxy – TPA REST API
// GET/POST/PUT /ajanlatProxy?action=...&id=...
// =====================================================
exports.ajanlatProxy = onRequest(
    { region: 'europe-west1', timeoutSeconds: 60, memory: '256MiB',
      secrets: [wpUser, wpPassword], invoker: 'public' },
    (req, res) => runWpProxy(req, res, (action, id, req) => {
        switch (action) {
            case 'list': {
                const params = new URLSearchParams();
                ['per_page', 'page', 'search', 'status', 'kategoria', 'uticel_id'].forEach(k => {
                    if (req.query[k]) params.set(k, req.query[k]);
                });
                return { url: `${WP_BASE}/tpa/v1/ajanlatok?${params}`, method: 'GET' };
            }
            case 'get':
                requireId(id);
                return { url: `${WP_BASE}/tpa/v1/ajanlat/${id}`, method: 'GET' };
            case 'create':
                return { url: `${WP_BASE}/tpa/v1/ajanlat`, method: 'POST', body: JSON.stringify(req.body) };
            case 'update':
                requireId(id);
                return { url: `${WP_BASE}/tpa/v1/ajanlat/${id}`, method: 'PUT', body: JSON.stringify(req.body) };
            case 'sideload':
                requireId(id);
                return { url: `${WP_BASE}/tpa/v1/ajanlat/${id}/kep`, method: 'POST', body: JSON.stringify(req.body) };
            case 'galeria_add':
                requireId(id);
                return { url: `${WP_BASE}/tpa/v1/ajanlat/${id}/galeria`, method: 'POST', body: JSON.stringify(req.body) };
            case 'galeria_remove': {
                requireId(id);
                const kepId = req.query.kep_id;
                if (!kepId) throw new Error('kep_id paraméter szükséges');
                return { url: `${WP_BASE}/tpa/v1/ajanlat/${id}/galeria/${kepId}`, method: 'DELETE' };
            }
            case 'meta':
                return { url: `${WP_BASE}/tpa/v1/meta`, method: 'GET' };
            case 'status':
                return { url: `${WP_BASE}/tpa/v1/status`, method: 'GET' };
            default:
                return null;
        }
    })
);

// =====================================================
// 4. Úticélok proxy – TPU REST API
// GET/POST/PUT /uticelProxy?action=...&id=...
// =====================================================
exports.uticelProxy = onRequest(
    { region: 'europe-west1', timeoutSeconds: 60, memory: '256MiB',
      secrets: [wpUser, wpPassword], invoker: 'public' },
    (req, res) => runWpProxy(req, res, (action, id, req) => {
        switch (action) {
            case 'list': {
                const params = new URLSearchParams();
                ['per_page', 'page', 'search', 'status', 'parent'].forEach(k => {
                    if (req.query[k] !== undefined && req.query[k] !== '') params.set(k, req.query[k]);
                });
                return { url: `${WP_BASE}/tpu/v1/uticelok?${params}`, method: 'GET' };
            }
            case 'get':
                requireId(id);
                return { url: `${WP_BASE}/tpu/v1/uticel/${id}`, method: 'GET' };
            case 'create':
                return { url: `${WP_BASE}/tpu/v1/uticel`, method: 'POST', body: JSON.stringify(req.body) };
            case 'update':
                requireId(id);
                return { url: `${WP_BASE}/tpu/v1/uticel/${id}`, method: 'PUT', body: JSON.stringify(req.body) };
            case 'sideload':
                requireId(id);
                return { url: `${WP_BASE}/tpu/v1/uticel/${id}/kep`, method: 'POST', body: JSON.stringify(req.body) };
            case 'galeria_add':
                requireId(id);
                return { url: `${WP_BASE}/tpu/v1/uticel/${id}/galeria`, method: 'POST', body: JSON.stringify(req.body) };
            case 'galeria_remove': {
                requireId(id);
                const kepId = req.query.kep_id;
                if (!kepId) throw new Error('kep_id paraméter szükséges');
                return { url: `${WP_BASE}/tpu/v1/uticel/${id}/galeria/${kepId}`, method: 'DELETE' };
            }
            case 'meta':
                return { url: `${WP_BASE}/tpu/v1/meta`, method: 'GET' };
            case 'status':
                return { url: `${WP_BASE}/tpu/v1/status`, method: 'GET' };
            default:
                return null;
        }
    })
);
