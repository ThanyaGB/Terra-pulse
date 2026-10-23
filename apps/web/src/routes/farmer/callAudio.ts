import type { Lang, ScriptLine } from '@/api/contract';
import { LANGUAGES } from '@/i18n';

/* ------------ shared Web Audio context + keypad tones ------------ */
let ctx: AudioContext | null = null;
export function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx ??= new Ctor();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

const DTMF: Record<string, [number, number]> = {
  '1': [697, 1209], '2': [697, 1336], '3': [697, 1477], '4': [770, 1209], '5': [770, 1336], '6': [770, 1477],
  '7': [852, 1209], '8': [852, 1336], '9': [852, 1477], '*': [941, 1209], '0': [941, 1336], '#': [941, 1477],
};

/** Standard dual-tone keypad sound so a keypress is audible even for a visually impaired caller. */
export function playDtmf(key: string, durationSec = 0.16): void {
  const ac = getAudioContext();
  const freqs = DTMF[key];
  if (!ac || !freqs) return;
  const gain = ac.createGain();
  gain.gain.setValueAtTime(0.0001, ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.16, ac.currentTime + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + durationSec);
  gain.connect(ac.destination);
  for (const f of freqs) {
    const o = ac.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    o.connect(gain);
    o.start();
    o.stop(ac.currentTime + durationSec + 0.02);
  }
}

/* ------------ text-to-speech helpers ------------ */
const bcp = (lang: Lang) => LANGUAGES.find((l) => l.id === lang)?.bcp47 ?? 'en-IN';

export function pickVoice(lang: Lang): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  const prefix = bcp(lang).slice(0, 2);
  return window.speechSynthesis.getVoices().find((v) => v.lang.replace('_', '-').toLowerCase().startsWith(prefix)) ?? null;
}

/** Best-effort one-off speech (used for the spoken booking confirmation). */
export function speakText(text: string, lang: Lang): void {
  const voice = pickVoice(lang);
  if (!voice) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.voice = voice;
  u.lang = voice.lang;
  u.rate = 0.92;
  window.speechSynthesis.speak(u);
}

/* ------------ the call audio engine ------------ */
export interface CallAudioOptions {
  lines: ScriptLine[];
  lang: Lang;
  /** recorded audio. If null, lines are voiced with speech synthesis (or shown silently if no voice exists). */
  audioUrl: string | null;
  startLine?: number;
  onLine(index: number): void;
  onPlaying(playing: boolean): void;
  onEnd(): void;
}

/**
 * Plays the call script and reports which subtitle line is current.
 *  - With `audioUrl`: an <audio> element feeds an AnalyserNode, so the waveform is driven by the real signal
 *    and subtitles follow `currentTime`. (The audio host must send CORS headers for the analyser to read it.)
 *  - Without: each line is spoken with speechSynthesis. Browsers do not expose that audio to the analyser,
 *    so the waveform uses a speaking envelope instead. If the device has no voice for the language the
 *    lines advance on a timer and `voiceMissing` is true (subtitles-only).
 */
export class CallAudio {
  voiceMissing = false;
  private line: number;
  private _playing = false;
  private token = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private el: HTMLAudioElement | null = null;
  private analyser: AnalyserNode | null = null;
  private freq: Uint8Array<ArrayBuffer> | null = null;
  private disposed = false;
  readonly key: string;

  constructor(private o: CallAudioOptions) {
    this.line = Math.min(o.startLine ?? 0, Math.max(0, o.lines.length - 1));
    this.key = `${o.lang}:${o.audioUrl ?? 'tts'}`;
    if (o.audioUrl) this.setupElement(o.audioUrl);
  }

  get isPlaying(): boolean { return this._playing; }
  get currentLine(): number { return this.line; }

