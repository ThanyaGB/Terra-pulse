import type { Lang, ScriptLine } from '@/api/contract';

/**
 * Demo call script. Prices are demo rates. Punjabi and Hindi copy should be reviewed by native
 * speakers (and ideally recorded by a voice artist) before any pilot use.
 */
const TEXT: Record<Lang, string[]> = {
  en: [
    'Hello Gurpreet ji, this is Sangrur Machinery Cooperative.',
    'Your paddy harvest is expected in 7 to 10 days.',
    'A Super Seeder can sow wheat straight into the straw, no burning needed.',
    'Super Seeder rental is ₹750 per acre.',
    'We also buy your straw for ₹1,650 per tonne.',
    'Press 1 to book a Super Seeder, 2 for straw collection, or 9 to talk to an FPO worker.',
  ],
  hi: [
    'नमस्ते गुरप्रीत जी, मैं संगरूर मशीनरी सहकारी समिति से बोल रहा हूँ।',
    'आपकी धान की कटाई अगले 7 से 10 दिनों में होने वाली है।',
    'सुपर सीडर पराली में ही गेहूँ बो देता है, जलाने की ज़रूरत नहीं।',
    'सुपर सीडर का किराया ₹750 प्रति एकड़ है।',
    'हम आपकी पराली ₹1,650 प्रति टन पर खरीदते हैं।',
    'सुपर सीडर पक्का करने के लिए 1, पराली उठवाने के लिए 2, FPO कर्मचारी से बात करने के लिए 9 दबाएँ।',
  ],
  pa: [
    'ਸਤ ਸ੍ਰੀ ਅਕਾਲ ਗੁਰਪ੍ਰੀਤ ਜੀ, ਮੈਂ ਸੰਗਰੂਰ ਮਸ਼ੀਨਰੀ ਸਹਿਕਾਰੀ ਸਭਾ ਵੱਲੋਂ ਬੋਲ ਰਿਹਾ ਹਾਂ।',
    'ਤੁਹਾਡੇ ਝੋਨੇ ਦੀ ਕਟਾਈ ਅਗਲੇ 7 ਤੋਂ 10 ਦਿਨਾਂ ਵਿੱਚ ਹੋਣ ਵਾਲੀ ਹੈ।',
    'ਸੁਪਰ ਸੀਡਰ ਪਰਾਲੀ ਵਿੱਚ ਹੀ ਕਣਕ ਬੀਜ ਦਿੰਦਾ ਹੈ, ਸਾੜਨ ਦੀ ਲੋੜ ਨਹੀਂ।',
    'ਸੁਪਰ ਸੀਡਰ ਦਾ ਕਿਰਾਇਆ ₹750 ਪ੍ਰਤੀ ਏਕੜ ਹੈ।',
    'ਅਸੀਂ ਤੁਹਾਡੀ ਪਰਾਲੀ ₹1,650 ਪ੍ਰਤੀ ਟਨ ਦੇ ਭਾਅ ਖਰੀਦਦੇ ਹਾਂ।',
    'ਸੁਪਰ ਸੀਡਰ ਪੱਕਾ ਕਰਨ ਲਈ 1, ਪਰਾਲੀ ਚੁੱਕਵਾਉਣ ਲਈ 2, FPO ਕਰਮਚਾਰੀ ਨਾਲ ਗੱਲ ਕਰਨ ਲਈ 9 ਦਬਾਓ।',
  ],
};

export const LINE_MS = 3600;

export function scriptFor(lang: Lang): ScriptLine[] {
  return TEXT[lang].map((text, i) => ({ id: `l${i}`, startMs: i * LINE_MS, endMs: (i + 1) * LINE_MS - 150, text }));
}
