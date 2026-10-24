import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import type { BookingReceipt, KeyAction } from '@/api/contract';
import { useAsync } from '@/hooks/useAsync';
import { AsyncBoundary } from '@/design-system/AsyncBoundary';
import { IconBack, IconPause, IconPhone, IconPlay } from '@/design-system/Icons';
import { LangSwitch } from '@/design-system/LangSwitch';
import { OfflineBanner } from '@/design-system/OfflineBanner';
import { SkeletonBlock } from '@/design-system/Skeleton';
import { useI18n } from '@/i18n';
import { formatInr, mmss } from '@/lib/format';
import { playDtmf, speakText } from './callAudio';
import { KeypadPanel } from './KeypadPanel';
import { useCallAudio } from './useCallAudio';
import { Waveform } from './Waveform';
import type { MessageKey } from '@/i18n';

type Phase = 'ringing' | 'live' | 'ended';

const DONE_KEY: Record<KeyAction, MessageKey> = { '1': 'farmer.done1', '2': 'farmer.done2', '9': 'farmer.done9' };
const CONFIRM_KEY: Record<KeyAction, MessageKey> = { '1': 'farmer.confirm1', '2': 'farmer.confirm2', '9': 'farmer.confirm9' };

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
  const { audio, line, playing, ended, voiceMissing, answer, toggle, stop } = useCallAudio(session, phase === 'live');

  useEffect(() => {
    if (phase !== 'live') return;
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [phase]);

  const book = useCallback(
    (key: KeyAction) => {
      if (!session) return Promise.reject(new Error('no session'));
      return api.bookKey({ sessionId: session.sessionId, key, lang });
    },
    [session, lang],
  );

  // the call reads back each step, like a real phone menu
  const onChoose = useCallback((key: KeyAction) => {
    stop();
    speakText(t(CONFIRM_KEY[key]), lang);
  }, [lang, stop, t]);
  const onBack = useCallback(() => speakText(t('farmer.backNote'), lang), [lang, t]);
  const onConfirmed = useCallback((key: KeyAction, _r: BookingReceipt) => {
    stop();
    speakText(t(DONE_KEY[key]), lang);
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
        <Link to="/fpo" className="inline-flex items-center gap-2 text-sm font-semibold text-ink">Back to FPO console</Link>
      </div>
      <Link to="/" className="mr-auto hidden items-center gap-2 text-sm font-semibold text-ink sm:inline-flex" aria-label={t('common.back')}><IconBack /> {t('common.back')}</Link>

      <main id="main" aria-label={t('nav.farmer')} className="relative flex w-full max-w-[420px] flex-1 flex-col overflow-hidden bg-[#0B1D33] text-white sm:max-h-[860px] sm:min-h-[760px] sm:flex-none sm:rounded-[44px] sm:border-[10px] sm:border-[#0F2A47] sm:shadow-2xl">
        <div className="flex flex-col gap-4 overflow-y-auto p-4">
          <div className="flex items-center justify-between gap-2">
            <LangSwitch large inverse />
            <Link to="/" className="sm:hidden btn !bg-white/15 !text-white !px-3" aria-label={t('common.back')}><IconBack /></Link>
          </div>

          <AsyncBoundary state={session ? { status: 'success', data: session } : sessionState} onRetry={sessionState.reload} what={t('nav.farmer')} retryLabel={t('farmer.tryAgain')} skeleton={<SkeletonBlock rows={5} label={t('common.loading')} />}>
            {(s) => (
              <>
                {phase === 'ringing' && (
                  <section aria-label={t('farmer.incoming')} className="flex flex-1 flex-col items-center gap-5 py-8 text-center">
                    <div className="text-sm font-semibold uppercase tracking-widest text-air-400">{t('farmer.incoming')}</div>
                    <div className="flex h-28 w-28 items-center justify-center rounded-full bg-leaf-700 lamp"><IconPhone size={48} /></div>
                    <div>
                      <h1 className="text-2xl font-bold">{s.callerName}</h1>
                      <div className="mono text-sm text-[#C9DDF0]">{s.callerId}</div>
                    </div>
                    <div className="mt-6 flex w-full flex-col gap-3">
                      <button type="button" className="btn btn-primary btn-lg w-full" onClick={pickUp} data-testid="answer">{t('farmer.answer')}</button>
                      <Link to="/" className="btn btn-lg w-full !bg-white/12 !text-white">{t('farmer.later')}</Link>
                    </div>
                    <p className="m-0 text-sm text-[#C9DDF0]">{t('farmer.calmNote')}</p>
                  </section>
                )}

                {phase === 'live' && (
                  <>
                    <section aria-label={t('farmer.callStatus')} className="flex items-center gap-3 rounded-3xl bg-white/10 p-3">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-leaf-700"><IconPhone /></div>
                      <div className="min-w-0 flex-1">
                        <h1 className="truncate text-base font-bold">{s.callerName}</h1>
                        <div className="mono text-xs text-[#C9DDF0]"><span className="sr-only">{t('farmer.elapsed')} </span><span data-testid="timer">{mmss(elapsed)}</span> · {s.callerId}</div>
                      </div>
                      <button type="button" onClick={toggle} className="btn !h-14 !w-14 !rounded-full !px-0" style={{ background: '#fff', color: '#0B1D33' }} aria-label={playing ? t('farmer.pause') : ended ? t('farmer.replay') : t('farmer.play')} data-testid="play-pause">
                        {playing ? <IconPause size={24} /> : <IconPlay size={24} />}
                      </button>
                    </section>

                    <Waveform audio={audio} playing={playing} />

                    <section aria-label={t('farmer.subtitles')} className="min-h-[132px] rounded-3xl bg-black/25 p-4" lang={s.lang === 'pa' ? 'pa-IN' : s.lang === 'hi' ? 'hi-IN' : 'en-IN'}>
                      {voiceMissing && <p className="m-0 mb-2 text-xs text-amber-200">{t('farmer.noVoice')}</p>}
                      {line > 0 && <p className="m-0 mb-2 text-base text-[#8FA9C4]" aria-hidden="true">{s.lines[line - 1]?.text}</p>}
                      <p className="m-0 text-xl font-semibold leading-snug" data-testid="subtitle">{s.lines[line]?.text}</p>
                      {gloss.status === 'success' && gloss.data && gloss.data.lines[line] && (
                        <p className="m-0 mt-2 text-sm text-[#8FA9C4]" lang="en-IN">{gloss.data.lines[line].text}</p>
                      )}
                    </section>

                    <details className="rounded-2xl bg-white/8 px-4 py-2 text-sm">
                      <summary className="min-h-11 cursor-pointer py-2 font-semibold">{t('farmer.transcript')}</summary>
                      <ol className="m-0 flex list-decimal flex-col gap-2 pb-2 pl-5 text-[#DCE9F5]">{s.lines.map((l) => <li key={l.id}>{l.text}</li>)}</ol>
                    </details>

                    {(s.prices.superSeederPerAcre !== null || s.prices.strawPerTonne !== null) && (
                      <div className="grid grid-cols-2 gap-3 text-center" aria-label={t('farmer.prices')} role="group">
                        {s.prices.superSeederPerAcre !== null && <div className="rounded-2xl bg-white/10 p-3"><div className="text-xs text-[#C9DDF0]">{t('farmer.priceSeeder')}</div><div className="mono text-lg font-bold">{formatInr(s.prices.superSeederPerAcre)}<span className="text-xs font-normal">/{t('farmer.acre')}</span></div></div>}
                        {s.prices.strawPerTonne !== null && <div className="rounded-2xl bg-white/10 p-3"><div className="text-xs text-[#C9DDF0]">{t('farmer.priceStraw')}</div><div className="mono text-lg font-bold">{formatInr(s.prices.strawPerTonne)}<span className="text-xs font-normal">/{t('farmer.tonne')}</span></div></div>}
                      </div>
                    )}

                    <KeypadPanel book={book} onTone={(k) => playDtmf(k)} onChoose={onChoose} onBack={onBack} onConfirmed={onConfirmed} prices={s.prices} />


                    <p className="m-0 text-center text-sm text-[#C9DDF0]">{t('farmer.calmNote')}</p>
                    <button type="button" className="btn btn-lg !bg-[#8A1C1C] !text-white" onClick={hangUp}>{t('farmer.endCall')}</button>
                  </>
                )}

                {phase === 'ended' && (
                  <section aria-label={t('farmer.callEnded')} className="flex flex-1 flex-col items-center gap-5 py-12 text-center">
                    <h1 className="text-2xl font-bold">{t('farmer.callEnded')}</h1>
                    <p className="m-0 text-lg">{t('farmer.calmNote')}</p>
                    <div className="mono text-sm text-[#C9DDF0]">{mmss(elapsed)}</div>
                    <button type="button" className="btn btn-primary btn-lg w-full" onClick={() => setPhase('ringing')}>{t('farmer.callAgain')}</button>
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
