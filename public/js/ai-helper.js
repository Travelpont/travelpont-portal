// =====================================================
// ai-helper.js – AI-alapú szövegírás-segítség (GPT-4o)
// A generator.html (aktivbalaton-portal) prompt-építés/JSON-parse mintájának
// leegyszerűsített adaptációja, beágyazva az Ajánlat/Úticél formokba.
// AI-tartalom SOSEM ment automatikusan – a felhasználó mindig látja és
// szerkesztheti a textarea-ban, mielőtt Mentést nyom.
// =====================================================

import { apiCall } from './auth-guard.js';
import { API_CONFIG } from './api-config.js';

const AJANLAT_SYSTEM_PROMPT = `Utazási ajánlatok szövegírója vagy a Travelpont.hu csapatában.
Feladatod egy rövid, csábító, de hiteles ajánlat-leírás megírása magyar nyelven.

Szabályok:
- Ne találj ki konkrét adatokat (árat, dátumot, hotel nevét) – csak azt írd bele, amit a felhasználó megadott.
- Barátságos, lelkes, de nem túlzó hangnem (nem "reklámszöveg", inkább mint egy utazó barát ajánlása).
- 2-4 rövid bekezdés, HTML <p> tagekkel.
- Válaszolj KIZÁRÓLAG egy JSON objektummal, más szöveg nélkül, ebben a formában:
{"leiras": "<p>...</p><p>...</p>"}`;

const UTICEL_SYSTEM_PROMPT = `Utazási úticél-bemutatók szövegírója vagy a Travelpont.hu csapatában.
Feladatod egy ország/tájegység/város rövid bemutatása magyar nyelven.

Szabályok:
- Ne találj ki konkrét, ellenőrizhetetlen tényeket (pontos statisztikákat, éves látogatószámot) – írj általános, hangulati leírást.
- 1-2 mondatos "teaser" (rövid leíró szöveg) ÉS egy hosszabb, 3-5 bekezdéses bemutató szöveg.
- Válaszolj KIZÁRÓLAG egy JSON objektummal, más szöveg nélkül, ebben a formában:
{"leiras": "1-2 mondatos rövid szöveg", "tartalom": "<p>...</p><p>...</p>"}`;

export function getSystemPrompt(entity) {
    return entity === 'uticel' ? UTICEL_SYSTEM_PROMPT : AJANLAT_SYSTEM_PROMPT;
}

// ---- Szigorú-JSON parse, code-fence fallback-kel ----
export function parseAIJson(content) {
    try {
        return JSON.parse(content);
    } catch {
        const match = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
        if (match) {
            try { return JSON.parse(match[1]); } catch { /* esik lentebb */ }
        }
        const braceMatch = content.match(/\{[\s\S]*\}/);
        if (braceMatch) {
            try { return JSON.parse(braceMatch[0]); } catch { /* esik lentebb */ }
        }
        throw new Error('Az AI válasza nem volt értelmezhető JSON: ' + content.slice(0, 200));
    }
}

// ---- AI hívás: entity = 'ajanlat' | 'uticel', userPrompt = szabad szöveg ----
export async function generateWithAI(entity, userPrompt) {
    const messages = [
        { role: 'system', content: getSystemPrompt(entity) },
        { role: 'user', content: userPrompt },
    ];

    const data = await apiCall(API_CONFIG.GENERATE_URL, {
        body: {
            model: API_CONFIG.MODEL_NORMAL,
            messages,
            max_tokens: API_CONFIG.MAX_TOKENS,
            temperature: API_CONFIG.TEMPERATURE,
        },
    });

    const content = data.choices?.[0]?.message?.content || '';
    return parseAIJson(content);
}
