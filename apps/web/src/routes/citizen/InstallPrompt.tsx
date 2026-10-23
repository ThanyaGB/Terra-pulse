import { useEffect, useState } from 'react';
import { IconDownload } from '@/design-system/Icons';
import { useI18n } from '@/i18n';
import { readJson, writeJson } from './storage';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const KEY = 'vs.install.dismissed';

/** "Add to home screen": Chrome/Edge/Android via beforeinstallprompt, a how-to line on iOS Safari. */
export function InstallPrompt() {
  const { t } = useI18n();
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(() => readJson<boolean>(KEY) === true);
  const [installed, setInstalled] = useState(false);

  const standalone = typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
  const ios = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent);

  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setEvt(e as BeforeInstallPromptEvent); };
    const onInstalled = () => { setInstalled(true); setEvt(null); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => { window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onInstalled); };
  }, []);

  if (dismissed || standalone || installed || (!evt && !ios)) return null;

  return (
    <aside aria-label={t('cz.install.title')} className="tile flex items-start gap-3 !p-4" data-testid="install-prompt">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-navy text-white"><IconDownload /></span>
      <div className="min-w-0 flex-1">
        <div className="font-bold">{t('cz.install.title')}</div>
        <p className="m-0 text-sm text-ink-soft">{evt ? t('cz.install.body') : t('cz.install.ios')}</p>
        <div className="mt-2 flex gap-2">
          {evt && <button type="button" className="btn btn-primary !min-h-11" onClick={async () => { await evt.prompt(); await evt.userChoice; setEvt(null); }}>{t('cz.install.button')}</button>}
          <button type="button" className="btn btn-ghost !min-h-11" onClick={() => { writeJson(KEY, true); setDismissed(true); }}>{t('cz.install.dismiss')}</button>
        </div>
      </div>
    </aside>
  );
}
