import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import type { BookingReceipt, KeyAction, SeederType } from '@/api/contract';
import { useAsync } from '@/hooks/useAsync';
import { AsyncBoundary } from '@/design/AsyncBoundary';
import { IconBack, IconPause, IconPhone, IconPlay } from '@/design/Icons';
import { LangSwitch } from '@/design/LangSwitch';
import { OfflineBanner } from '@/design/OfflineBanner';
import { SkeletonBlock } from '@/design/Skeleton';
import { useI18n } from '@/i18n';
import { mmss } from '@/lib/format';
import { playDtmf, speakText } from './callAudio';
import { KeypadPanel } from './KeypadPanel';
import type { Choice, Step } from './keypadFlow';
import { useCallAudio } from './useCallAudio';
import { Waveform } from './Waveform';
import type { MessageKey } from '@/i18n';

type Phase = 'ringing' | 'live' | 'ended';

const DONE_KEY: Record<KeyAction, MessageKey> = { '1': 'farmer.done1', '2': 'farmer.done2', '9': 'farmer.done9' };
const CONFIRM_MACHINE: Record<SeederType, MessageKey> = { super_seeder: 'farmer.confirmSuper', happy_seeder: 'farmer.confirmHappy' };
/** The read-back line for a choice: "You chose the Happy Seeder. Press 1 to confirm, or 0 to go back." */
const confirmLine = (c: Choice): MessageKey => (c.key === '1' ? CONFIRM_MACHINE[c.machine ?? 'super_seeder'] : c.key === '2' ? 'farmer.confirm2' : 'farmer.confirm9');

