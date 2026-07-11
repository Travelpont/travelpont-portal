// =====================================================
// ai-agent.js – AI Műhely chat-kliens
//
// - A teljes beszélgetés-history kliensoldalon él (oldal-újratöltéskor
//   elvész); minden körben az egész megy fel az aiAgent functionnek.
// - A 'done' event newMessages tömbjét VÁLTOZATLANUL fűzzük a historyhoz
//   (thinking/tool blokkokkal együtt – ezeket a modell így várja vissza).
// - Mentés SOSEM automatikus: a proposal-kártya [Mentés] gombja a meglévő
//   uticelProxy/blogProxy útvonalon ír, mint a kézi szerkesztő.
// =====================================================

import { auth } from './firebase-config.js';
import { apiCall, toast } from './auth-guard.js';
import { API_CONFIG } from './api-config.js';

let history = [];      // verbatim Anthropic API üzenetek
let busy = false;

// ---- Beszélgetés-mentés a böngészőben: túléli a fülváltást/újratöltést ----
const LS_HISTORY = 'tp_ai_chat_v1';
const LS_HANDLED = 'tp_ai_handled_v1';   // már elintézett (mentett/elvetett/átadott) javaslatok tool_use-id-i
let handledProposals = new Set();

function saveHistory() {
    try {
        localStorage.setItem(LS_HISTORY, JSON.stringify(history));
        localStorage.setItem(LS_HANDLED, JSON.stringify([...handledProposals]));
    } catch {
        // pl. QuotaExceeded nagyon hosszú beszélgetésnél – a chat memóriában megy tovább
        console.warn('[AI Műhely] a beszélgetés túl nagy a helyi mentéshez – újratöltésnél elveszhet.');
    }
}

function loadHistory() {
    try {
        history = JSON.parse(localStorage.getItem(LS_HISTORY) || '[]');
        handledProposals = new Set(JSON.parse(localStorage.getItem(LS_HANDLED) || '[]'));
    } catch {
        history = [];
        handledProposals = new Set();
    }
}

function clearChat() {
    localStorage.removeItem(LS_HISTORY);
    localStorage.removeItem(LS_HANDLED);
    history = [];
    handledProposals = new Set();
    window.location.reload();
}

function markHandled(pid) {
    if (pid) { handledProposals.add(pid); saveHistory(); }
}

// ---- Gyorsgomb-sablonok ----
const QUICK_PROMPTS = [
    { icon: '🌍', label: 'Úticél-leírás',      prompt: 'Írj teljes bemutató leírást a következő úticélhoz: ' },
    { icon: '📅', label: 'Esemény-cikk',        prompt: 'Írj blog-cikket (esemény-cikk) a következő eseményről, friss adatokkal a netről: ' },
    { icon: '📱', label: 'Facebook-poszt',      prompt: 'Írj Facebook-posztot a következő témáról, a kapcsolódó ajánlataink adataival: ' },
    { icon: '🎬', label: 'TikTok-forgatókönyv', prompt: 'Készíts TikTok/Reels forgatókönyvet (jelenetlista + narráció) a következő témára: ' },
    { icon: '🗓️', label: 'Tartalomnaptár',      prompt: 'Készíts 2 hetes tartalomnaptár-javaslatot a meglévő ajánlataink és úticéljaink alapján (FB/Insta/TikTok).' },
];

const PROPOSAL_TYPE_LABELS = {
    uticel_update: '🌍 Úticél frissítése',
    uticel_create: '🌍 Új úticél (piszkozat)',
    blog_draft:    '📝 Blog-bejegyzés (piszkozat)',
};

// ---- DOM referenciák (initAiMuhely tölti fel) ----
let elMessages, elInput, elSendBtn, elStatus, elQuick;

