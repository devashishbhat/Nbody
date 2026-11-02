import { useId } from 'react';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  /** Shown under the control when this option is active. */
  hint?: string | undefined;
}

export interface SelectProps<T extends string> {
  label: string;
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean | undefined;
}

/**
 * A labelled select that can explain the current choice.
 *
 * The hint matters for the integrator and force model, where the options are
 * real trade-offs rather than preferences and the right one depends on the
 * scenario.
 */
export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: SelectProps<T>) {
  const id = useId();
  const active = options.find((option) => option.value === value);

  return (
    <div className="nb-field">
      <label className="nb-field-label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="nb-select nb-select--full"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {active?.hint ? <p className="nb-hint">{active.hint}</p> : null}
    </div>
  );
}
