// =====================================================
// Travelpont Portal – API konfiguráció
// Verzió: 1.0.0
//
// FONTOS (F. fázis manuális lépés): az első `firebase deploy --only functions`
// után a terminál kiírja a 4 function tényleges Cloud Run URL-jét
// (europe-west1 régióban). Azokat kell ide bemásolni a lenti TODO helyekre.
// Addig a Portál lokálisan (Firebase Emulator, `firebase emulators:start`)
// tesztelhető a http://localhost-ös ágon.
// =====================================================

const isLocal = window.location.hostname === 'localhost' ||
                window.location.hostname === '127.0.0.1';

// Cloud Run URL-ek (deploy után kitöltendő)
const GENERATE_URL      = 'https://TODO-generatecontent-xxxxx-ew.a.run.app';
const STATUS_URL        = 'https://TODO-serverstatus-xxxxx-ew.a.run.app';
const AJANLAT_PROXY_URL = 'https://TODO-ajanlatproxy-xxxxx-ew.a.run.app';
const UTICEL_PROXY_URL  = 'https://TODO-uticelproxy-xxxxx-ew.a.run.app';

export const API_CONFIG = {
    GENERATE_URL:      isLocal ? 'http://127.0.0.1:5001/travelpont-portal/europe-west1/generateContent' : GENERATE_URL,
    STATUS_URL:        isLocal ? 'http://127.0.0.1:5001/travelpont-portal/europe-west1/serverStatus'    : STATUS_URL,
    AJANLAT_PROXY_URL: isLocal ? 'http://127.0.0.1:5001/travelpont-portal/europe-west1/ajanlatProxy'    : AJANLAT_PROXY_URL,
    UTICEL_PROXY_URL:  isLocal ? 'http://127.0.0.1:5001/travelpont-portal/europe-west1/uticelProxy'     : UTICEL_PROXY_URL,

    MODEL_NORMAL:  'gpt-4o',
    MAX_TOKENS:    2000,
    TEMPERATURE:   0.7,

    IS_LOCAL: isLocal
};
