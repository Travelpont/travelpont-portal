// =====================================================
// Travelpont Portal – API konfiguráció
// Verzió: 1.0.0
//
// A 2026-07-10-i első `firebase deploy --only functions` után kapott
// tényleges function URL-ek (europe-west1 régió).
// =====================================================

const isLocal = window.location.hostname === 'localhost' ||
                window.location.hostname === '127.0.0.1';

// Cloud Functions URL-ek
const GENERATE_URL      = 'https://europe-west1-travelpont-portal.cloudfunctions.net/generateContent';
const STATUS_URL        = 'https://europe-west1-travelpont-portal.cloudfunctions.net/serverStatus';
const AJANLAT_PROXY_URL = 'https://europe-west1-travelpont-portal.cloudfunctions.net/ajanlatProxy';
const UTICEL_PROXY_URL  = 'https://europe-west1-travelpont-portal.cloudfunctions.net/uticelProxy';
const BLOG_PROXY_URL    = 'https://europe-west1-travelpont-portal.cloudfunctions.net/blogProxy';
const AI_AGENT_URL      = 'https://europe-west1-travelpont-portal.cloudfunctions.net/aiAgent';
const KEZDOLAP_PROXY_URL = 'https://europe-west1-travelpont-portal.cloudfunctions.net/kezdolapProxy';

export const API_CONFIG = {
    GENERATE_URL:      isLocal ? 'http://127.0.0.1:5001/travelpont-portal/europe-west1/generateContent' : GENERATE_URL,
    STATUS_URL:        isLocal ? 'http://127.0.0.1:5001/travelpont-portal/europe-west1/serverStatus'    : STATUS_URL,
    AJANLAT_PROXY_URL: isLocal ? 'http://127.0.0.1:5001/travelpont-portal/europe-west1/ajanlatProxy'    : AJANLAT_PROXY_URL,
    UTICEL_PROXY_URL:  isLocal ? 'http://127.0.0.1:5001/travelpont-portal/europe-west1/uticelProxy'     : UTICEL_PROXY_URL,
    BLOG_PROXY_URL:    isLocal ? 'http://127.0.0.1:5001/travelpont-portal/europe-west1/blogProxy'       : BLOG_PROXY_URL,
    AI_AGENT_URL:      isLocal ? 'http://127.0.0.1:5001/travelpont-portal/europe-west1/aiAgent'         : AI_AGENT_URL,
    KEZDOLAP_PROXY_URL: isLocal ? 'http://127.0.0.1:5001/travelpont-portal/europe-west1/kezdolapProxy'  : KEZDOLAP_PROXY_URL,

    MODEL_NORMAL:  'gpt-4o',
    MAX_TOKENS:    2000,
    TEMPERATURE:   0.7,

    IS_LOCAL: isLocal
};