export function initAiMuhely() {
    elMessages = document.getElementById('chatMessages');
    elInput    = document.getElementById('chatInput');
    elSendBtn  = document.getElementById('chatSendBtn');
    elStatus   = document.getElementById('chatStatus');
    elQuick    = document.getElementById('quickButtons');

    // Korábbi beszélgetés visszatöltése (fülváltás/újratöltés után)
    loadHistory();
    renderTranscript();

    const newChatBtn = document.getElementById('newChatBtn');
    if (newChatBtn) newChatBtn.addEventListener('click', () => {
        if (history.length === 0 || confirm('Új beszélgetést kezdesz? A mostani eltűnik.')) clearChat();
    });

    elQuick.innerHTML = QUICK_PROMPTS.map((q, i) =>
        `<button class="tp-quick-btn" data-i="${i}" type="button">${q.icon} ${q.label}</button>`).join('');
    elQuick.querySelectorAll('.tp-quick-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            elInput.value = QUICK_PROMPTS[parseInt(btn.dataset.i)].prompt;
            elInput.focus();
            elInput.setSelectionRange(elInput.value.length, elInput.value.length);
        });
    });

    elSendBtn.addEventListener('click', onSend);
    elInput.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); }
    });
}

async function onSend() {
    const text = elInput.value.trim();
    if (!text || busy) return;
    elInput.value = '';
    await runTurn(text);
}

// ---- A mentett historyból újrarajzolja a látható beszélgetést ----
// user string-üzenet → user buborék; assistant text-blokkok → assistant buborék;
// propose_save tool_use → jóváhagyó kártya (ha még nincs elintézve);
// tool-result user-üzenetek (tömb content) → nem látszanak.
function renderTranscript() {
    if (history.length === 0) return;

    for (const msg of history) {
        if (msg.role === 'user' && typeof msg.content === 'string') {
            addBubble('user', escapeHtml(msg.content));
            continue;
        }
        if (msg.role === 'assistant' && Array.isArray(msg.content)) {
            const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
            if (text.trim()) addBubble('assistant', renderMarkdown(text));
            for (const b of msg.content) {
                if (b.type === 'tool_use' && b.name === 'propose_save') {
                    if (handledProposals.has(b.id)) {
                        addBubble('assistant', '💾 <em>Mentési javaslat (már elintézve)</em>');
                    } else {
                        addProposalCard(b.input, b.id);
                    }
                }
            }
        }
    }
    scrollToBottom();
}

// =====================================================
// Egy agent-kör: user-üzenet → streaming fetch → eventek feldolgozása
// =====================================================
async function runTurn(userText) {
    busy = true;
    elSendBtn.disabled = true;
    elInput.disabled = true;

    history.push({ role: 'user', content: userText });
    addBubble('user', escapeHtml(userText));

    const assistantBubble = addBubble('assistant', '');
    let assistantRaw = '';
    setStatus('🤔 Gondolkodom…');

    try {
        const token = await auth.currentUser.getIdToken();
        const res = await fetch(API_CONFIG.AI_AGENT_URL, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: history }),
        });

        if (!res.ok || !res.body) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || `Hiba (${res.status})`);
        }

        // ---- NDJSON stream olvasása soronként ----
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let gotDone = false;

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            let nl;
            while ((nl = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, nl).trim();
                buffer = buffer.slice(nl + 1);
                if (!line) continue;

                let ev;
                try { ev = JSON.parse(line); } catch { continue; }

                switch (ev.t) {
                    case 'status':
                        setStatus(ev.text);
                        break;
                    case 'delta':
                        assistantRaw += ev.text;
                        assistantBubble.innerHTML = renderMarkdown(assistantRaw);
                        scrollToBottom();
                        break;
                    case 'proposal':
                        addProposalCard(ev.proposal, ev.pid);
                        break;
                    case 'done':
                        gotDone = true;
                        history.push(...(ev.newMessages || []));
                        saveHistory();
                        logUsage(ev.usage);
                        break;
                    case 'error':
                        toast(ev.error, 'error');
                        assistantRaw += `\n\n⚠️ ${ev.error}`;
                        assistantBubble.innerHTML = renderMarkdown(assistantRaw);
                        break;
                }
            }
        }

        if (!gotDone) {
            // A kapcsolat 'done' nélkül szakadt meg: a history-ból kivesszük a
            // user-üzenetet, hogy a következő kérés konzisztens maradjon.
            history.pop();
            saveHistory();
            toast('A kapcsolat megszakadt válasz közben – próbáld újra.', 'error');
        }
        if (!assistantRaw) assistantBubble.remove();

    } catch (e) {
        history.pop(); // a felküldött user-üzenet visszavonása
        saveHistory();
        assistantBubble.remove();
        toast('AI hiba: ' + e.message, 'error');
    } finally {
        setStatus('');
        busy = false;
        elSendBtn.disabled = false;
        elInput.disabled = false;
        elInput.focus();
    }
}

