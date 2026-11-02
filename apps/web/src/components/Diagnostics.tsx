import type { Readouts } from '../readouts.ts';

/**
 * The accuracy and cost readout.
 *
 * Energy drift is the headline. It costs almost nothing to compute and it is
 * the cheapest honest signal that a simulation has gone wrong, which is what
 * separates this from an animation: the numbers are real, and when they stop
 * being real it says so.
 */
export function Diagnostics({ readouts }: { readouts: Readouts }) {
  return (
    <section className="nb-panel nb-bottom-left" aria-label="Diagnostics">
      <Row label="Energy drift" binding={readouts.drift} initial="0.0e+00" />
      <Row label="Momentum" binding={readouts.momentum} initial="0.000e+00" />
      <Row label="Bodies" binding={readouts.bodies} initial="0" />
      <Row label="Forces" binding={readouts.forceModel} initial="direct" />
      <Row label="Per step" binding={readouts.msPerStep} initial="  0.000 ms" />
      <Row label="FPS" binding={readouts.fps} initial="---" />
    </section>
  );
}

function Row({
  label,
  binding,
  initial,
}: {
  label: string;
  binding: { attach: (element: HTMLElement | null) => void };
  initial: string;
}) {
  return (
    <div className="nb-row">
      <span className="nb-label">{label}</span>
      {/* aria-live is off deliberately: announcing a sixty-hertz number would
          make the page unusable with a screen reader. */}
      <span className="nb-num" aria-live="off" ref={binding.attach}>
        {initial}
      </span>
    </div>
  );
}