  private setupElement(url: string) {
    const el = new Audio();
    el.crossOrigin = 'anonymous';
    el.preload = 'auto';
    el.src = url;
    const startMs = this.o.lines[this.line]?.startMs ?? 0;
    el.addEventListener('loadedmetadata', () => { el.currentTime = startMs / 1000; }, { once: true });
    el.addEventListener('timeupdate', () => {
      const ms = el.currentTime * 1000;
      const idx = this.o.lines.findIndex((l) => ms >= l.startMs && ms < l.endMs + 150);
      if (idx >= 0 && idx !== this.line) { this.line = idx; this.o.onLine(idx); }
    });
    el.addEventListener('ended', () => { this.setPlaying(false); this.o.onEnd(); });
    el.addEventListener('error', () => { this.el = null; this.o.onPlaying(false); });
    const ac = getAudioContext();
    if (ac) {
      try {
        const src = ac.createMediaElementSource(el);
        this.analyser = ac.createAnalyser();
        this.analyser.fftSize = 64;
        this.freq = new Uint8Array(this.analyser.frequencyBinCount);
        src.connect(this.analyser);
        this.analyser.connect(ac.destination);
      } catch { /* already connected or unsupported: audio still plays without the analyser */ }
    }
    this.el = el;
  }

  private setPlaying(p: boolean) {
    if (this._playing === p) return;
    this._playing = p;
    this.o.onPlaying(p);
  }

  play(): void {
    if (this.disposed) return;
    getAudioContext();
    this.setPlaying(true);
    if (this.el) { void this.el.play().catch(() => this.setPlaying(false)); return; }
    this.speakCurrent();
  }

  pause(): void {
    if (this.disposed) return;
    this.token++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.el) this.el.pause();
    else if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    this.setPlaying(false);
  }

  replay(): void {
    this.line = 0;
    this.o.onLine(0);
    if (this.el) this.el.currentTime = 0;
    this.play();
  }

  dispose(): void {
    this.pause();
    this.disposed = true;
    if (this.el) { this.el.removeAttribute('src'); this.el.load(); this.el = null; }
  }

  private speakCurrent() {
    const myToken = ++this.token;
    const line = this.o.lines[this.line];
    if (!line) { this.setPlaying(false); this.o.onEnd(); return; }
    this.o.onLine(this.line);

    const next = () => {
      if (myToken !== this.token || this.disposed) return;
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      if (this.line >= this.o.lines.length - 1) { this.setPlaying(false); this.o.onEnd(); return; }
      this.line += 1;
      this.speakCurrent();
    };

    const voice = pickVoice(this.o.lang);
    const fallbackMs = Math.max(line.endMs - line.startMs, 2200);
    if (!voice) {
      this.voiceMissing = true;
      this.timer = setTimeout(next, fallbackMs);
      return;
    }
    this.voiceMissing = false;
    const u = new SpeechSynthesisUtterance(line.text);
    u.voice = voice;
    u.lang = voice.lang;
    u.rate = 0.92;
    u.onend = next;
    u.onerror = (e) => { if (e.error !== 'interrupted' && e.error !== 'canceled') next(); };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
    // some engines never fire `end`; do not let the call stall
    this.timer = setTimeout(next, fallbackMs + 9000);
  }

  /** n bars, 0..1. Real spectrum for recorded audio, a speaking envelope for synthesised speech. */
  bars(n: number, nowSec: number): number[] {
    const out = new Array<number>(n).fill(0.06);
    if (!this._playing) return out;
    if (this.analyser && this.freq) {
      this.analyser.getByteFrequencyData(this.freq);
      const step = Math.max(1, Math.floor(this.freq.length / n));
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let k = 0; k < step; k++) sum += this.freq[Math.min(this.freq.length - 1, i * step + k)] ?? 0;
        out[i] = Math.max(0.06, Math.min(1, sum / step / 200));
      }
      return out;
    }
    for (let i = 0; i < n; i++) {
      const a = Math.abs(Math.sin(nowSec * 7.3 + i * 1.37));
      const b = Math.abs(Math.sin(nowSec * 2.1 + i * 0.52));
      out[i] = 0.14 + 0.78 * a * (0.45 + 0.55 * b);
    }
    return out;
  }
}
