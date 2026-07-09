// =====================================================
// Firebase konfiguráció – Travelpont Portal
// Verzió: 1.0.0
// CDN alapú import – bundler nem szükséges
//
// A "travelpont-portal" Firebase projekt tényleges SDK-konfigurációja
// (Project settings → General → Your apps → Web app → SDK config).
// =====================================================

import { initializeApp }
    from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth }
    from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getStorage }
    from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';

const firebaseConfig = {
    apiKey:            "AIzaSyCOURwfSFXwXavKqrUjUwevOX11rICBm7A",
    authDomain:        "travelpont-portal.firebaseapp.com",
    projectId:         "travelpont-portal",
    storageBucket:     "travelpont-portal.firebasestorage.app",
    messagingSenderId: "689493215446",
    appId:             "1:689493215446:web:7b2f2cee9e08a8d7426177"
};

const app = initializeApp(firebaseConfig);

export const auth    = getAuth(app);
export const storage = getStorage(app);

export default app;
