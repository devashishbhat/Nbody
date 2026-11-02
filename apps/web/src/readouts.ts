import { LiveText } from '@nbody/ui';
import { useMemo } from 'react';

/**
 * Every value that changes per frame.
 *
 * These are written straight to their text nodes from inside the animation
 * frame and never pass through React state. A sixty-hertz readout driven
 * through component state would re-render a subtree sixty times a second and
 * make the frame budget hostage to reconciliation, which is the single rule
 * the whole architecture is arranged around. See docs/CONTRACTS.md.
 */
export interface Readouts {
  simTime: LiveText;
  clock: LiveText;
  drift: LiveText;
  fps: LiveText;
  msPerStep: LiveText;
  bodies: LiveText;
  momentum: LiveText;
  forceModel: LiveText;

  /** Live values for the selected body. */
  selectedName: LiveText;
  selectedDistance: LiveText;
  selectedSpeed: LiveText;
  selectedSemiMajor: LiveText;
  selectedEccentricity: LiveText;
  selectedPeriod: LiveText;
  selectedInclination: LiveText;
}

const KEYS: (keyof Readouts)[] = [
  'simTime',
  'clock',
  'drift',
  'fps',
  'msPerStep',
  'bodies',
  'momentum',
  'forceModel',
  'selectedName',
  'selectedDistance',
  'selectedSpeed',
  'selectedSemiMajor',
  'selectedEccentricity',
  'selectedPeriod',
  'selectedInclination',
];

/** One stable set of bindings for the lifetime of the app. */
export function useReadouts(): Readouts {
  return useMemo(() => {
    const readouts = {} as Readouts;
    for (const key of KEYS) readouts[key] = new LiveText();
    return readouts;
  }, []);
}
