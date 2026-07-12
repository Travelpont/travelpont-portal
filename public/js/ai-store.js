// =====================================================
// ai-store.js – AI Műhely beszélgetések tárolása Firestore-ban
//
// Adatmodell:
//   aiConversations/{convId}
//     { title, szint: 'orszag'|'regio'|'varos'|'egyeb'|'altalanos',
//       parentConvId,                  // beszélgetés-fa (másik conv id-je vagy null)
//       uticelId, parentUticelId, parentCim,   // WP-úticél kapcsolat
//       handledProposals: [],          // elintézett propose_save tool_use-id-k
//       ajanlatokEnabled: false,       // ✈️ Ajánlatok keresése kapcsoló állása
//       msgCount, uid, email, createdAt, updatedAt }
//   aiConversations/{convId}/messages/{autoId}
//     { idx, json, createdAt }
//
// Az üzenetek egyenként, JSON-stringként mennek: a Firestore nem tud
// közvetlenül egymásba ágyazott tömböket (az Anthropic-üzenetekben van
// ilyen), a stringesítés viszont bájtra pontos round-tripet ad. A
// subcollection kikerüli az 1 MiB/doc limitet, és körönként csak
// append-írás kell, a history nem íródik újra.
// =====================================================

import { db, auth } from './firebase-config.js';
import {
    collection, doc, query, orderBy, limit, getDocs,
    addDoc, updateDoc, deleteDoc, writeBatch, arrayUnion, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const CONVS = 'aiConversations';

// Egy üzenet-doc biztonsági plafonja (az 1 MiB Firestore-limit alatt):
// e fölött a nagy tool_result-blokkok tartalmát placeholderre cseréljük.
const MAX_MSG_JSON = 900000;

export async function listConversations() {
    const q = query(collection(db, CONVS), orderBy('updatedAt', 'desc'), limit(100));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function createConversation(initial = {}) {
    const user = auth.currentUser;
    const data = {
        title: 'Új beszélgetés',
        szint: 'altalanos',
        parentConvId: null,
        uticelId: null,
        parentUticelId: null,
        parentCim: '',
        handledProposals: [],
        ajanlatokEnabled: false,
        msgCount: 0,
        uid: user?.uid || null,
        email: user?.email || null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        ...initial,
    };
    const ref = await addDoc(collection(db, CONVS), data);
    return { id: ref.id, ...data };
}

export async function updateConversation(convId, patch) {
    await updateDoc(doc(db, CONVS, convId), { ...patch, updatedAt: serverTimestamp() });
}

export async function deleteConversation(convId) {
    // Előbb a messages subcollection (max 500-as batchekben), utána a doc
    while (true) {
        const snap = await getDocs(query(collection(db, CONVS, convId, 'messages'), limit(500)));
        if (snap.empty) break;
        const batch = writeBatch(db);
        snap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
    }
    await deleteDoc(doc(db, CONVS, convId));
}

export async function loadMessages(convId) {
    const q = query(collection(db, CONVS, convId, 'messages'), orderBy('idx'));
    const snap = await getDocs(q);
    const out = [];
    snap.docs.forEach(d => {
        try { out.push(JSON.parse(d.data().json)); }
        catch (e) { console.warn('[ai-store] sérült üzenet-doc kihagyva:', d.id, e); }
    });
    return out;
}

// A verbatim Anthropic-üzeneteket fűzi a beszélgetéshez, startIdx-től sorszámozva.
export async function appendMessages(convId, msgs, startIdx) {
    if (!msgs.length) return;
    const batch = writeBatch(db);
    msgs.forEach((m, i) => {
        const ref = doc(collection(db, CONVS, convId, 'messages'));
        batch.set(ref, { idx: startIdx + i, json: serializeMessage(m), createdAt: new Date() });
    });
    batch.update(doc(db, CONVS, convId), {
        msgCount: startIdx + msgs.length,
        updatedAt: serverTimestamp(),
    });
    await batch.commit();
}

export async function markHandled(convId, pid) {
    await updateDoc(doc(db, CONVS, convId), {
        handledProposals: arrayUnion(pid),
        updatedAt: serverTimestamp(),
    });
}

// Melyik beszélgetés szól egy adott WP-úticélról? (fa-besoroláshoz)
export function findConversationByUticelId(convs, uticelId) {
    if (!uticelId) return null;
    return convs.find(c => c.uticelId === uticelId) || null;
}

// ---- Méret-guard: túl nagy üzenetnél a tool_result tartalmakat rövidítjük.
// A memóriabeli (élő) history érintetlen marad, csak a mentett példány rövidül.
function serializeMessage(msg) {
    let json = JSON.stringify(msg);
    if (json.length <= MAX_MSG_JSON) return json;

    const clone = JSON.parse(json);
    if (Array.isArray(clone.content)) {
        for (const block of clone.content) {
            if (block.type === 'tool_result') {
                block.content = '[túl nagy tool-eredmény – kihagyva a mentésből]';
            }
        }
    }
    json = JSON.stringify(clone);
    if (json.length > MAX_MSG_JSON) {
        // Végső mentőöv: szöveges placeholder, hogy a mentés ne bukjon el
        json = JSON.stringify({ role: clone.role || 'user',
            content: '[túl hosszú üzenet – nem került mentésre]' });
    }
    return json;
}
