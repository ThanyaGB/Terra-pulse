/** Soft ambient wind for the opening film. Off by default; starts only after the visitor presses the sound button. */
export interface Ambient { set(on: boolean): void; dispose(): void }

export function createAmbient(): Ambient {
  let ctx: AudioContext | null = null;
  let gain: GainNode | null = null;
  let lfo: OscillatorNode | null = null;
  let src: AudioBufferSourceNode | null = null;

  function build(): void {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; } // brown noise
    src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520;
    gain = ctx.createGain(); gain.gain.value = 0;
    lfo = ctx.createOscillator(); lfo.frequency.value = 0.11;
    const depth = ctx.createGain(); depth.gain.value = 120;
    lfo.connect(depth); depth.connect(lp.frequency);
    src.connect(lp); lp.connect(gain); gain.connect(ctx.destination);
    src.start(); lfo.start();
  }

  return {
    set(on) {
      if (on && !ctx) build();
      if (!ctx || !gain) return;
      if (on) void ctx.resume();
      gain.gain.cancelScheduledValues(ctx.currentTime);
      gain.gain.linearRampToValueAtTime(on ? 0.16 : 0, ctx.currentTime + 0.6);
    },
    dispose() {
      try { src?.stop(); lfo?.stop(); void ctx?.close(); } catch { /* already stopped */ }
      ctx = null; gain = null;
    },
  };
}