// =====================================================
// Jóváhagyó kártya (propose_save)
// =====================================================
function addProposalCard(p, pid) {
    const card = document.createElement('div');
    card.className = 'tp-proposal-card';

    const typeLabel = PROPOSAL_TYPE_LABELS[p.tipus] || p.tipus;
    const needsCim  = p.tipus !== 'uticel_update' || p.cim;
    const isUticel  = p.tipus === 'uticel_update' || p.tipus === 'uticel_create';

    card.innerHTML = `
        <div class="tp-proposal-head">
            <strong>💾 Mentési javaslat – ${typeLabel}</strong>
            ${p.indoklas ? `<div class="tp-proposal-reason">${escapeHtml(p.indoklas)}</div>` : ''}
            ${p.tipus === 'uticel_update' ? `<div class="tp-proposal-warn">⚠️ Meglévő úticélt módosít – ha az publikált, a változás azonnal élesedik.</div>` : ''}
        </div>
        ${needsCim ? `
        <label class="input-label">Cím</label>
        <input class="input-field" data-f="cim" value="${escapeAttr(p.cim || '')}">` : ''}
        ${isUticel ? `
        <label class="input-label">Rövid leírás (teaser)</label>
        <textarea class="input-field" data-f="leiras" rows="2">${escapeHtml(p.leiras || '')}</textarea>` : ''}
        <label class="input-label">Tartalom (HTML) – <a href="#" data-toggle="preview">előnézet be/ki</a></label>
        <textarea class="input-field tp-proposal-html" data-f="tartalom_html" rows="10">${escapeHtml(p.tartalom_html || '')}</textarea>
        <div class="tp-proposal-preview" style="display:none;"></div>
        ${p.seo_title !== undefined || p.seo_metadesc !== undefined ? `
        <label class="input-label">SEO cím</label>
        <input class="input-field" data-f="seo_title" value="${escapeAttr(p.seo_title || '')}" maxlength="70">
        <label class="input-label">SEO meta-leírás</label>
        <textarea class="input-field" data-f="seo_metadesc" rows="2" maxlength="200">${escapeHtml(p.seo_metadesc || '')}</textarea>` : ''}
        <div class="tp-proposal-actions">
            ${isUticel ? `<button class="btn btn-primary btn-sm" data-act="edit">📝 Szerkesztés az Úticéloknál</button>` : ''}
            <button class="btn ${isUticel ? 'btn-ghost' : 'btn-primary'} btn-sm" data-act="save">💾 Mentés azonnal</button>
            <button class="btn btn-ghost btn-sm" data-act="dismiss">Elvetés</button>
        </div>`;

    card.querySelector('[data-toggle="preview"]').addEventListener('click', e => {
        e.preventDefault();
        const ta = card.querySelector('[data-f="tartalom_html"]');
        const pv = card.querySelector('.tp-proposal-preview');
        const showPreview = pv.style.display === 'none';
        pv.innerHTML = ta.value;
        pv.style.display = showPreview ? 'block' : 'none';
        ta.style.display = showPreview ? 'none' : 'block';
    });

    card.querySelector('[data-act="dismiss"]').addEventListener('click', () => {
        markHandled(pid);
        card.innerHTML = '<div class="tp-proposal-head" style="opacity:0.6;">✖️ Javaslat elvetve</div>';
    });

    card.querySelector('[data-act="save"]').addEventListener('click', () => saveProposal(card, p, pid));

    removeEmptyNote();

    // „Szerkesztés az Úticéloknál": NEM ment semmit – a (kártyán esetleg már
    // átírt) javaslatot átadja az Úticélok szerkesztőnek (új fülön, hogy a
    // chat megmaradjon), ott a szerkesztő tölt fel képet és Ő ment.
    const editBtn = card.querySelector('[data-act="edit"]');
    if (editBtn) {
        editBtn.addEventListener('click', () => {
            const handoff = {
                tipus:        p.tipus,
                id:           p.id || null,
                parent_id:    p.parent_id || 0,
                cim:          readCardField(card, 'cim', p.cim || ''),
                leiras:       readCardField(card, 'leiras', p.leiras || ''),
                tartalom_html: readCardField(card, 'tartalom_html', p.tartalom_html || ''),
                seo_title:    readCardField(card, 'seo_title', p.seo_title || ''),
                seo_metadesc: readCardField(card, 'seo_metadesc', p.seo_metadesc || ''),
            };
            localStorage.setItem('tp_ai_proposal', JSON.stringify(handoff));
            markHandled(pid);
            window.open('uticelok.html', '_blank');
            card.innerHTML = '<div class="tp-proposal-head">📝 Átadva az Úticélok szerkesztőnek (új fülön) – ott nézd át, tölts fel képet, és ott mentsd.</div>';
        });
    }

    elMessages.appendChild(card);
    scrollToBottom();
}

