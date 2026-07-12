// =====================================================
// ai-agent.js – AI Műhely chat-kliens
//
// - A beszélgetések Firestore-ban élnek (ai-store.js): beszélgetésenként
//   egy doc, az üzenetek subcollectionben – így fülváltás/újratöltés/másik
//   gép után is visszatölthetők, és fába rendezhetők (ország→régió→város).
// - A history verbatim Anthropic API üzenet-tömb; minden körben az egész
//   megy fel az aiAgent functionnek, a 'done' event newMessages tömbjét
//   VÁLTOZATLANUL fűzzük hozzá (thinking/tool blokkokkal együtt).
// - Mentés SOSEM automatikus: a proposal-kártya [Mentés] gombja a meglévő
//   uticelProxy/blogProxy útvonalon ír, mint a kézi szerkesztő – és mindig
//   piszkozatként, publikálás csak kézzel, átnézés után.
// =====================================================

import { auth } from './firebase-config.js';
import { apiCall, toast } from './auth-guard.js';
import { API_CONFIG } from './api-config.js';
import {
    listConversations, createConversation, updateConversation, deleteConversation,
    loadMessages, appendMessages, markHandled as storeMarkHandled,
    findConversationByUticelId,
} from './ai-store.js';

let history = [];              // verbatim Anthropic API üzenetek (aktuális beszélgetés)
let handledProposals = new Set();
let currentConv = null;        // aktuális beszélgetés-doc ({id, title, szint, ...}) vagy null
let conversations = [];        // a bal paneli lista cache-e
let busy = false;

// Régi (localStorage-os) mentés kulcsai – csak az egyszeri migrációhoz
const LS_HISTORY_LEGACY = 'tp_ai_chat_v1';
const LS_HANDLED_LEGACY = 'tp_ai_handled_v1';
const LS_AJANLATOK_DEFAULT = 'tp_ai_ajanlatok_default';

const DEFAULT_TITLE = 'Új beszélgetés';

const SZINT_LABEL = { orszag: 'Ország', regio: 'Régió', varos: 'Város', egyeb: 'Egyéb', altalanos: '' };
const SZINT_ICON  = { orszag: '🌍', regio: '🗺️', varos: '🏙️', egyeb: '📄', altalanos: '💬' };

// A javaslatkártya / handoff gyakorlati mezői – ugyanaz a szint-láthatóság,
// mint az uticelok.html „Adatok & gyakorlati infó" szekciójában.
const INFO_FIELDS = [
    ['penznem',         'Pénznem',                    ['orszag']],
    ['nyelv',           'Beszélt nyelv',              ['orszag']],
    ['idozona',         'Időzóna',                    ['orszag']],
    ['beutazas',        'Be- és kiutazási tudnivaló', ['orszag']],
    ['legjobb_idoszak', 'Legjobb utazási időszak',    ['regio', 'varos']],
    ['repuloter',       'Legközelebbi repülőtér',     ['varos']],
    ['repules_ido',     'Repülési idő Budapestről',   ['varos']],
];

function markHandled(pid) {
    if (!pid) return;
    handledProposals.add(pid);
    if (currentConv) {
        storeMarkHandled(currentConv.id, pid).catch(e =>
            console.warn('[AI Műhely] handled-jelölés mentése sikertelen:', e));
    }
}

// ---- Gyorsgomb-sablonok ----
const QUICK_PROMPTS = [
    { icon: '🌍', label: 'Úticél-leírás',      prompt: 'Írj teljes bemutató leírást a következő úticélhoz: ' },
    { icon: '📅', label: 'Esemény-cikk',        prompt: 'Írj blog-cikket (esemény-cikk) a következő eseményről, friss adatokkal a netről: ' },
    { icon: '📱', label: 'Facebook-poszt',      prompt: 'Írj Facebook-posztot a következő témáról, a kapcsolódó ajánlataink adataival: ', needsAjanlatok: true },
    { icon: '🎬', label: 'TikTok-forgatókönyv', prompt: 'Készíts TikTok/Reels forgatókönyvet (jelenetlista + narráció) a következő témára: ' },
    { icon: '🗓️', label: 'Tartalomnaptár',      prompt: 'Készíts 2 hetes tartalomnaptár-javaslatot a meglévő ajánlataink és úticéljaink alapján (FB/Insta/TikTok).', needsAjanlatok: true },
];

