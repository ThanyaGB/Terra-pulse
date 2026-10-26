import { useCallback, useEffect, useRef, useState } from 'react';
import type { CallSession } from '@/api/contract';
import { CallAudio } from './callAudio';

/**
 * Owns the CallAudio instance for a live call. Switching language swaps the session; the new audio
 * resumes from the same subtitle line and keeps playing if it was playing.
 */
export function useCallAudio(session: CallSession | null, live: boolean) {
  const [audio, setAudio] = useState<CallAudio | null>(null);
  const [line, setLine] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [voiceMissing, setVoiceMissing] = useState(false);
  const lineRef = useRef(0);
  const current = useRef<CallAudio | null>(null);

  const build = useCallback((s: CallSession, startLine: number) => {
    const a = new CallAudio({
      lines: s.lines, lang: s.lang, audioUrl: s.audioUrl, startLine,
      onLine: (i) => { lineRef.current = i; setLine(i); },
      onPlaying: (p) => { setPlaying(p); if (p) setEnded(false); setVoiceMissing(a.voiceMissing); },
      onEnd: () => setEnded(true),
    });
    current.current = a;
    setAudio(a);
    return a;
  }, []);

  /** Must be called from the Answer tap so the browser allows audio. */
  const answer = useCallback(() => {
    if (!session) return;
    lineRef.current = 0;
    setLine(0);
    setEnded(false);
    build(session, 0).play();
  }, [session, build]);

  // language switched mid-call: rebuild from the same line
  useEffect(() => {
    if (!live || !session) return;
    const prev = current.current;
    if (!prev || prev.key === `${session.lang}:${session.audioUrl ?? 'tts'}`) return;
    const wasPlaying = prev.isPlaying;
    prev.dispose();
    const a = build(session, lineRef.current);
    if (wasPlaying) a.play();
  }, [session, live, build]);

  useEffect(() => () => { current.current?.dispose(); current.current = null; }, []);

  const toggle = useCallback(() => {
    const a = current.current;
    if (!a) return;
    if (a.isPlaying) a.pause();
    else if (ended) { setEnded(false); a.replay(); } else a.play();
  }, [ended]);

  const stop = useCallback(() => { current.current?.pause(); }, []);
  const pause = stop;

  /** Play the whole call message again from the first line (keypad *). */
  const replay = useCallback(() => {
    const a = current.current;
    if (!a) return;
    setEnded(false);
    a.replay();
  }, []);

  return { audio, line, playing, ended, voiceMissing, answer, toggle, stop, pause, replay };
}
