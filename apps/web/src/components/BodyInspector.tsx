import type { Body, Vec3 } from '@nbody/protocol';
import { LogSlider, NumberField, Toggle, VectorField } from '@nbody/ui';
import { useStore, editBodyProperty, editBodyState, removeBody } from '../store.ts';
import type { Readouts } from '../readouts.ts';

const MIN_MASS = 1e-12;
const MAX_MASS = 1e9;

/**
 * The selected body.
 *
 * Mass is the control people reach for first, so it gets a log slider and a
 * numeric field rather than one or the other: the slider is for exploring,
 * the field is for saying exactly 1e-6.
 *
 * Position and velocity edit the LIVE state and are deliberately not written
 * into the document, so resetting puts the body back where it started rather
 * than where it was dragged to. Mass, radius, colour and the flags are part of
 * what the system is, so those do persist through a reset.
 */
export function BodyInspector({ body, readouts }: { body: Body; readouts: Readouts }) {
  const live = useStore((state) => state.liveSelected);
  const unit = useStore((state) => (state.scenario.units === 'solar' ? 'AU' : ''));

  const position = live?.position ?? body.position;
  const velocity = live?.velocity ?? body.velocity;
  const speed = Math.hypot(velocity[0], velocity[1], velocity[2]);

  return (
    <div className="nb-inspector-body">
      <header className="nb-inspector-head">
        <span className="nb-swatch" style={{ background: body.color }} aria-hidden="true" />
        <input
          className="nb-input nb-name"
          value={body.name}
          aria-label="Body name"
          onChange={(event) => editBodyProperty(body.id, { name: event.target.value }, 'rename')}
        />
      </header>

      <LogSlider
        label="Mass"
        value={Math.max(body.mass, MIN_MASS)}
        min={MIN_MASS}
        max={MAX_MASS}
        format={(value) => value.toExponential(3)}
        onChange={(value) => editBodyProperty(body.id, { mass: value }, 'change mass', 'mass')}
      />
      <NumberField
        label="Exact"
        value={body.mass}
        onChange={(value) => editBodyProperty(body.id, { mass: value }, 'change mass')}
      />

      <NumberField
        label="Radius"
        value={body.radius}
        suffix={unit}
        onChange={(value) => editBodyProperty(body.id, { radius: value }, 'change radius')}
      />

      <VectorField
        label="Position"
        value={position}
        unit={unit}
        summary={formatMagnitude(position)}
        onChange={(value) =>
          editBodyState(body.id, { position: value }, { position }, 'move body', 'position')
        }
      />

      <VectorField
        label="Velocity"
        value={velocity}
        summary={speed.toPrecision(4)}
        onChange={(value) =>
          editBodyState(body.id, { velocity: value }, { velocity }, 'change velocity', 'velocity')
        }
      />

      <div className="nb-field nb-field--inline">
        <label className="nb-field-label" htmlFor="nb-colour">
          Colour
        </label>
        <input
          id="nb-colour"
          className="nb-colour"
          type="color"
          value={body.color}
          onChange={(event) =>
            editBodyProperty(body.id, { color: event.target.value }, 'change colour')
          }
        />
      </div>

      <Toggle
        label="Trail"
        checked={body.trail ?? false}
        onChange={(checked) => editBodyProperty(body.id, { trail: checked }, 'toggle trail')}
      />
      <Toggle
        label="Pinned"
        hint="Exerts gravity but does not move. How restricted problems are set up."
        checked={body.locked ?? false}
        onChange={(checked) => editBodyProperty(body.id, { locked: checked }, 'pin body')}
      />

      <section className="nb-elements" aria-label="Orbital elements">
        <h3 className="nb-section-title">Orbit</h3>
        <p className="nb-hint">
          The two-body orbit this body would follow about the heaviest one, right now.
        </p>
        <Element label="Distance" readout={readouts.selectedDistance} />
        <Element label="Speed" readout={readouts.selectedSpeed} />
        <Element label="Semi-major" readout={readouts.selectedSemiMajor} />
        <Element label="Eccentricity" readout={readouts.selectedEccentricity} />
        <Element label="Inclination" readout={readouts.selectedInclination} />
        <Element label="Period" readout={readouts.selectedPeriod} />
      </section>

      <button className="nb-button nb-button--danger" onClick={() => removeBody(body.id)}>
        Remove body
      </button>
    </div>
  );
}

function Element({
  label,
  readout,
}: {
  label: string;
  readout: { attach: (element: HTMLElement | null) => void };
}) {
  return (
    <div className="nb-row">
      <span className="nb-label">{label}</span>
      <span className="nb-num" aria-live="off" ref={readout.attach}>
        -
      </span>
    </div>
  );
}

function formatMagnitude(vector: Vec3): string {
  return Math.hypot(vector[0], vector[1], vector[2]).toPrecision(4);
}