const PROPOSAL_TYPE_LABELS = {
    uticel_update: '🌍 Úticél frissítése',
    uticel_create: '🌍 Új úticél (piszkozat)',
    blog_draft:    '📝 Blog-bejegyzés (piszkozat)',
};

const EMPTY_NOTE_HTML = `<div class="tp-chat-empty" id="chatEmpty">
    👋 Szia! Én a TravelPont AI-segédje vagyok.<br>
    Kérhetsz tőlem úticél-leírást, esemény-cikket, Facebook-posztot,
    TikTok-forgatókönyvet vagy tartalomnaptárat. Friss adatokért a neten
    is keresek, és amit jóváhagysz, elmentem a weboldalra.<br>
    Kezdd egy gyorsgombbal, vagy írj szabadon!</div>`;

// ---- DOM referenciák (initAiMuhely tölti fel) ----
let elMessages, elInput, elSendBtn, elStatus, elQuick, elConvList, elToggle, elConvTitle;

export async function initAiMuhely() {
    elMessages  = document.getElementById('chatMessages');
    elInput     = document.getElementById('chatInput');
    elSendBtn   = document.getElementById('chatSendBtn');
    elStatus    = document.getElementById('chatStatus');
    elQuick     = document.getElementById('quickButtons');
    elConvList  = document.getElementById('convList');
    elToggle    = document.getElementById('ajanlatokToggle');
    elConvTitle = document.getElementById('convTitle');

    const newChatBtn = document.getElementById('newChatBtn');
    if (newChatBtn) newChatBtn.addEventListener('click', () => {
        if (busy) return;
        startNewChat();
    });

    elQuick.innerHTML = QUICK_PROMPTS.map((q, i) =>
        `<button class="tp-quick-btn" data-i="${i}" type="button">${q.icon} ${q.label}</button>`).join('');
    elQuick.querySelectorAll('.tp-quick-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const q = QUICK_PROMPTS[parseInt(btn.dataset.i)];
            if (q.needsAjanlatok && !elToggle.checked) {
                toast('Tipp: ehhez érdemes bekapcsolni az „✈️ Ajánlatok keresése" kapcsolót.', 'info');
            }
            elInput.value = q.prompt;
            elInput.focus();
            elInput.setSelectionRange(elInput.value.length, elInput.value.length);
        });
    });

    // ✈️ Ajánlatok keresése kapcsoló: beszélgetésenként tárolt állapot;
    // új (még nem létező) beszélgetésnél a localStorage-os alapértelmezés él.
    elToggle.checked = localStorage.getItem(LS_AJANLATOK_DEFAULT) === '1';
    elToggle.addEventListener('change', () => {
        const on = elToggle.checked;
        localStorage.setItem(LS_AJANLATOK_DEFAULT, on ? '1' : '0');
        if (currentConv) {
            currentConv.ajanlatokEnabled = on;
            updateConversation(currentConv.id, { ajanlatokEnabled: on })
                .catch(e => console.warn('[AI Műhely] kapcsoló mentése sikertelen:', e));
        }
    });

    elSendBtn.addEventListener('click', onSend);
    elInput.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); }
    });

    renderTranscript();

    // Egyszeri migráció a régi localStorage-os mentésből, majd lista-betöltés
    try { await migrateLegacyHistory(); } catch (e) {
        console.warn('[AI Műhely] localStorage-migráció sikertelen:', e);
    }
    await refreshConvList();
}

function startNewChat() {
    currentConv = null;
    history = [];
    handledProposals = new Set();
    elToggle.checked = localStorage.getItem(LS_AJANLATOK_DEFAULT) === '1';
    renderTranscript();
    renderConvList();
    updateConvTitle();
    elInput.focus();
}

function updateConvTitle() {
    if (!elConvTitle) return;
    elConvTitle.textContent = currentConv
        ? `${SZINT_ICON[currentConv.szint] || '💬'} ${currentConv.title || DEFAULT_TITLE}`
        : '';
}

