import type { FarmerStatus, MachineType } from '@/api/contract';

export const MACHINE_LABEL: Record<MachineType, string> = {
  super_seeder: 'Super Seeder',
  baler: 'baler',
  happy_seeder: 'Happy Seeder',
};

export const STATUS_META: Record<FarmerStatus, { label: string; bg: string; fg: string }> = {
  to_contact: { label: 'To contact', bg: '#FFF1E6', fg: '#8A4B0F' },
  called: { label: 'Called', bg: '#DFF3FF', fg: '#0F4C81' },
  confirmed: { label: 'Wants machine', bg: '#EDE7FF', fg: '#4B2A9E' },
  dispatched: { label: 'Dispatched', bg: '#E3F8EE', fg: '#0B5C3E' },
};
