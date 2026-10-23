import { gsap } from 'gsap';
import { prefersReducedMotion } from '@/hooks/useReducedMotion';

/** Staggered entrance for any `[data-reveal]` children. No-op when the visitor prefers reduced motion. */
export function revealIn(root: Element | null, selector = '[data-reveal]'): () => void {
  if (!root || prefersReducedMotion()) return () => {};
  const targets = root.querySelectorAll(selector);
  if (targets.length === 0) return () => {};
  const tween = gsap.fromTo(targets, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out', stagger: 0.06, clearProps: 'transform,opacity' });
  return () => { tween.kill(); };
}

/** Page transition for route changes. */
export function pageEnter(el: Element | null): () => void {
  if (!el || prefersReducedMotion()) return () => {};
  const tween = gsap.fromTo(el, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.35, ease: 'power2.out', clearProps: 'transform,opacity' });
  return () => { tween.kill(); };
}

/** Tween a number into a setter (used for headline figures). */
export function tweenNumber(from: number, to: number, onUpdate: (v: number) => void, duration = 0.8): () => void {
  if (prefersReducedMotion() || from === to) { onUpdate(to); return () => {}; }
  const o = { v: from };
  const tween = gsap.to(o, { v: to, duration, ease: 'power2.out', onUpdate: () => onUpdate(o.v) });
  return () => { tween.kill(); };
}

/** Modal entrance. */
export function popIn(el: Element | null): void {
  if (!el || prefersReducedMotion()) return;
  gsap.fromTo(el, { opacity: 0, y: 16, scale: 0.98 }, { opacity: 1, y: 0, scale: 1, duration: 0.28, ease: 'power3.out', clearProps: 'transform,opacity' });
}