// =====================================================
// Beszélgetés-lista (bal panel): fa a parentConvId alapján
// =====================================================
async function refreshConvList() {
    if (!elConvList) return;
    try {
        conversations = await listConversations();
    } catch (e) {
        elConvList.innerHTML = `<p class="tp-conv-note">A beszélgetés-lista nem tölthető be: ${escapeHtml(e.message)}</p>`;
        return;
    }
    renderConvList();
}

// Szülő előbb, utána a gyerekei (rekurzív); ismeretlen/hiányzó szülő → gyökér.
// A visited-készlet a (két áthelyezéssel előállítható) körök ellen véd.
function orderedConvTree(list) {
    const ids = new Set(list.map(c => c.id));
    const byParent = {};
    list.forEach(c => {
        const p = (c.parentConvId && ids.has(c.parentConvId)) ? c.parentConvId : '';
        (byParent[p] = byParent[p] || []).push(c);
    });
    const out = [];
    const visited = new Set();
    (function walk(pid, depth) {
        (byParent[pid] || []).forEach(c => {
            if (visited.has(c.id)) return;
            visited.add(c.id);
            out.push({ conv: c, depth });
            walk(c.id, depth + 1);
        });
    })('', 0);
    list.forEach(c => { if (!visited.has(c.id)) out.push({ conv: c, depth: 0 }); });
    return out;
}

function relTime(ts) {
    const d = ts?.toDate ? ts.toDate() : (ts ? new Date(ts) : null);
    if (!d) return '';
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 3600)   return `${Math.max(1, Math.round(diff / 60))} perce`;
    if (diff < 86400)  return `${Math.round(diff / 3600)} órája`;
    if (diff < 604800) return `${Math.round(diff / 86400)} napja`;
    return d.toLocaleDateString('hu-HU');
}

function renderConvList() {
    if (!elConvList) return;
    if (conversations.length === 0) {
        elConvList.innerHTML = '<p class="tp-conv-note">Még nincs mentett beszélgetés.</p>';
        return;
    }
    const ordered = orderedConvTree(conversations);
    elConvList.innerHTML = ordered.map(({ conv, depth }) => `
        <div class="tp-conv-item ${currentConv && conv.id === currentConv.id ? 'active' : ''}"
             data-id="${conv.id}" style="padding-left:${8 + Math.min(depth, 3) * 16}px;">
            <div class="tp-conv-main">
                <div class="tp-conv-title">${SZINT_ICON[conv.szint] || '💬'} ${escapeHtml(conv.title || DEFAULT_TITLE)}</div>
                <div class="tp-conv-sub">${relTime(conv.updatedAt)}</div>
            </div>
            <div class="tp-conv-actions">
                <button type="button" data-act="rename" title="Átnevezés">✏️</button>
                <button type="button" data-act="move" title="Áthelyezés a fában">📁</button>
                <button type="button" data-act="delete" title="Törlés">🗑️</button>
            </div>
        </div>`).join('');

    elConvList.querySelectorAll('.tp-conv-item').forEach(row => {
        const id = row.dataset.id;
        row.addEventListener('click', e => {
            if (e.target.closest('[data-act]')) return;
            if (!busy) selectConversation(id);
        });
        row.querySelector('[data-act="rename"]').addEventListener('click', () => renameConversation(id));
        row.querySelector('[data-act="move"]').addEventListener('click', () => moveConversation(id, row));
        row.querySelector('[data-act="delete"]').addEventListener('click', () => removeConversation(id));
    });
}

async function selectConversation(convId) {
    const conv = conversations.find(c => c.id === convId);
    if (!conv) return;
    try {
        setStatus('📂 Beszélgetés betöltése…');
        history = await loadMessages(convId);
        currentConv = conv;
        handledProposals = new Set(conv.handledProposals || []);
        elToggle.checked = !!conv.ajanlatokEnabled;
        renderTranscript();
        renderConvList();
        updateConvTitle();
    } catch (e) {
        toast('Beszélgetés betöltése sikertelen: ' + e.message, 'error');
    } finally {
        setStatus('');
    }
}

