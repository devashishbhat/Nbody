import type { Vec3 } from '@nbody/protocol';
import { NumberField } from './NumberField.tsx';

export interface VectorFieldProps {
  label: string;
  value: Vec3;
  onChange: (value: Vec3) => void;
  disabled?: boolean | undefined;
  unit?: string | undefined;
  /** Shown above the components. Usually the magnitude. */
  summary?: string | undefined;
}

const AXES = ['x', 'y', 'z'] as const;

/** Three numeric inputs plus a magnitude readout. */
export function VectorField({ label, value, onChange, disabled, unit, summary }: VectorFieldProps) {
  return (
    <div className="nb-vector">
      <div className="nb-field-label">
        {label}
        {summary ? <span className="nb-num nb-field-value">{summary}</span> : null}
      </div>
      {AXES.map((axis, index) => (
        <NumberField
          key={axis}
          label={axis}
          value={value[index]!}
          disabled={disabled}
          suffix={index === 2 ? unit : undefined}
          onChange={(next) => {
            const updated: [number, number, number] = [value[0], value[1], value[2]];
            updated[index] = next;
            onChange(updated);
          }}
        />
      ))}
    </div>
  );
}