function readCardField(card, name, fallback) {
    const el = card.querySelector(`[data-f="${name}"]`);
    return el ? el.value : fallback;
}

async function saveProposal(card, p, pid) {
    const saveBtn = card.querySelector('[data-act="save"]');
    saveBtn.disabled = true; saveBtn.textContent = 'Mentés…';

    const cim      = readCardField(card, 'cim', p.cim || '');
    const leiras   = readCardField(card, 'leiras', p.leiras || '');
    const tartalom = readCardField(card, 'tartalom_html', p.tartalom_html || '');
    const seoTitle = readCardField(card, 'seo_title', p.seo_title || '');
    const seoDesc  = readCardField(card, 'seo_metadesc', p.seo_metadesc || '');

    try {
        let savedLink = '';

        if (p.tipus === 'uticel_update') {
            if (!p.id) throw new Error('Hiányzik az úticél ID – kérd meg az AI-t, hogy adja meg.');
            // Teljes body: a meglévő rekordot lekérjük, és csak a javasolt mezőket írjuk felül,
            // hogy a nem érintett mezők (szülő, státusz, ki nem töltött SEO) ne vesszenek el.
            const current = await apiCall(API_CONFIG.UTICEL_PROXY_URL, { action: 'get', extraQuery: { id: p.id } });
            const body = {
                title:        cim || current.title,
                content:      tartalom,
                status:       current.status,
                parent:       current.parent,
                tpu_leiras:   leiras || current.tpu_leiras,
                seo_title:    seoTitle || current.seo_title,
                seo_metadesc: seoDesc || current.seo_metadesc,
            };
            const saved = await apiCall(API_CONFIG.UTICEL_PROXY_URL, { action: 'update', extraQuery: { id: p.id }, body });
            savedLink = saved.permalink || '';

        } else if (p.tipus === 'uticel_create') {
            if (!cim) throw new Error('A cím megadása kötelező.');
            const body = {
                title: cim, content: tartalom, status: 'draft',
                parent: p.parent_id || 0, tpu_leiras: leiras,
                seo_title: seoTitle, seo_metadesc: seoDesc,
            };
            const saved = await apiCall(API_CONFIG.UTICEL_PROXY_URL, { action: 'create', body });
            savedLink = saved.permalink || '';

        } else if (p.tipus === 'blog_draft') {
            if (!cim) throw new Error('A cím megadása kötelező.');
            const body = { title: cim, content: tartalom };
            if (p.kapcsolt_uticel_id) body.meta = { tpu_kapcsolt_uticel: String(p.kapcsolt_uticel_id) };
            let saved;
            try {
                saved = await apiCall(API_CONFIG.BLOG_PROXY_URL, { action: 'create', body });
            } catch (err) {
                if (body.meta) {
                    // Ha a meta-mező REST-ben nem írható, mentés nélküle + jelzés
                    delete body.meta;
                    saved = await apiCall(API_CONFIG.BLOG_PROXY_URL, { action: 'create', body });
                    toast('A kapcsolt úticélt nem sikerült beállítani – állítsd be kézzel a WP-adminban.', 'info');
                } else {
                    throw err;
                }
            }
            savedLink = saved.link || '';

        } else {
            throw new Error('Ismeretlen javaslat-típus: ' + p.tipus);
        }

        markHandled(pid);
        card.innerHTML = `<div class="tp-proposal-head">✅ Elmentve!
            ${p.tipus !== 'uticel_update' ? ' (piszkozatként – élesítés a megfelelő modulban/WP-adminban)' : ''}
            ${savedLink ? ` <a href="${savedLink}" target="_blank">Megnézem ↗</a>` : ''}</div>`;
        toast('Elmentve!', 'success');

    } catch (e) {
        toast('Mentés sikertelen: ' + e.message, 'error');
        saveBtn.disabled = false; saveBtn.textContent = '💾 Mentés a weboldalra';
    }
}

