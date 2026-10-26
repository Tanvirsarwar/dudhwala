'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/** True only where hover effects make sense: a precise pointer and no reduced-motion preference. */
function motionAllowed(): boolean {
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Subtle 3D tilt toward the pointer. Sets --rx/--ry on the wrapper; the `.tilt` class turns them into a transform.
 * No effect on touch devices or with reduced motion. Pointer events only update CSS variables (no React re-render).
 */
export function Tilt({ children, max = 6, className = '' }: { children: ReactNode; max?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !motionAllowed()) return;
    let raf = 0;
    const move = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        el.style.setProperty('--ry', String(x * max * 2));
        el.style.setProperty('--rx', String(-y * max * 2));
      });
    };
    const reset = () => {
      cancelAnimationFrame(raf);
      el.style.setProperty('--rx', '0');
      el.style.setProperty('--ry', '0');
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', reset);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', reset);
    };
  }, [max]);
  return (
    <div ref={ref} className={`tilt ${className}`}>
      {children}
    </div>
  );
}

/** Wrapper that exposes the pointer position (-0.5..0.5) as --px/--py for `.depth-layer` children. */
export function ParallaxScene({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !motionAllowed()) return;
    let raf = 0;
    const move = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        el.style.setProperty('--px', String((e.clientX - r.left) / r.width - 0.5));
        el.style.setProperty('--py', String((e.clientY - r.top) / r.height - 0.5));
      });
    };
    const reset = () => {
      el.style.setProperty('--px', '0');
      el.style.setProperty('--py', '0');
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', reset);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', reset);
    };
  }, []);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