export default function FarmerPage() {
  const { lang, t } = useI18n();
  const sessionState = useAsync(() => api.getCallSession(lang), [lang]);
  const lastSession = useRef(sessionState.status === 'success' ? sessionState.data : null);
  if (sessionState.status === 'success') lastSession.current = sessionState.data;
  const session = sessionState.status === 'success' ? sessionState.data : lastSession.current;

  // English gloss under non-English subtitles
  const gloss = useAsync(() => (lang === 'en' ? Promise.resolve(null) : api.getCallSession('en')), [lang]);
  const [phase, setPhase] = useState<Phase>('ringing');
  const [elapsed, setElapsed] = useState(0);
  const { audio, line, playing, ended, voiceMissing, answer, toggle, stop, replay } = useCallAudio(session, phase === 'live');

  useEffect(() => {
    if (phase !== 'live') return;
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [phase]);

  const book = useCallback(
    (c: Choice) => {
      if (!session) return Promise.reject(new Error('no session'));
      return api.bookKey({ sessionId: session.sessionId, key: c.key, ...(c.machine ? { machine: c.machine } : {}), lang });
    },
    [session, lang],
  );

  // the call reads back each step, like a real phone menu
  const onMachineMenu = useCallback(() => {
    stop();
    speakText(t('farmer.machinePrompt'), lang);
  }, [lang, stop, t]);
  const onChoose = useCallback((c: Choice) => {
    stop();
    speakText(t(confirmLine(c)), lang);
  }, [lang, stop, t]);
  const onBack = useCallback(() => speakText(t('farmer.backNote'), lang), [lang, t]);
  // *: at the menu the whole call message plays again; in a step, that step's question is repeated
  const onRepeat = useCallback((step: Step, c?: Choice) => {
    if (step === 'menu') { replay(); return; }
    stop();
    speakText(t(step === 'machine' || !c ? 'farmer.machinePrompt' : confirmLine(c)), lang);
  }, [lang, replay, stop, t]);
  const onConfirmed = useCallback((c: Choice, _r: BookingReceipt) => {
    stop();
    speakText(t(DONE_KEY[c.key]), lang);
  }, [lang, stop, t]);

  function pickUp() {
    setElapsed(0);
    setPhase('live');
    answer();
  }
  function hangUp() {
    stop();
    setPhase('ended');
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-0 sm:p-6">
      <OfflineBanner message={t('common.offline')} />
      <div className="mr-auto hidden gap-4 sm:flex">
        <Link to="/" className="inline-flex items-center gap-2 text-sm font-semibold text-ink" aria-label={t('common.back')}><IconBack /> {t('common.back')}</Link>
        <Link to="/fpo" className="inline-flex items-center gap-2 text-sm font-semibold text-ink">FPO console</Link>
      </div>

      <main id="main" aria-label={t('nav.farmer')} className="relative flex w-full max-w-[420px] flex-1 flex-col overflow-hidden text-white sm:max-h-[860px] sm:min-h-[760px] sm:flex-none sm:rounded-[44px] sm:border-[10px] sm:border-[#0A1626] sm:shadow-2xl" style={{ background: 'linear-gradient(180deg, #17304f 0%, #0B1D33 55%, #08131f 100%)' }}>
        <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-4">
          <div className="flex justify-center"><LangSwitch large inverse /></div>

          <AsyncBoundary state={session ? { status: 'success', data: session } : sessionState} onRetry={sessionState.reload} what={t('nav.farmer')} retryLabel={t('farmer.tryAgain')} skeleton={<SkeletonBlock rows={4} label={t('common.loading')} />}>
            {(s) => (
              <>
                {phase === 'ringing' && (
                  <section aria-label={t('farmer.incoming')} className="flex flex-1 flex-col items-center justify-between gap-6 pb-6 pt-4 text-center">
                    <div className="text-base text-[#C9DDF0]">{t('farmer.incoming')}</div>
                    <div className="flex flex-col items-center gap-4">
                      <div className="ring-pulse relative flex h-36 w-36 items-center justify-center rounded-full bg-[#1E4D3A] text-5xl font-bold" aria-hidden="true">{initials(s.callerName)}</div>
                      <div>
                        <h1 className="m-0 text-3xl font-bold leading-tight">{s.callerName}</h1>
                        <div className="mono mt-1 text-base text-[#C9DDF0]">{s.callerId}</div>
                      </div>
                    </div>
                    <div className="flex w-full items-start justify-around">
                      <Link to="/" className="flex flex-col items-center gap-2 text-base font-semibold" aria-label={t('farmer.later')}>
                        <span className="flex h-20 w-20 items-center justify-center rounded-full bg-[#C62828]"><span style={{ transform: 'rotate(135deg)', display: 'flex' }}><IconPhone size={34} /></span></span>
                        {t('farmer.later')}
                      </Link>
                      <button type="button" className="flex flex-col items-center gap-2 text-base font-semibold" onClick={pickUp} data-testid="answer">
                        <span className="ring-pulse flex h-20 w-20 items-center justify-center rounded-full bg-[#1FA971]"><IconPhone size={34} /></span>
                        {t('farmer.answer')}
                      </button>
                    </div>
                  </section>
                )}

                {phase === 'live' && (
                  <>
                    <section aria-label={t('farmer.callStatus')} className="flex flex-col items-center gap-1 text-center">
                      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#1E4D3A] text-2xl font-bold" aria-hidden="true">{initials(s.callerName)}</div>
                      <h1 className="m-0 mt-1 text-xl font-bold">{s.callerName}</h1>
                      <div className="mono text-base text-[#C9DDF0]"><span className="sr-only">{t('farmer.elapsed')} </span><span data-testid="timer">{mmss(elapsed)}</span></div>
                    </section>

                    <Waveform audio={audio} playing={playing} />

                    <section aria-label={t('farmer.subtitles')} className="min-h-[120px] rounded-3xl bg-black/30 p-5 text-center" lang={s.lang === 'pa' ? 'pa-IN' : s.lang === 'hi' ? 'hi-IN' : 'en-IN'}>
                      {voiceMissing && <p className="m-0 mb-2 text-sm text-amber-200">{t('farmer.noVoice')}</p>}
                      <p className="m-0 text-2xl font-semibold leading-snug" data-testid="subtitle">{s.lines[line]?.text}</p>
                      {gloss.status === 'success' && gloss.data && gloss.data.lines[line] && (
                        <p className="m-0 mt-3 text-sm text-[#8FA9C4]" lang="en-IN">{gloss.data.lines[line].text}</p>
                      )}
                    </section>

                    <button type="button" onClick={toggle} className="mx-auto flex min-h-12 items-center gap-2 rounded-full bg-white/12 px-5 text-base font-semibold" aria-label={playing ? t('farmer.pause') : ended ? t('farmer.replay') : t('farmer.play')} data-testid="play-pause">
                      {playing ? <IconPause size={22} /> : <IconPlay size={22} />}
                      {playing ? t('farmer.pause') : ended ? t('farmer.replay') : t('farmer.play')}
                    </button>

                    <KeypadPanel book={book} onTone={(k) => playDtmf(k)} onMachineMenu={onMachineMenu} onChoose={onChoose} onBack={onBack} onRepeat={onRepeat} onConfirmed={onConfirmed} prices={s.prices} />


                    <button type="button" className="mx-auto mt-1 flex flex-col items-center gap-1 text-base font-semibold" onClick={hangUp}>
                      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[#C62828]"><span style={{ transform: 'rotate(135deg)', display: 'flex' }}><IconPhone size={28} /></span></span>
                      {t('farmer.endCall')}
                    </button>
                  </>
                )}

                {phase === 'ended' && (
                  <section aria-label={t('farmer.callEnded')} className="flex flex-1 flex-col items-center justify-center gap-5 py-12 text-center">
                    <h1 className="m-0 text-2xl font-bold">{t('farmer.callEnded')}</h1>
                    <div className="mono text-base text-[#C9DDF0]">{mmss(elapsed)}</div>
                    <button type="button" className="btn btn-primary btn-lg w-full" onClick={() => setPhase('ringing')}>{t('farmer.callAgain')}</button>
                    <Link to="/" className="text-base font-semibold text-[#C9DDF0]">{t('common.back')}</Link>
                  </section>
                )}
              </>
            )}
          </AsyncBoundary>
        </div>
      </main>
      <p className="hidden max-w-[420px] text-center text-xs text-ink-mute sm:block">{t('farmer.demoNote')}</p>
    </div>
  );
}

function initials(name: string): string {
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}
