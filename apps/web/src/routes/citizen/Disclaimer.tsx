import { disclaimerText, usePublicConfig } from '@/api/usePublicConfig';
import { useI18n } from '@/i18n';

/** Exposure-guidance disclaimer (ADR-18). The wording comes from config/disclaimers.yaml so legal can change it without a release. */
export function Disclaimer() {
  const { lang } = useI18n();
  const cfg = usePublicConfig();
  return <p className="m-0 mt-3 text-xs text-ink-soft" data-testid="disclaimer">{disclaimerText(cfg, 'citizen_advice', lang)}</p>;
}
