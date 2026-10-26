import type { SupplyOfferStatus } from '@/api/contract';

/** Pill colours for offer status. Light chips on the dark command theme, same as the FPO farmer table. */
export const OFFER_STATUS: Record<SupplyOfferStatus, { label: string; bg: string; fg: string }> = {
  open: { label: 'Open', bg: '#DFF3FF', fg: '#0F4C81' },
  claimed: { label: 'Claimed', bg: '#EDE7FF', fg: '#4B2A9E' },
  collected: { label: 'Collected', bg: '#E3F8EE', fg: '#0B5C3E' },
  disputed: { label: 'Disputed', bg: '#FDE2E2', fg: '#8A1C1C' },
};

/** Verification check colours: positive results green, waiting grey, holds amber, failures red. */
export const CHECK_TONE = {
  good: { bg: '#E3F8EE', fg: '#0B5C3E' },
  wait: { bg: '#EEF3F8', fg: '#2E4A66' },
  hold: { bg: '#FFF1E6', fg: '#8A4B0F' },
  bad: { bg: '#FDE2E2', fg: '#8A1C1C' },
} as const;
