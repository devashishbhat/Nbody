import { LogSlider } from '@nbody/ui';
import {
  useStore,
  editSetting,
  stepOnce,
  toggleReverse,
  togglePlay,
  resetScenario,
} from '../store.ts';
import type { Readouts } from '../readouts.ts';

const MIN_TIME_SCALE = 1e-3;
const MAX_TIME_SCALE = 1e6;

/**
 * Play, step, reverse, speed and the clock.
 *
 * Time scale is a log slider for the same reason mass is: it spans nine orders
 * of magnitude across the presets, from a three-body orbit that wants to be
 * watched in real time to a solar system that needs forty days a second before
 * anything appears to happen.
 */
export function TransportBar({ readouts }: { readouts: Readouts }) {
  const playing = useStore((state) => state.playing);
  const reversed = useStore((state) => state.reversed);
  const timeScale = useStore((state) => state.scenario.timeScale);

  return (
    <section className="nb-panel nb-bottom-center" aria-label="Playback">
      <button
        className="nb-button nb-button--primary"
        onClick={togglePlay}
        aria-keyshortcuts="Space"
        title={playing ? 'Pause (space)' : 'Play (space)'}
      >
        {playing ? 'Pause' : 'Play'}
      </button>
      <button className="nb-button" onClick={() => stepOnce(1)} title="Single step (right arrow)">
        Step
      </button>
      <button
        className={reversed ? 'nb-button nb-button--active' : 'nb-button'}
        onClick={toggleReverse}
        title="Reverse time. Exact under the symplectic integrators."
      >
        Reverse
      </button>
      <button className="nb-button" onClick={resetScenario} title="Reset to the start (R)">
        Reset
      </button>

      <div className="nb-transport-speed">
        <LogSlider
          label="Speed"
          value={timeScale}
          min={MIN_TIME_SCALE}
          max={MAX_TIME_SCALE}
          onChange={(value) => editSetting('timeScale', value, 'drag')}
          format={(value) => `${value.toPrecision(3)} /s`}
        />
      </div>

      <span className="nb-num nb-clock">
        <span ref={readouts.clock.attach}>0</span>
      </span>
    </section>
  );
}