async function renameConversation(convId) {
    const conv = conversations.find(c => c.id === convId);
    if (!conv) return;
    const title = prompt('Beszélgetés új neve:', conv.title || DEFAULT_TITLE);
    if (!title || title.trim() === '' || title === conv.title) return;
    try {
        await updateConversation(convId, { title: title.trim() });
        conv.title = title.trim();
        if (currentConv?.id === convId) { currentConv.title = conv.title; updateConvTitle(); }
        renderConvList();
    } catch (e) {
        toast('Átnevezés sikertelen: ' + e.message, 'error');
    }
}

// Áthelyezés: a sor alatt egy legördülő jelenik meg a lehetséges új szülőkkel
// (önmaga és a leszármazottai kizárva, hogy ne keletkezzen kör).
function moveConversation(convId, row) {
    const existing = row.querySelector('.tp-conv-move');
    if (existing) { existing.remove(); return; } // ha már nyitva, zárjuk

    const descendants = new Set([convId]);
    let grew = true;
    while (grew) {
        grew = false;
        conversations.forEach(c => {
            if (c.parentConvId && descendants.has(c.parentConvId) && !descendants.has(c.id)) {
                descendants.add(c.id); grew = true;
            }
        });
    }
    const options = ['<option value="">— gyökér (nincs szülő) —</option>']
        .concat(conversations.filter(c => !descendants.has(c.id)).map(c =>
            `<option value="${c.id}">${SZINT_ICON[c.szint] || '💬'} ${escapeHtml(c.title || DEFAULT_TITLE)}</option>`));
    const wrap = document.createElement('div');
    wrap.className = 'tp-conv-move';
    wrap.innerHTML = `<select class="input-field">${options.join('')}</select>`;
    const sel = wrap.querySelector('select');
    const conv = conversations.find(c => c.id === convId);
    sel.value = conv?.parentConvId || '';
    sel.addEventListener('click', e => e.stopPropagation());
    sel.addEventListener('change', async () => {
        try {
            const parentConvId = sel.value || null;
            await updateConversation(convId, { parentConvId });
            if (conv) conv.parentConvId = parentConvId;
            renderConvList();
        } catch (e) {
            toast('Áthelyezés sikertelen: ' + e.message, 'error');
        }
    });
    row.appendChild(wrap);
}

async function removeConversation(convId) {
    const conv = conversations.find(c => c.id === convId);
    if (!conv) return;
    if (!confirm(`Biztosan törlöd a(z) „${conv.title || DEFAULT_TITLE}" beszélgetést? Ez nem visszavonható.`)) return;
    try {
        await deleteConversation(convId);
        conversations = conversations.filter(c => c.id !== convId);
        if (currentConv?.id === convId) startNewChat();
        else renderConvList();
        toast('Beszélgetés törölve.', 'success');
    } catch (e) {
        toast('Törlés sikertelen: ' + e.message, 'error');
    }
}

// ---- Automatikus elnevezés + fába sorolás az első propose_save alapján ----
function autoNameFromProposal(p) {
    if (!currentConv) return;
    if (currentConv.title && currentConv.title !== DEFAULT_TITLE) return;

    const patch = {};
    if (p.tipus === 'uticel_create' || p.tipus === 'uticel_update') {
        const szintLabel = SZINT_LABEL[p.szint] || '';
        patch.title = `${p.cim || 'Úticél'}${szintLabel ? ' – ' + szintLabel : ''}`;
        patch.szint = p.szint || 'egyeb';
        if (p.id) patch.uticelId = p.id;
        if (p.parent_id) {
            patch.parentUticelId = p.parent_id;
            const parentConv = findConversationByUticelId(conversations, p.parent_id);
            if (parentConv) {
                patch.parentConvId = parentConv.id;
                patch.parentCim = (parentConv.title || '').split(' – ')[0];
            }
        }
    } else if (p.tipus === 'blog_draft') {
        patch.title = p.cim || 'Blog-cikk';
        patch.szint = 'altalanos';
    } else {
        return;
    }

    Object.assign(currentConv, patch);
    updateConvTitle();
    updateConversation(currentConv.id, patch)
        .then(() => refreshConvList())
        .catch(e => console.warn('[AI Műhely] auto-elnevezés mentése sikertelen:', e));
}

