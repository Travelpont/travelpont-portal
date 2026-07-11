// =====================================================
// Travelpont Portal – Firebase Cloud Functions
// Verzió: 1.3.0 – aiAgent (AI Műhely, Claude agent NDJSON streaminggel) + blogProxy
// Korábban: 1.2.0 – galeria_caption action (kép-feliratok) mindkét proxyban
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
const Anthropic = require('@anthropic-ai/sdk');
const { buildSystemBlocks } = require('./agent-prompts');
const { AGENT_TOOL_DEFINITIONS, runAgentTool, TOOL_STATUS_LABELS } = require('./agent-tools');

admin.initializeApp();

// ---- Secrets – Secret Manager-ből ----
const openaiKey    = defineSecret('OPENAI_API_KEY');
const anthropicKey = defineSecret('ANTHROPIC_API_KEY');
const wpUser       = defineSecret('WP_USERNAME');
const wpPassword   = defineSecret('WP_APP_PASSWORD');

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
            case 'galeria_caption': {
                requireId(id);
                const kepId = req.query.kep_id;
                if (!kepId) throw new Error('kep_id paraméter szükséges');
                return { url: `${WP_BASE}/tpa/v1/ajanlat/${id}/galeria/${kepId}`, method: 'POST', body: JSON.stringify(req.body) };
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
            case 'galeria_caption': {
                requireId(id);
                const kepId = req.query.kep_id;
                if (!kepId) throw new Error('kep_id paraméter szükséges');
                return { url: `${WP_BASE}/tpu/v1/uticel/${id}/galeria/${kepId}`, method: 'POST', body: JSON.stringify(req.body) };
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

// =====================================================
// 5. Blog proxy – WP core REST (/wp/v2/posts)
// A create MINDIG piszkozatot hoz létre (status kényszerítve) – az AI Műhely
// esemény-cikkei így sosem élesednek jóváhagyás nélkül.
// =====================================================
exports.blogProxy = onRequest(
    { region: 'europe-west1', timeoutSeconds: 60, memory: '256MiB',
      secrets: [wpUser, wpPassword], invoker: 'public' },
    (req, res) => runWpProxy(req, res, (action, id, req) => {
        switch (action) {
            case 'list': {
                const params = new URLSearchParams({ context: 'edit' });
                ['per_page', 'page', 'search', 'status'].forEach(k => {
                    if (req.query[k]) params.set(k, req.query[k]);
                });
                return { url: `${WP_BASE}/wp/v2/posts?${params}`, method: 'GET' };
            }
            case 'get':
                requireId(id);
                return { url: `${WP_BASE}/wp/v2/posts/${id}?context=edit`, method: 'GET' };
            case 'create':
                return { url: `${WP_BASE}/wp/v2/posts`, method: 'POST',
                         body: JSON.stringify({ ...req.body, status: 'draft' }) };
            case 'update':
                requireId(id);
                return { url: `${WP_BASE}/wp/v2/posts/${id}`, method: 'POST',
                         body: JSON.stringify(req.body) };
            default:
                return null;
        }
    })
);

// =====================================================
// 6. AI Műhely agent – Claude (Anthropic) NDJSON streaminggel
// POST /aiAgent  body: { messages: [...] }
//
// A kliens a teljes eddigi beszélgetést küldi (az API stateless), a szerver
// agent-loopot futtat: webes keresés (szerver-tool) + WP-olvasó toolok
// szabadon, mentés viszont CSAK propose_save-ként megy le a kliensnek
// jóváhagyó kártyára – az agent sosem ír közvetlenül a WordPressbe.
//
// NDJSON eventek a kliensnek (soronként egy JSON):
//   {t:'status', text}                – folyamatjelző (tool-hívás történik)
//   {t:'delta',  text}                – az agent szövegének következő darabja
//   {t:'proposal', proposal}          – mentési javaslat (jóváhagyó kártya)
//   {t:'done', newMessages, usage}    – kör vége; a kliens a newMessages-t
//                                       hozzáfűzi a historyjához (a thinking/
//                                       tool blokkokat VÁLTOZATLANUL kell
//                                       visszaküldeni a következő körben)
//   {t:'error', error}                – hiba
// =====================================================
const AGENT_MODEL          = 'claude-opus-4-8';
const AGENT_MAX_TOKENS     = 16000;
const AGENT_MAX_ITERATIONS = 12;

exports.aiAgent = onRequest(
    { region: 'europe-west1', timeoutSeconds: 300, memory: '512MiB',
      secrets: [anthropicKey, wpUser, wpPassword], invoker: 'public' },
    async (req, res) => {

    setCORS(res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'POST')    { res.status(405).json({ error: 'Method not allowed' }); return; }

    const user = await verifyAuth(req, res);
    if (!user) return;

    const apiKey = anthropicKey.value();
    if (!apiKey) { res.status(500).json({ error: 'Anthropic API kulcs nincs beállítva!' }); return; }

    const messages = req.body?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({ error: 'Hiányzó paraméter: messages' }); return;
    }

    // WP Basic Auth az olvasó toolokhoz (a runWpProxy mintája)
    const credentials  = Buffer.from(`${wpUser.value()}:${wpPassword.value()}`).toString('base64');
    const wpAuthHeader = { 'Authorization': `Basic ${credentials}`, 'Content-Type': 'application/json' };

    // NDJSON streaming válasz
    res.set('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.set('Cache-Control', 'no-cache');
    res.set('X-Accel-Buffering', 'no');
    const send = obj => res.write(JSON.stringify(obj) + '\n');

    const client = new Anthropic({ apiKey });
    const tools = [
        { type: 'web_search_20260209', name: 'web_search', max_uses: 5 },
        ...AGENT_TOOL_DEFINITIONS,
    ];

    const convo    = [...messages];
    const startLen = convo.length;
    const usage    = { input_tokens: 0, output_tokens: 0,
                       cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

    try {
        for (let iter = 0; iter < AGENT_MAX_ITERATIONS; iter++) {

            const stream = client.messages.stream({
                model: AGENT_MODEL,
                max_tokens: AGENT_MAX_TOKENS,
                thinking: { type: 'adaptive' },
                system: buildSystemBlocks(),
                tools,
                messages: convo,
            });

            stream.on('streamEvent', ev => {
                if (ev.type === 'content_block_start' && ev.content_block?.type === 'server_tool_use') {
                    send({ t: 'status', text: TOOL_STATUS_LABELS.web_search });
                }
                if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
                    send({ t: 'delta', text: ev.delta.text });
                }
            });

            const msg = await stream.finalMessage();

            usage.input_tokens                += msg.usage?.input_tokens || 0;
            usage.output_tokens               += msg.usage?.output_tokens || 0;
            usage.cache_read_input_tokens     += msg.usage?.cache_read_input_tokens || 0;
            usage.cache_creation_input_tokens += msg.usage?.cache_creation_input_tokens || 0;

            convo.push({ role: 'assistant', content: msg.content });

            // Szerver-tool (webes keresés) iterációs limit: automatikus folytatás
            if (msg.stop_reason === 'pause_turn') continue;

            if (msg.stop_reason === 'tool_use') {
                const toolUses = msg.content.filter(b => b.type === 'tool_use');
                const results  = [];

                for (const tu of toolUses) {
                    if (tu.name === 'propose_save') {
                        send({ t: 'proposal', proposal: tu.input });
                        results.push({
                            type: 'tool_result', tool_use_id: tu.id,
                            content: 'A mentési javaslat megjelent a szerkesztőnek jóváhagyó kártyán. Ne ismételd meg a teljes tartalmat, csak röviden zárd le a válaszod.',
                        });
                        continue;
                    }
                    send({ t: 'status', text: TOOL_STATUS_LABELS[tu.name] || `⚙️ ${tu.name}…` });
                    try {
                        const resultStr = await runAgentTool(tu.name, tu.input, wpAuthHeader);
                        results.push({ type: 'tool_result', tool_use_id: tu.id, content: resultStr });
                    } catch (err) {
                        console.error(`[aiAgent] tool hiba (${tu.name}):`, err);
                        results.push({ type: 'tool_result', tool_use_id: tu.id,
                                       content: `Hiba a tool futtatásakor: ${err.message}`, is_error: true });
                    }
                }

                convo.push({ role: 'user', content: results });
                continue;
            }

            if (msg.stop_reason === 'refusal') {
                send({ t: 'error', error: 'A modell biztonsági okból elutasította ezt a kérést. Fogalmazd át, vagy próbáld más témával.' });
            } else if (msg.stop_reason === 'max_tokens') {
                send({ t: 'error', error: 'A válasz elérte a hosszkorlátot és megszakadt. Kérj rövidebb vagy több részre bontott tartalmat.' });
            }
            break; // end_turn (vagy hibaág) – kész a kör
        }

        send({ t: 'done', newMessages: convo.slice(startLen), usage });
        console.log(`[aiAgent] kör kész – user=${user.email} usage=${JSON.stringify(usage)}`);

    } catch (err) {
        console.error('[aiAgent] hiba:', err);
        send({ t: 'error', error: 'Szerver hiba: ' + err.message });
    }

    res.end();
});
