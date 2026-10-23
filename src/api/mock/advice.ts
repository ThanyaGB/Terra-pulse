import type { AdviceItem, AdviceResponse, HealthProfile } from '../contract';

export type Period = AdviceResponse['period'];

/** Time-of-day periods used for health advice (local hour, may be fractional). */
export function periodFor(hour: number): Period {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 5 && h < 10.5) return 'early_morning';
  if (h >= 10.5 && h < 13) return 'midday';
  if (h >= 13 && h < 16.5) return 'afternoon';
  if (h >= 16.5 && h < 21) return 'evening';
  if (h >= 21 || h < 5) return 'night';
  return 'morning';
}

const PROFILE_BASE: Record<HealthProfile, AdviceItem[]> = {
  asthma: [
    { id: 'inhaler', title: 'Keep your prescribed inhaler with you', body: 'Carry it whenever you step out, even for a short errand.', level: 'caution' },
    { id: 'purifier', title: 'Stay in a room with windows shut', body: 'Use a purifier or a damp cloth at door gaps if you have one.', level: 'caution' },
  ],
  child: [
    { id: 'recess', title: 'Prefer indoor play today', body: 'Schools may move sports indoors while AQI is Very Poor.', level: 'avoid' },
    { id: 'mask', title: 'A well-fitted child-size N95 for the commute', body: 'Child sizes seal better than adult masks.', level: 'caution' },
  ],
  elderly: [
    { id: 'rest', title: 'Keep outings short and slow', body: 'Avoid climbing stairs repeatedly or carrying loads outdoors.', level: 'caution' },
    { id: 'meds', title: 'Keep regular medicines on schedule', body: 'Call your doctor if breathing feels heavier than usual.', level: 'caution' },
  ],
  outdoor: [
    { id: 'n95', title: 'Wear an N95 during shifts', body: 'Surgical and cloth masks do not filter fine particles.', level: 'avoid' },
    { id: 'breaks', title: 'Take breaks away from the main road', body: 'Rest in a lane or courtyard, away from traffic fumes.', level: 'caution' },
  ],
  general: [
    { id: 'windows', title: 'Keep windows shut when air is Very Poor', body: 'Open them briefly in the clearer afternoon window.', level: 'caution' },
    { id: 'water', title: 'Drink water and rinse your eyes after being outside', body: 'It helps clear irritants.', level: 'ok' },
  ],
};

function periodItems(profile: HealthProfile, p: Period): AdviceItem[] {
  const sensitive = profile === 'asthma' || profile === 'child' || profile === 'elderly';
  switch (p) {
    case 'early_morning':
      return [
        {
          id: 'inversion',
          title: sensitive ? 'Skip outdoor exercise until 10:30' : 'Avoid outdoor exercise before 10:30',
          body: 'Smoke is trapped under the morning inversion layer, the worst hours of the day.',
          level: 'avoid',
        },
      ];
    case 'midday':
      return [{ id: 'midday', title: 'Air starts to lift', body: 'Wait for the 13:30 window for errands that need you outdoors.', level: 'caution' }];
    case 'afternoon':
      return [
        {
          id: 'ventilation',
          title: 'Best window of the day: 13:30 to 16:00',
          body: 'Wind speeds rise and pollutants disperse. Air out rooms and run outdoor errands now.',
          level: 'ok',
        },
      ];
    case 'evening':
      return [
        {
          id: 'traffic',
          title: 'Evening traffic and cooling trap smoke again',
          body: 'Avoid arterial roads between 17:30 and 20:30; prefer inner lanes.',
          level: 'avoid',
        },
      ];
    case 'night':
      return [{ id: 'night', title: 'Keep windows closed overnight', body: 'Pollution builds up again after 21:00.', level: 'caution' }];
    default:
      return [];
  }
}

export function buildAdvice(profile: HealthProfile, hour: number): AdviceResponse {
  const period = periodFor(hour);
  return { profile, period, items: [...periodItems(profile, period), ...PROFILE_BASE[profile]] };
}