// ---- Egyszeri migráció: régi localStorage-os beszélgetés → Firestore ----
async function migrateLegacyHistory() {
    let legacy = [];
    try { legacy = JSON.parse(localStorage.getItem(LS_HISTORY_LEGACY) || '[]'); } catch { legacy = []; }
    if (Array.isArray(legacy) && legacy.length > 0
        && confirm('Van egy korábban helyben mentett beszélgetésed. Átmentsem a felhőbe?')) {
        let handled = [];
        try { handled = JSON.parse(localStorage.getItem(LS_HANDLED_LEGACY) || '[]'); } catch { handled = []; }
        const conv = await createConversation({ title: 'Korábbi beszélgetés', handledProposals: handled });
        await appendMessages(conv.id, legacy, 0);
        toast('A korábbi beszélgetés átkerült a felhőbe – a bal oldali listából nyithatod meg.', 'success');
    }
    localStorage.removeItem(LS_HISTORY_LEGACY);
    localStorage.removeItem(LS_HANDLED_LEGACY);
}

async function onSend() {
    const text = elInput.value.trim();
    if (!text || busy) return;
    elInput.value = '';
    await runTurn(text);
}

// ---- A betöltött historyból újrarajzolja a látható beszélgetést ----
// user string-üzenet → user buborék; assistant text-blokkok → assistant buborék;
// propose_save tool_use → jóváhagyó kártya (ha még nincs elintézve);
// tool-result user-üzenetek (tömb content) → nem látszanak.
function renderTranscript() {
    elMessages.innerHTML = '';
    if (history.length === 0) {
        elMessages.innerHTML = EMPTY_NOTE_HTML;
        return;
    }

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

    // A beszélgetés-doc lusta létrehozása az első üzenetnél
    let isNewConv = false;
    if (!currentConv) {
        try {
            currentConv = await createConversation({ ajanlatokEnabled: elToggle.checked });
            conversations.unshift(currentConv);
            isNewConv = true;
            renderConvList();
        } catch (e) {
            // Firestore-hiba ne blokkolja a chatet: a kör memóriából megy tovább
            console.warn('[AI Műhely] beszélgetés-doc létrehozása sikertelen:', e);
            toast('A beszélgetés felhő-mentése nem működik – a chat megy, de újratöltésnél elveszhet.', 'error');
        }
    }

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
            body: JSON.stringify({
                messages: history,
                ajanlatok: currentConv ? !!currentConv.ajanlatokEnabled : elToggle.checked,
                parent_context: currentConv?.parentUticelId
                    ? { id: currentConv.parentUticelId, cim: currentConv.parentCim || '' }
                    : null,
            }),
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
        let doneNewMessages = null;

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
                        autoNameFromProposal(ev.proposal);
                        break;
                    case 'done':
                        gotDone = true;
                        doneNewMessages = ev.newMessages || [];
                        history.push(...doneNewMessages);
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

        if (gotDone) {
            // A teljes kör (user-üzenet + az agent új üzenetei) mentése append-ként
            if (currentConv) {
                const prevCount = currentConv.msgCount || 0;
                const toSave = [{ role: 'user', content: userText }, ...doneNewMessages];
                try {
                    await appendMessages(currentConv.id, toSave, prevCount);
                    currentConv.msgCount = prevCount + toSave.length;
                } catch (e) {
                    console.warn('[AI Műhely] üzenetek felhő-mentése sikertelen:', e);
                    toast('A kör felhő-mentése nem sikerült – a chat memóriában folytatható.', 'error');
                }
            }
        } else {
            // A kapcsolat 'done' nélkül szakadt meg: a history-ból kivesszük a
            // user-üzenetet, hogy a következő kérés konzisztens maradjon.
            // FONTOS: maradandó hibabuborék is kell, nem csak toast – a toast
            // eltűnik, és a szerkesztő nem tudja, hogy a kör elveszett.
            history.pop();
            await cleanupOrphanConv(isNewConv);
            addBubble('assistant',
                '⚠️ <strong>A válasz megszakadt, mielőtt elkészült volna.</strong> ' +
                'A fenti szöveg és a kérésed NEM lett elmentve a beszélgetésbe – ' +
                'küldd el újra ugyanazt a kérést. (A beszélgetés korábbi része megvan.)');
            toast('A kapcsolat megszakadt válasz közben – kérd újra.', 'error');
        }
        if (!assistantRaw) assistantBubble.remove();

    } catch (e) {
        history.pop(); // a felküldött user-üzenet visszavonása
        await cleanupOrphanConv(isNewConv);
        assistantBubble.remove();
        addBubble('assistant',
            `⚠️ <strong>Hiba történt, a kör nem lett elmentve:</strong> ${escapeHtml(e.message)}<br>` +
            'Küldd el újra a kérést.');
        toast('AI hiba: ' + e.message, 'error');
    } finally {
        setStatus('');
        busy = false;
        elSendBtn.disabled = false;
        elInput.disabled = false;
        elInput.focus();
    }
}

