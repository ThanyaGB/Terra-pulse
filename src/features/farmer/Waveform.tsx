import { useEffect, useRef } from 'react';
import { prefersReducedMotion } from '@/hooks/useReducedMotion';
import type { CallAudio } from './callAudio';

const BARS = 24;

/** Bars are driven straight from the audio engine each frame (DOM writes, no React re-render). */
export function Waveform({ audio, playing }: { audio: CallAudio | null; playing: boolean }) {
  const refs = useRef<(SVGRectElement | null)[]>([]);
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const t = performance.now() / 1000;
      const levels = prefersReducedMotion()
        ? new Array<number>(BARS).fill(playing ? 0.5 : 0.06)
        : audio?.bars(BARS, t) ?? new Array<number>(BARS).fill(0.06);
      levels.forEach((v, i) => {
        const el = refs.current[i];
        if (!el) return;
        const h = Math.max(4, v * 56);
        el.setAttribute('height', String(h));
        el.setAttribute('y', String((60 - h) / 2));
      });
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [audio, playing]);

  return (
    <svg viewBox={`0 0 ${BARS * 10} 60`} className="h-14 w-full" aria-hidden="true" preserveAspectRatio="none" data-testid="waveform" data-playing={playing}>
      {Array.from({ length: BARS }, (_, i) => (
        <rect key={i} ref={(el) => { refs.current[i] = el; }} x={i * 10 + 2} width="6" rx="3" y="28" height="4" fill={playing ? '#34D399' : '#6F8AA6'} />
      ))}
    </svg>
  );
}
