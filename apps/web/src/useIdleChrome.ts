import { useEffect } from 'react';

/** How long the chrome stays at full strength after the pointer stops. */
const IDLE_DELAY_MS = 2600;

/**
 * Fades the chrome out when nothing is happening.
 *
 * The default state of this app is a simulation running with almost nothing on
 * top of it. The panels are needed the moment someone reaches for them and not
 * before, so they follow the pointer rather than a setting.
 *
 * Suppressed while anything has keyboard focus, so a panel never fades out
 * from under someone tabbing through it, and disabled entirely under
 * prefers-reduced-motion.
 */
export function useIdleChrome(): void {
  useEffect(() => {
    const body = document.body;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let timer: ReturnType<typeof setTimeout> | undefined;

    function wake(): void {
      body.classList.add('nb-active');
      clearTimeout(timer);
      timer = setTimeout(() => {
        // Never fade while the user is in a control, or mid-drag.
        const active = document.activeElement;
        const inPanel = active instanceof HTMLElement && active.closest('.nb-panel') !== null;
        if (!inPanel) body.classList.remove('nb-active');
      }, IDLE_DELAY_MS);
    }

    if (reduced.matches) {
      body.classList.add('nb-active');
      return () => body.classList.remove('nb-active');
    }

    wake();
    window.addEventListener('pointermove', wake, { passive: true });
    window.addEventListener('pointerdown', wake, { passive: true });
    window.addEventListener('keydown', wake);
    window.addEventListener('focusin', wake);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointermove', wake);
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
      window.removeEventListener('focusin', wake);
      body.classList.remove('nb-active');
    };
  }, []);
}
