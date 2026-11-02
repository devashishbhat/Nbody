import { AUTO_BARNES_HUT_THRESHOLD, type ForceModelId, type IntegratorId } from '@nbody/protocol';
import { LogSlider, NumberField, Select, Toggle } from '@nbody/ui';
import { useStore, editSetting, setRenderOption } from '../store.ts';

const INTEGRATORS: { value: IntegratorId; label: string; hint: string }[] = [
  {
    value: 'leapfrog',
    label: 'Leapfrog',
    hint: 'Symplectic and time-symmetric. Energy error stays bounded instead of growing, and momentum is conserved exactly. The right default for a run you leave going.',
  },
  {
    value: 'yoshida4',
    label: 'Yoshida 4th order',
    hint: 'Three times the cost of leapfrog and about a thousand times more accurate at the same step. For long runs where accuracy matters.',
  },
  {
    value: 'dopri5',
    label: 'Dormand-Prince (adaptive)',
    hint: 'Chooses its own step size. The only correct choice when bodies pass close to each other, where any fixed step gives a different outcome. Not symplectic, so energy drifts over long runs.',
  },
];

const FORCE_MODELS: { value: ForceModelId; label: string; hint: string }[] = [
  {
    value: 'auto',
    label: 'Automatic',
    hint: `Direct summation below ${AUTO_BARNES_HUT_THRESHOLD} bodies, Barnes-Hut above.`,
  },
  {
    value: 'direct',
    label: 'Direct summation',
    hint: 'Every pair, exactly. Cost grows as the square of the body count.',
  },
  {
    value: 'barnes-hut',
    label: 'Barnes-Hut',
    hint: 'Distant clusters are replaced by their centre of mass. Much faster at large N, and approximate by an amount theta controls.',
  },
];

const COLLISIONS = [
  {
    value: 'none' as const,
    label: 'Pass through',
    hint: 'Bodies ignore each other geometrically.',
  },
  {
    value: 'merge' as const,
    label: 'Merge on contact',
    hint: 'Overlapping bodies combine, conserving mass, momentum and volume.',
  },
];

const RADIUS_MODES = [
  {
    value: 'log' as const,
    label: 'Readable',
    hint: 'Sizes compressed so every body is visible, resolving into true scale as you zoom in.',
  },
  {
    value: 'true' as const,
    label: 'True scale',
    hint: 'Real radii. At solar-system zoom everything is a dot, because it really is.',
  },
  { value: 'uniform' as const, label: 'Uniform dots', hint: 'Every body the same size.' },
];

/**
 * The simulation and view settings.
 *
 * Every one of these applies to the running simulation immediately. Nothing
 * here restarts anything, which is the point: changing gravity mid-flight and
 * watching what happens is the product.
 */
export function SystemInspector() {
  const scenario = useStore((state) => state.scenario);
  const options = useStore((state) => state.options);

  return (
    <div className="nb-inspector-body">
      <h3 className="nb-section-title">Physics</h3>

      <Select
        label="Integrator"
        value={scenario.integrator}
        options={INTEGRATORS}
        onChange={(value) => editSetting('integrator', value)}
      />

      <NumberField
        label="Step"
        value={scenario.dt}
        onChange={(value) => editSetting('dt', value)}
      />

      <LogSlider
        label="Gravity"
        value={Math.max(scenario.G, 1e-14)}
        min={1e-14}
        max={1e4}
        format={(value) => value.toExponential(3)}
        onChange={(value) => editSetting('G', value, 'drag')}
      />

      <NumberField
        label="Softening"
        value={scenario.softening}
        onChange={(value) => editSetting('softening', Math.max(0, value))}
      />

      <Select
        label="Forces"
        value={scenario.forceModel}
        options={FORCE_MODELS}
        onChange={(value) => editSetting('forceModel', value)}
      />

      {scenario.forceModel !== 'direct' ? (
        <>
          <LogSlider
            label="Opening angle"
            value={scenario.theta}
            min={0.1}
            max={1.5}
            format={(value) => value.toFixed(2)}
            onChange={(value) => editSetting('theta', value, 'drag')}
          />
        </>
      ) : null}

      <Select
        label="Collisions"
        value={scenario.collisions}
        options={COLLISIONS}
        onChange={(value) => editSetting('collisions', value)}
      />

      <h3 className="nb-section-title">View</h3>

      <Select
        label="Body size"
        value={options.radiusMode}
        options={RADIUS_MODES}
        onChange={(value) => setRenderOption('radiusMode', value)}
      />

      <Toggle
        label="Trails"
        checked={options.showTrails}
        onChange={(checked) => setRenderOption('showTrails', checked)}
      />
      <Toggle
        label="Grid"
        checked={options.showGrid}
        onChange={(checked) => setRenderOption('showGrid', checked)}
      />
      <Toggle
        label="Velocity arrows"
        checked={options.showVelocities}
        onChange={(checked) => setRenderOption('showVelocities', checked)}
      />
      <Toggle
        label="Predicted orbit"
        hint="The two-body orbit the selected body is currently on."
        checked={options.showPredictedOrbit}
        onChange={(checked) => setRenderOption('showPredictedOrbit', checked)}
      />
      <Toggle
        label="Glow"
        checked={options.bloom}
        onChange={(checked) => setRenderOption('bloom', checked)}
      />
    </div>
  );
}
