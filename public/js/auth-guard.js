// =====================================================
// auth-guard.js – Bejelentkezés-ellenőrzés + közös API-hívó
// Minden modul-oldal (ajanlatok.html, uticelok.html, index.html) ezt importálja.
// =====================================================

import { auth } from './firebase-config.js';
import { onAuthStateChanged }
    from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

// ---- Bejelentkezés-ellenőrzés: redirect login.html-re, ha nincs user ----
export function guardPage(onReady) {
    onAuthStateChanged(auth, user => {
        if (!user) { window.location.href = 'login.html'; return; }
        onReady(user);
    });
}

// ---- Közös API-hívó a Cloud Functions proxykhoz ----
// baseUrl: API_CONFIG.AJANLAT_PROXY_URL / UTICEL_PROXY_URL / GENERATE_URL / STATUS_URL
// action:  'list' | 'get' | 'create' | 'update' | 'sideload' | 'meta' | 'status' (proxy-knál); null a generateContent-nél
// extraQuery: { id, ...szűrők } – query-stringgé alakítva
// body: JSON-osítható objektum (POST/PUT-nál)
export async function apiCall(baseUrl, { action, extraQuery = {}, body, method } = {}) {
    const user = auth.currentUser;
    if (!user) throw new Error('Nincs bejelentkezve');

    const token = await user.getIdToken();

    const params = new URLSearchParams();
    if (action) params.set('action', action);
    Object.entries(extraQuery).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') params.set(k, v);
    });

    const url = params.toString() ? `${baseUrl}?${params}` : baseUrl;
    const httpMethod = method || (body ? 'POST' : 'GET');

    const res = await fetch(url, {
        method: httpMethod,
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.error || `Hiba (${res.status})`);
    }
    return data;
}

// ---- Toast értesítés (a portal.css .toast osztályaihoz) ----
export function toast(message, type = 'info') {
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => el.remove(), 4000);
}
