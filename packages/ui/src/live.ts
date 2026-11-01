import { useMemo } from 'react';

/**
 * A text node the render loop writes to directly.
 *
 * This is the escape hatch that keeps the single most important performance
 * rule in the codebase enforceable: React renders the static shell, and
 * anything that changes per frame bypasses React entirely.
 *
 * Routing a sixty-hertz readout through component state would re-render a
 * subtree sixty times a second and make the frame budget hostage to
 * reconciliation. Writing `textContent` costs a string comparison and, when
 * the text actually changed, one DOM write.
 *
 * The comparison matters as much as the write: most readouts are stable most
 * of the time, and skipping unchanged writes keeps the browser from
 * invalidating layout for text that did not move.
 */
export class LiveText {
  private element: HTMLElement | null = null;
  private last: string | null = null;

  /** Ref callback. Pass straight to an element's `ref`. */
  readonly attach = (element: HTMLElement | null): void => {
    this.element = element;
    this.last = null;
  };

  set(text: string): void {
    if (text === this.last) return;
    this.last = text;
    if (this.element) this.element.textContent = text;
  }

  get attached(): boolean {
    return this.element !== null;
  }
}

/** A LiveText that survives re-renders of the component holding it. */
export function useLiveText(): LiveText {
  return useMemo(() => new LiveText(), []);
}
