import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };
function Svg({ size = 18, children, ...rest }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      {children}
    </svg>
  );
}
export const IconBack = (p: P) => <Svg {...p}><path d="M15 5l-7 7 7 7" /></Svg>;
export const IconPhone = (p: P) => <Svg {...p}><path d="M5 3h4l2 5-2.5 1.5a11 11 0 005 5L15 12l5 2v4a2 2 0 01-2 2A16 16 0 013 5a2 2 0 012-2z" /></Svg>;
export const IconCheck = (p: P) => <Svg {...p}><path d="M5 13l4 4L19 7" /></Svg>;
export const IconAlert = (p: P) => <Svg {...p}><path d="M12 3l10 18H2L12 3z" /><path d="M12 10v5M12 18v.01" /></Svg>;
export const IconWind = (p: P) => <Svg {...p}><path d="M3 8h11a3 3 0 10-3-3M3 12h15a3 3 0 11-3 3M3 16h7" /></Svg>;
export const IconCamera = (p: P) => <Svg {...p}><path d="M3 7h4l2-3h6l2 3h4v13H3z" /><circle cx="12" cy="13" r="4" /></Svg>;
export const IconRoute = (p: P) => <Svg {...p}><circle cx="6" cy="18" r="2" /><circle cx="18" cy="6" r="2" /><path d="M6 16V9c0-3 12 3 12 0V8" /></Svg>;
export const IconPin = (p: P) => <Svg {...p}><path d="M12 21s7-6 7-12a7 7 0 10-14 0c0 6 7 12 7 12z" /><circle cx="12" cy="9" r="2.5" /></Svg>;
export const IconPlay = (p: P) => <Svg {...p} fill="currentColor"><path d="M7 4l13 8-13 8z" /></Svg>;
export const IconPause = (p: P) => <Svg {...p} fill="currentColor"><path d="M6 4h4v16H6zM14 4h4v16h-4z" /></Svg>;
export const IconTruck = (p: P) => <Svg {...p}><path d="M2 6h11v10H2zM13 9h4l4 3v4h-8" /><circle cx="7" cy="18" r="2" /><circle cx="17" cy="18" r="2" /></Svg>;
export const IconDownload = (p: P) => <Svg {...p}><path d="M12 4v11m0 0l-4-4m4 4l4-4M5 20h14" /></Svg>;
export const IconWifiOff = (p: P) => <Svg {...p}><path d="M3 3l18 18M8.5 12.5a6 6 0 017 0M5 9a11 11 0 015-2.5M19 9a11 11 0 00-3-2M12 19v.01" /></Svg>;
export const IconSpinner = (p: P) => <Svg {...p} className="animate-spin"><path d="M12 3a9 9 0 109 9" /></Svg>;
export const IconUser = (p: P) => <Svg {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></Svg>;
export const IconFactory = (p: P) => <Svg {...p}><path d="M3 21V9l6 4V9l6 4V5h4v16z" /></Svg>;
export const IconGlobe = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" /></Svg>;
