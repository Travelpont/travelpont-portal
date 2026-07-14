// =====================================================
// sidebar.js – Globális sidebar navigáció (Travelpont Portal)
// Minden oldalon: import { initSidebar } from './js/sidebar.js';
//                 guardPage(user => initSidebar(user));
// Az aktivbalaton-portal sidebar.js-ének egyszerűsített adaptációja:
// nincs profil-fotó-feltöltés/push-értesítés, csak monogram-avatar + kilépés.
// =====================================================

import { auth } from './firebase-config.js';
import { signOut } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

const SIDEBAR_W = '220px';

// EGYETLEN IGAZSÁGFORRÁS a menüpontokra – új modulnál csak ide kell felvenni.
export const NAV_ITEMS = [
    { href: 'kezdolap.html',  icon: '🏠', label: 'Kezdőlap',  match: '/kezdolap' },
    { href: 'ajanlatok.html', icon: '✈️', label: 'Ajánlatok', match: '/ajanlatok' },
    { href: 'uticelok.html',  icon: '🌍', label: 'Úticélok',  match: '/uticelok' },
    { href: 'ai-muhely.html', icon: '✨', label: 'AI Műhely', match: '/ai-muhely' },
];

function getInitials(user) {
    const email = user?.email || '??';
    return email.slice(0, 2).toUpperCase();
}

function injectCSS() {
    if (document.getElementById('tpSidebarStyle')) return;
    const s = document.createElement('style');
    s.id = 'tpSidebarStyle';
    s.textContent = `
        body.has-sidebar .portal-layout { margin-left: ${SIDEBAR_W}; transition: margin-left 0.25s ease; }
        body.has-sidebar .navbar { padding-left: 16px !important; }
        body.has-sidebar .navbar-brand { display: none !important; }

        .tp-hamburger {
            display: none; align-items: center; background: none; border: none;
            color: var(--text-secondary, #94a3b8); font-size: 20px; cursor: pointer;
            padding: 4px 8px; border-radius: 6px; line-height: 1; flex-shrink: 0;
        }

        .tp-sidebar {
            width: ${SIDEBAR_W}; background: #071013;
            border-right: 1px solid var(--border, rgba(255,255,255,0.08));
            display: flex; flex-direction: column;
            position: fixed; top: 0; left: 0; height: 100vh; z-index: 500; overflow-y: auto;
            transition: transform 0.25s cubic-bezier(0.4,0,0.2,1);
        }
        .tp-sb-brand {
            display: flex; align-items: center; gap: 10px;
            padding: 18px 16px 14px;
            border-bottom: 1px solid var(--border, rgba(255,255,255,0.08));
            flex-shrink: 0; text-decoration: none;
        }
        .tp-sb-brand-name { font-family: 'Space Grotesk', sans-serif; font-size: 1rem; font-weight: 700; color: var(--text-primary, #f1f5f9); }
        .tp-sb-brand-name em { font-style: normal; color: var(--gold, #f59e0b); }
        .tp-sb-ver { font-size: 10px; color: var(--text-muted, #475569); margin-top: 1px; }

        .tp-sb-user { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--border, rgba(255,255,255,0.08)); }
        .tp-sb-avatar {
            width: 32px; height: 32px; border-radius: 50%;
            background: linear-gradient(135deg, var(--teal, #0e7490), #0b5a70);
            display: flex; align-items: center; justify-content: center;
            font-size: 12px; font-weight: 700; color: white; flex-shrink: 0;
        }
        .tp-sb-uname { font-size: 12px; font-weight: 600; color: var(--text-primary, #f1f5f9); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .tp-sb-urole { font-size: 10px; color: var(--text-muted, #475569); }

        .tp-sb-nav { flex: 1; padding: 10px 0; }
        .tp-sb-item {
            display: flex; align-items: center; gap: 10px; padding: 10px 16px;
            color: var(--text-secondary, #94a3b8); text-decoration: none;
            font-size: 13.5px; font-weight: 500; position: relative;
        }
        .tp-sb-item:hover { background: rgba(255,255,255,0.04); color: var(--text-primary, #f1f5f9); }
        .tp-sb-item.active { background: rgba(245,158,11,0.08); color: var(--gold, #f59e0b); }
        .tp-sb-item.active::before { content: ''; position: absolute; left: 0; top: 6px; bottom: 6px; width: 3px; background: var(--gold, #f59e0b); border-radius: 0 2px 2px 0; }
        .tp-sb-icon { font-size: 15px; width: 20px; text-align: center; flex-shrink: 0; }

        .tp-sb-footer { padding: 12px 16px; border-top: 1px solid var(--border, rgba(255,255,255,0.08)); }
        .tp-sb-logout {
            width: 100%; padding: 8px 12px; text-align: left; background: transparent;
            border: 1px solid var(--border, rgba(255,255,255,0.08)); border-radius: 8px;
            color: var(--text-muted, #475569); font-size: 12px; font-weight: 500; cursor: pointer;
        }
        .tp-sb-logout:hover { border-color: rgba(239,68,68,0.3); color: #f87171; }

        .tp-sb-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.55); z-index: 499; }
        .tp-sb-overlay.show { display: block; }

        @media (max-width: 900px) {
            body.has-sidebar .portal-layout { margin-left: 0; }
            .tp-sidebar { transform: translateX(-${SIDEBAR_W}); }
            .tp-sidebar.open { transform: translateX(0); box-shadow: 4px 0 24px rgba(0,0,0,0.4); }
            .tp-hamburger { display: flex; }
        }
    `;
    document.head.appendChild(s);
}

