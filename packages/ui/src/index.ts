/**
 * @nbody/ui
 *
 * The design tokens, the primitives that keep per-frame values out of React,
 * and the reusable controls. Panels and layout live in the app.
 *
 * Optional props on these controls are declared `?: T | undefined` rather than
 * `?: T`. `exactOptionalPropertyTypes` is on, which otherwise rejects
 * `disabled={maybeUndefined}`, and forwarding a possibly-undefined prop is how
 * React components are normally composed. Saying so in the types is better
 * than relaxing the flag, which is catching real mistakes in the numeric code.
 */
export { LiveText, useLiveText } from './live.ts';
export {
  formatDaysAsYears,
  formatDrift,
  formatFps,
  formatMsPerStep,
  formatScientific,
  formatSimTime,
} from './format.ts';

export { LogSlider, type LogSliderProps } from './controls/LogSlider.tsx';
export { NumberField, type NumberFieldProps } from './controls/NumberField.tsx';
export { VectorField, type VectorFieldProps } from './controls/VectorField.tsx';
export { Select, type SelectOption, type SelectProps } from './controls/Select.tsx';
export { Toggle, type ToggleProps } from './controls/Toggle.tsx';
