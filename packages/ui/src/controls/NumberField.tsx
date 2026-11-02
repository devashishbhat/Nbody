import { useEffect, useId, useState } from 'react';

export interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number | undefined;
  disabled?: boolean | undefined;
  suffix?: string | undefined;
}

/**
 * A numeric input that does not fight the user mid-typing.
 *
 * The field keeps its own text while focused and only reports a parsed value
 * when that text is a finite number. Driving it directly from the prop would
 * make "1e-" or "-" or "" unrepresentable, so the caret would jump or the
 * character would be rejected as the user typed it. Exponential notation has
 * to be typeable here, because several of these values are around 1e-6.
 */
export function NumberField({ label, value, onChange, step, disabled, suffix }: NumberFieldProps) {
  const id = useId();
  const [text, setText] = useState(() => String(value));
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setText(formatValue(value));
  }, [value, editing]);

  return (
    <div className="nb-field nb-field--inline">
      <label className="nb-field-label" htmlFor={id}>
        {label}
      </label>
      <span className="nb-input-wrap">
        <input
          id={id}
          className="nb-input nb-num"
          type="text"
          inputMode="decimal"
          spellCheck={false}
          value={text}
          step={step}
          disabled={disabled}
          onFocus={() => setEditing(true)}
          onBlur={() => {
            setEditing(false);
            setText(formatValue(value));
          }}
          onChange={(event) => {
            setText(event.target.value);
            const parsed = Number(event.target.value);
            if (event.target.value.trim() !== '' && Number.isFinite(parsed)) {
              onChange(parsed);
            }
          }}
        />
        {suffix ? <span className="nb-input-suffix">{suffix}</span> : null}
      </span>
    </div>
  );
}

/**
 * Enough digits to round-trip, without printing seventeen of them for a value
 * the user typed as 1.
 */
function formatValue(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (value === 0) return '0';
  const magnitude = Math.abs(value);
  if (magnitude < 1e-4 || magnitude >= 1e7) return value.toExponential(6).replace(/e\+?/, 'e');
  const short = String(Number(value.toPrecision(10)));
  return short;
}
