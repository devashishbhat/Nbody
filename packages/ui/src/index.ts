/**
 * @nbody/ui
 *
 * LANE E owns this package together with apps/web.
 *
 * What is here in Phase 0 is the part the rest of the UI has to be built on
 * rather than around: the design tokens, and the primitives that keep
 * per-frame values out of React. The panels, inspector, transport bar and
 * command palette are Lane E's to build.
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