// =====================================================
// Megjelenítés-segédek
// =====================================================
function removeEmptyNote() {
    document.getElementById('chatEmpty')?.remove();
}

function addBubble(role, html) {
    removeEmptyNote();
    const div = document.createElement('div');
    div.className = `tp-msg tp-msg-${role}`;
    div.innerHTML = html;
    elMessages.appendChild(div);
    scrollToBottom();
    return div;
}

function setStatus(text) {
    elStatus.textContent = text;
    elStatus.style.display = text ? 'block' : 'none';
    if (text) scrollToBottom();
}

function scrollToBottom() {
    elMessages.scrollTop = elMessages.scrollHeight;
}

function logUsage(u) {
    if (!u) return;
    console.log(`[AI Műhely] tokenek – be: ${u.input_tokens} (cache-olvasás: ${u.cache_read_input_tokens}, cache-írás: ${u.cache_creation_input_tokens}), ki: ${u.output_tokens}`);
    const el = document.getElementById('usageInfo');
    if (el) el.textContent = `Utolsó kör: ${u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens} token be / ${u.output_tokens} token ki`;
}

// ---- Mini markdown-renderelő (escape-elt szövegen dolgozik) ----
function renderMarkdown(raw) {
    const esc = escapeHtml(raw);
    const lines = esc.split('\n');
    const out = [];
    let inList = false;

    for (const line of lines) {
        const li = line.match(/^\s*[-*]\s+(.*)$/);
        if (li) {
            if (!inList) { out.push('<ul>'); inList = true; }
            out.push(`<li>${inline(li[1])}</li>`);
            continue;
        }
        if (inList) { out.push('</ul>'); inList = false; }

        const h = line.match(/^(#{1,4})\s+(.*)$/);
        if (h) { out.push(`<div class="tp-md-h${h[1].length}">${inline(h[2])}</div>`); continue; }

        if (line.trim() === '') { out.push('<div class="tp-md-gap"></div>'); continue; }
        out.push(`<div>${inline(line)}</div>`);
    }
    if (inList) out.push('</ul>');
    return out.join('');

    function inline(s) {
        return s
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/`([^`]+)`/g, '<code>$1</code>');
    }
}

function escapeHtml(s) { return (s || '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function escapeAttr(s) { return (s ?? '').toString().replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
