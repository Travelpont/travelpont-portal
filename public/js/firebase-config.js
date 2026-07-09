// =====================================================
// Firebase konfiguráció – Travelpont Portal
// Verzió: 1.0.0
// CDN alapú import – bundler nem szükséges
//
// FONTOS (B. fázis manuális lépés): a lenti firebaseConfig objektumot a
// Firebase konzolról kell bemásolni, miután létrehoztad a "travelpont-portal"
// projektet (Project settings → General → Your apps → Web app → SDK config).
// Amíg ez placeholder, a bejelentkezés nem fog működni.
// =====================================================

import { initializeApp }
    from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth }
    from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getStorage }
    from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';

const firebaseConfig = {
    apiKey:            "TODO-FIREBASE-API-KEY",
    authDomain:        "travelpont-portal.firebaseapp.com",
    projectId:         "travelpont-portal",
    storageBucket:      "travelpont-portal.firebasestorage.app",
    messagingSenderId: "TODO",
    appId:             "TODO"
};

const app = initializeApp(firebaseConfig);

export const auth    = getAuth(app);
export const storage = getStorage(app);

export default app;