function buildSidebarEl(user) {
    const path  = window.location.pathname;
    const aside = document.createElement('aside');
    aside.className = 'tp-sidebar';

    const navHTML = NAV_ITEMS.map(item => {
        const active = path.includes(item.match) ? 'active' : '';
        return `<a href="${item.href}" class="tp-sb-item ${active}">
            <span class="tp-sb-icon">${item.icon}</span><span>${item.label}</span>
        </a>`;
    }).join('');

    aside.innerHTML = `
        <a href="index.html" class="tp-sb-brand">
            <div>
                <div class="tp-sb-brand-name">Travel<em>Pont</em></div>
                <div class="tp-sb-ver">Portal</div>
            </div>
        </a>
        <div class="tp-sb-user">
            <div class="tp-sb-avatar">${getInitials(user)}</div>
            <div style="min-width:0;">
                <div class="tp-sb-uname">${user.email}</div>
                <div class="tp-sb-urole">Szerkesztő</div>
            </div>
        </div>
        <nav class="tp-sb-nav">${navHTML}</nav>
        <div class="tp-sb-footer">
            <button class="tp-sb-logout" id="tpSbLogout">⬅ Kilépés</button>
        </div>`;

    return aside;
}

export function initSidebar(user) {
    injectCSS();

    const sidebar = buildSidebarEl(user);
    const overlay = document.createElement('div');
    overlay.className = 'tp-sb-overlay';

    document.body.insertBefore(sidebar, document.body.firstChild);
    document.body.insertBefore(overlay, sidebar.nextSibling);
    document.body.classList.add('has-sidebar');

    const navbar = document.querySelector('.navbar');
    if (navbar && !navbar.querySelector('.tp-hamburger')) {
        const btn = document.createElement('button');
        btn.className = 'tp-hamburger';
        btn.setAttribute('aria-label', 'Menü');
        btn.innerHTML = '☰';
        btn.addEventListener('click', toggle);
        navbar.insertBefore(btn, navbar.firstChild);
    }

    function toggle() { sidebar.classList.toggle('open'); overlay.classList.toggle('show'); }
    function close()  { sidebar.classList.remove('open'); overlay.classList.remove('show'); }

    overlay.addEventListener('click', close);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

    document.getElementById('tpSbLogout')?.addEventListener('click', async () => {
        await signOut(auth);
        window.location.href = 'login.html';
    });
}