// Sikertelen első kör után az üres beszélgetés-doc törlése
async function cleanupOrphanConv(isNewConv) {
    if (!isNewConv || !currentConv || (currentConv.msgCount || 0) > 0) return;
    const orphanId = currentConv.id;
    currentConv = null;
    conversations = conversations.filter(c => c.id !== orphanId);
    renderConvList();
    updateConvTitle();
    try { await deleteConversation(orphanId); } catch { /* nem kritikus */ }
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
    // Részleges frissítés: ha a javaslat nem tartalmaz szövegtörzset/teasert
    // (pl. csak a gyakorlati mezőket frissíti), azokat nem is mutatjuk,
    // és a mentés a meglévő szöveget változatlanul hagyja.
    const hasContent = p.tartalom_html !== undefined;
    const hasLeiras  = p.tipus === 'uticel_create' || p.leiras !== undefined;

    // Gyakorlati mezők: ami a javaslatban jött, VAGY a szinthez tartozik
    // (üresen is kirakjuk, hogy mentés előtt kézzel pótolható legyen)
    const infoFields = isUticel
        ? INFO_FIELDS.filter(([key, , szintek]) =>
            p[key] !== undefined || (p.szint && szintek.includes(p.szint)))
        : [];
    const infoHtml = infoFields.length ? `
        <div class="tp-proposal-info-head">📋 Adatok & gyakorlati infó</div>
        ${infoFields.map(([key, label]) => `
        <label class="input-label">${label}</label>
        <input class="input-field" data-f="${key}" value="${escapeAttr(p[key] || '')}">`).join('')}` : '';

    const szintBadge = isUticel && p.szint
        ? ` <span class="tp-proposal-szint">${SZINT_ICON[p.szint] || ''} ${SZINT_LABEL[p.szint] || p.szint}</span>` : '';

    card.innerHTML = `
        <div class="tp-proposal-head">
            <strong>💾 Mentési javaslat – ${typeLabel}</strong>${szintBadge}
            ${p.indoklas ? `<div class="tp-proposal-reason">${escapeHtml(p.indoklas)}</div>` : ''}
            ${p.tipus === 'uticel_update' ? `<div class="tp-proposal-warn">ℹ️ A mentés piszkozatként történik – ha az úticél publikált volt, átnézés után újra kell publikálni az Úticélok modulban vagy a WP-adminban.</div>` : ''}
        </div>
        ${needsCim ? `
        <label class="input-label">Cím</label>
        <input class="input-field" data-f="cim" value="${escapeAttr(p.cim || '')}">` : ''}
        ${isUticel && hasLeiras ? `
        <label class="input-label">Rövid leírás (teaser)</label>
        <textarea class="input-field" data-f="leiras" rows="2">${escapeHtml(p.leiras || '')}</textarea>` : ''}
        ${hasContent ? `
        <label class="input-label">Tartalom (HTML) – <a href="#" data-toggle="preview">előnézet be/ki</a></label>
        <textarea class="input-field tp-proposal-html" data-f="tartalom_html" rows="10">${escapeHtml(p.tartalom_html || '')}</textarea>
        <div class="tp-proposal-preview" style="display:none;"></div>` : `
        <div class="tp-proposal-note">ℹ️ A leírás szövegét ez a javaslat nem módosítja.</div>`}
        ${infoHtml}
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

    const previewToggle = card.querySelector('[data-toggle="preview"]');
    if (previewToggle) previewToggle.addEventListener('click', e => {
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
                szint:        p.szint || '',
                cim:          readCardField(card, 'cim', p.cim || ''),
                leiras:       readCardField(card, 'leiras', p.leiras || ''),
                tartalom_html: readCardField(card, 'tartalom_html', p.tartalom_html || ''),
                seo_title:    readCardField(card, 'seo_title', p.seo_title || ''),
                seo_metadesc: readCardField(card, 'seo_metadesc', p.seo_metadesc || ''),
            };
            for (const [key] of INFO_FIELDS) {
                handoff[key] = readCardField(card, key, p[key] || '');
            }
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
    const info     = {};
    for (const [key] of INFO_FIELDS) {
        info[key] = readCardField(card, key, p[key] || '');
    }

    try {
        let savedLink = '';

        if (p.tipus === 'uticel_update') {
            if (!p.id) throw new Error('Hiányzik az úticél ID – kérd meg az AI-t, hogy adja meg.');
            // Teljes body: a meglévő rekordot lekérjük, és csak a javasolt mezőket írjuk felül,
            // hogy a nem érintett mezők (szülő, ki nem töltött infó/SEO) ne vesszenek el.
            // A státusz viszont MINDIG draft: AI-mentés sosem élesíthet átnézés nélkül.
            const current = await apiCall(API_CONFIG.UTICEL_PROXY_URL, { action: 'get', extraQuery: { id: p.id } });
            const body = {
                title:        cim || current.title,
                content:      tartalom || current.content,
                status:       'draft',
                parent:       current.parent,
                tpu_leiras:   leiras || current.tpu_leiras,
                tpu_szint:    p.szint || current.tpu_szint,
                seo_title:    seoTitle || current.seo_title,
                seo_metadesc: seoDesc || current.seo_metadesc,
            };
            for (const [key] of INFO_FIELDS) {
                body[`tpu_${key}`] = info[key] || current[`tpu_${key}`] || '';
            }
            const saved = await apiCall(API_CONFIG.UTICEL_PROXY_URL, { action: 'update', extraQuery: { id: p.id }, body });
            savedLink = saved.permalink || '';

        } else if (p.tipus === 'uticel_create') {
            if (!cim) throw new Error('A cím megadása kötelező.');
            if (!tartalom) throw new Error('A bemutató szöveg hiányzik a javaslatból – kérd meg az AI-t, hogy adja meg.');
            const body = {
                title: cim, content: tartalom, status: 'draft',
                parent: p.parent_id || 0, tpu_leiras: leiras,
                tpu_szint: p.szint || '',
                seo_title: seoTitle, seo_metadesc: seoDesc,
            };
            for (const [key] of INFO_FIELDS) {
                body[`tpu_${key}`] = info[key] || '';
            }
            const saved = await apiCall(API_CONFIG.UTICEL_PROXY_URL, { action: 'create', body });
            savedLink = saved.permalink || '';
            // Az új WP-id-t a beszélgetéshez kötjük (fa-besoroláshoz, szülő-kontextushoz)
            if (currentConv && !currentConv.uticelId && saved.id) {
                currentConv.uticelId = saved.id;
                updateConversation(currentConv.id, { uticelId: saved.id }).catch(() => {});
            }

        } else if (p.tipus === 'blog_draft') {
            if (!cim) throw new Error('A cím megadása kötelező.');
            if (!tartalom) throw new Error('A cikk szövege hiányzik a javaslatból – kérd meg az AI-t, hogy adja meg.');
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
        card.innerHTML = `<div class="tp-proposal-head">✅ Elmentve piszkozatként – élesítés átnézés után a megfelelő modulban/WP-adminban.
            ${savedLink ? ` <a href="${savedLink}" target="_blank">Megnézem ↗</a>` : ''}</div>`;
        toast('Elmentve piszkozatként!', 'success');

    } catch (e) {
        toast('Mentés sikertelen: ' + e.message, 'error');
        saveBtn.disabled = false; saveBtn.textContent = '💾 Mentés azonnal';
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
