import { useCallback, useId } from 'react';

export interface LogSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  /** Shown to the right of the label. */
  format?: (value: number) => string | undefined;
  disabled?: boolean | undefined;
  /** Marks the control as mid-drag, so callers can batch undo entries. */
  onCommit?: () => void | undefined;
}

const STEPS = 1000;

/**
 * A slider that moves in orders of magnitude.
 *
 * Masses in this app span from 1e-7 solar masses to 1e6 of them. On a linear
 * slider every planet in the solar system occupies the same invisible sliver
 * next to zero, and the only reachable values are stellar. Interpolating the
 * logarithm instead gives every decade the same width, which is the only way
 * the control is usable for both a moon and a star.
 *
 * The same reasoning applies to the time scale and to softening.
 */
export function LogSlider({
  label,
  value,
  min,
  max,
  onChange,
  format,
  disabled,
  onCommit,
}: LogSliderProps) {
  const id = useId();
  const logMin = Math.log(min);
  const logMax = Math.log(max);

  const position = Math.round(
    ((Math.log(Math.max(value, min)) - logMin) / (logMax - logMin)) * STEPS,
  );

  const handle = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const t = Number(event.target.value) / STEPS;
      onChange(Math.exp(logMin + t * (logMax - logMin)));
    },
    [logMin, logMax, onChange],
  );

  return (
    <div className="nb-field">
      <label className="nb-field-label" htmlFor={id}>
        {label}
        <span className="nb-num nb-field-value">
          {format ? format(value) : value.toPrecision(4)}
        </span>
      </label>
      <input
        id={id}
        className="nb-slider"
        type="range"
        min={0}
        max={STEPS}
        step={1}
        value={Number.isFinite(position) ? position : 0}
        onChange={handle}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        disabled={disabled}
      />
    </div>
  );
}
