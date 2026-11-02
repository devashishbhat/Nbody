import { useId } from 'react';

export interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean | undefined;
  hint?: string | undefined;
}

export function Toggle({ label, checked, onChange, disabled, hint }: ToggleProps) {
  const id = useId();
  return (
    <div className="nb-field nb-field--inline">
      <label className="nb-field-label" htmlFor={id} title={hint}>
        {label}
      </label>
      <input
        id={id}
        className="nb-checkbox"
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </div>
  );
}
