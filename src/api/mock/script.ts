import type { Lang, ScriptLine } from '../contract';

/**
 * Demo call script, written the way a society worker would actually talk. Prices are demo rates. Punjabi and Hindi copy should be reviewed by native
 * speakers (and ideally recorded by a voice artist) before any pilot use.
 */
const TEXT: Record<Lang, string[]> = {
  en: [
    'Sat Sri Akal, Gurpreet ji. This is Harjinder, from the Sangrur Kisan Machinery Society.',
    'Your paddy should be ready to cut in a week or ten days, right?',
    'Please don’t burn the straw this time. We have a Super Seeder that sows wheat right through it.',
    'It costs ₹750 an acre. And if you’d rather sell the straw, we’ll come and pick it up, at ₹1,650 a tonne.',
    'If you want a machine, press 1. For straw pickup, press 2. To talk to an FPO worker, press 9. To hear this again, press star.',
  ],
  hi: [
    'सत श्री अकाल गुरप्रीत जी। मैं हरजिंदर बोल रहा हूँ, संगरूर किसान मशीनरी सोसाइटी से।',
    'आपकी धान की कटाई हफ़्ते-दस दिन में होगी न?',
    'इस बार पराली मत जलाइए। हमारे पास सुपर सीडर है, जो पराली में ही गेहूँ बो देता है।',
    'किराया ₹750 एकड़ का है। और पराली बेचनी हो तो हम खुद उठा लेंगे, ₹1,650 टन के हिसाब से।',
    'मशीन चाहिए तो 1 दबाइए। पराली उठवानी हो तो 2। FPO कर्मचारी से बात करनी हो तो 9। दोबारा सुनना हो तो स्टार दबाइए।',
  ],
  pa: [
    'ਸਤ ਸ੍ਰੀ ਅਕਾਲ ਗੁਰਪ੍ਰੀਤ ਜੀ। ਮੈਂ ਹਰਜਿੰਦਰ ਬੋਲ ਰਿਹਾਂ, ਸੰਗਰੂਰ ਕਿਸਾਨ ਮਸ਼ੀਨਰੀ ਸੋਸਾਇਟੀ ਤੋਂ।',
    'ਤੁਹਾਡਾ ਝੋਨਾ ਹਫ਼ਤੇ-ਦਸ ਦਿਨ ਵਿੱਚ ਵੱਢਣ ਲਈ ਤਿਆਰ ਹੋ ਜਾਣਾ ਏ, ਹੈ ਨਾ?',
    'ਇਸ ਵਾਰ ਪਰਾਲੀ ਨਾ ਸਾੜਿਓ। ਸਾਡੇ ਕੋਲ ਸੁਪਰ ਸੀਡਰ ਹੈ, ਜੋ ਪਰਾਲੀ ਵਿੱਚ ਹੀ ਕਣਕ ਬੀਜ ਦਿੰਦਾ ਹੈ।',
    'ਕਿਰਾਇਆ ₹750 ਏਕੜ ਦਾ ਹੈ। ਤੇ ਪਰਾਲੀ ਵੇਚਣੀ ਹੋਵੇ ਤਾਂ ਅਸੀਂ ਆਪ ਚੁੱਕ ਲਵਾਂਗੇ, ₹1,650 ਟਨ ਦੇ ਹਿਸਾਬ ਨਾਲ।',
    'ਮਸ਼ੀਨ ਚਾਹੀਦੀ ਹੈ ਤਾਂ 1 ਦਬਾਓ। ਪਰਾਲੀ ਚੁਕਵਾਉਣੀ ਹੋਵੇ ਤਾਂ 2। FPO ਕਰਮਚਾਰੀ ਨਾਲ ਗੱਲ ਕਰਨੀ ਹੋਵੇ ਤਾਂ 9। ਦੁਬਾਰਾ ਸੁਣਨਾ ਹੋਵੇ ਤਾਂ ਸਟਾਰ ਦਬਾਓ।',
  ],
};

export const LINE_MS = 4800;

export function scriptFor(lang: Lang): ScriptLine[] {
  return TEXT[lang].map((text, i) => ({ id: `l${i}`, startMs: i * LINE_MS, endMs: (i + 1) * LINE_MS - 150, text }));
}
