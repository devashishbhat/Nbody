import {
  cloneScenario,
  type Body,
  type BodyPatch,
  type EngineClient,
  type Scenario,
  type ScenarioSettings,
  type Vec3,
} from '@nbody/protocol';
import { DEFAULT_RENDER_OPTIONS, type CameraMode, type RenderOptions } from '@nbody/renderer';
import { buildHash, matchesPreset, tooLargeToShare, getPreset } from '@nbody/scenarios';
import { create } from 'zustand';

/**
 * Application state.
 *
 * Two things are kept apart on purpose.
 *
 * The SCENARIO is the document: the system as it stands at t = 0, with
 * whatever property edits have been made to it. Reset reloads it.
 *
 * The LIVE STATE lives in the worker and is never mirrored here. Positions
 * change sixty times a second, and copying them into a store would re-render
 * the interface at frame rate, which is the one thing the architecture exists
 * to avoid. Anything that needs live values reads them from the frame sample
 * inside the render loop.
 *
 * Consequently: editing a body's mass changes both the document and the live
 * state, because the mass is part of what the system IS. Dragging a body to a
 * new position changes only the live state, because a position is where the
 * system HAS GOT TO. Reset therefore restores the starting arrangement while
 * keeping the masses you chose, which is what "put them back" means when
 * someone has just made Jupiter a thousand times heavier.
 */

/**
 * A reversible edit.
 *
 * Edits are recorded as commands rather than as scenario snapshots. A snapshot
 * stack would have to capture the live state to be meaningful, which means
 * copying every position on every edit, and undoing would then also rewind
 * time. Commands touch only what was actually changed.
 */
export interface EditCommand {
  label: string;
  apply: (client: EngineClient) => void;
  revert: (client: EngineClient) => void;
  /** Applied to the document as well, when the edit is part of its definition. */
  document?: {
    apply: (scenario: Scenario) => Scenario;
    revert: (scenario: Scenario) => Scenario;
  };
  /** Consecutive edits sharing a key merge, so a slider drag is one undo. */
  mergeKey?: string;
}

export type StatusTone = 'info' | 'warn' | 'error';

export interface Status {
  text: string;
  tone: StatusTone;
}

export interface AppState {
  scenario: Scenario;
  presetId: string | null;

  /**
   * Incremented only when a scenario is LOADED, never when one is edited.
   *
   * Editing a mass replaces the scenario object, so object identity cannot
   * tell a load from an edit, and the renderer needs to know the difference:
   * a load should frame the camera and clear the trails, an edit must leave
   * both alone.
   */
  loadToken: number;

  /**
   * Incremented when the simulation is restarted from its document.
   *
   * Distinct from loadToken: a reset puts the bodies back without reframing
   * the camera, because the view someone has arranged is theirs to keep. What
   * it must discard is the trail history, which describes a timeline that no
   * longer happened.
   */
  resetToken: number;

  /**
   * The selected body, held as both a handle and an id.
   *
   * The handle is what the renderer and the frame data speak, and it survives
   * bodies being removed or merged. The id is what the document and every edit
   * speak. Keeping both avoids a lookup on every render of the inspector and
   * makes a selection that outlives its body detectable rather than silently
   * wrong.
   */
  selectedHandle: number;
  selectedBodyId: string | null;
  playing: boolean;
  reversed: boolean;

  options: RenderOptions;

  /**
   * Mirror of the renderer's camera mode.
   *
   * The camera belongs to the renderer, which is not reactive, but the
   * interface has to show which mode is active. The render loop pushes the
   * value here when it changes, which is rare, and changes made here are
   * routed back through the view handle.
   */
  cameraMode: CameraMode;
  inspectorOpen: boolean;
  paletteOpen: boolean;
  helpOpen: boolean;

  status: Status | null;
  past: EditCommand[];
  future: EditCommand[];

  /**
   * Position and velocity of the selected body, refreshed a few times a
   * second.
   *
   * The inspector has to show live values in editable fields, which rules out
   * the LiveText path used for read-only readouts. Sampling at a handful of
   * hertz keeps the numbers current without putting React anywhere near the
   * frame loop: five re-renders a second of one small panel is nothing, sixty
   * re-renders a second of it would not be.
   */
  liveSelected: { position: Vec3; velocity: Vec3 } | null;
}

/** How often the inspector's editable live fields refresh. */
export const LIVE_SAMPLE_HZ = 5;

/** Undo depth. Deep enough to be useful, bounded so it cannot grow forever. */
const HISTORY_LIMIT = 200;

export interface ViewHandles {
  setCameraMode: (mode: CameraMode) => void;
  toggleFollow: () => void;
  isFollowing: () => boolean;
}

let client: EngineClient | null = null;
let view: ViewHandles | null = null;

/** Called once by the render loop, which owns the renderer's lifetime. */
export function attachView(next: ViewHandles | null): void {
  view = next;
}

/** Called once by the render loop, which owns the worker's lifetime. */
export function attachEngine(next: EngineClient | null): void {
  client = next;
}

export function getEngine(): EngineClient | null {
  return client;
}

function withBody(scenario: Scenario, id: string, patch: BodyPatch): Scenario {
  return {
    ...scenario,
    bodies: scenario.bodies.map((body) => (body.id === id ? { ...body, ...patch } : body)),
  };
}

export const useStore = create<AppState>(() => ({
  scenario: undefined as unknown as Scenario,
  presetId: null,
  loadToken: 0,
  resetToken: 0,
  selectedHandle: 0,
  selectedBodyId: null,
  playing: true,
  reversed: false,
  options: { ...DEFAULT_RENDER_OPTIONS },
  cameraMode: '2d',
  // Closed on a narrow screen: there it is a sheet over the simulation rather
  // than a column beside it, so opening by default would hide the thing the
  // page is for.
  inspectorOpen:
    typeof window === 'undefined' ? true : window.matchMedia('(width > 720px)').matches,
  paletteOpen: false,
  helpOpen: false,
  status: null,
  past: [],
  future: [],
  liveSelected: null,
}));

const set = useStore.setState;
const get = useStore.getState;

export function setLiveSelected(value: { position: Vec3; velocity: Vec3 } | null): void {
  set({ liveSelected: value });
}

export function setStatus(text: string, tone: StatusTone = 'info'): void {
  set({ status: { text, tone } });
}

export function clearStatus(): void {
  set({ status: null });
}

export function loadScenario(scenario: Scenario, presetId: string | null): void {
  const copy = cloneScenario(scenario);
  set({
    scenario: copy,
    presetId,
    loadToken: get().loadToken + 1,
    selectedHandle: 0,
    selectedBodyId: null,
    playing: true,
    reversed: copy.dt < 0,
    past: [],
    future: [],
    status: null,
  });
  client?.load(copy);
  client?.play();
}

/** Reloads the document, restoring the starting arrangement. */
export function resetScenario(): void {
  const { scenario } = get();
  client?.load(scenario);
  if (get().playing) client?.play();
  else client?.pause();
  set({ resetToken: get().resetToken + 1 });
}

export function selectHandle(handle: number, bodyId: string | null): void {
  // On a narrow screen the inspector is a sheet, so selecting a body is also
  // the request to see it.
  const openSheet =
    handle !== 0 && typeof window !== 'undefined' && !window.matchMedia('(width > 720px)').matches;

  set({
    ...(openSheet ? { inspectorOpen: true } : {}),
    selectedHandle: handle,
    selectedBodyId: bodyId,
    options: { ...get().options, selectedHandle: handle },
    liveSelected: handle === 0 ? null : get().liveSelected,
  });
}

export function clearSelection(): void {
  selectHandle(0, null);
}

export function togglePlay(): void {
  const playing = !get().playing;
  set({ playing });
  if (playing) client?.play();
  else client?.pause();
}

export function stepOnce(steps = 1): void {
  if (get().playing) {
    set({ playing: false });
    client?.pause();
  }
  client?.stepOnce(steps);
}

/**
 * Flips the direction of time.
 *
 * Free, and exact, because both symplectic integrators are time-symmetric:
 * negating dt retraces the trajectory rather than approximating it. Under the
 * adaptive integrator it is still useful but no longer exact.
 */
export function toggleReverse(): void {
  const { scenario } = get();
  const dt = -scenario.dt;
  set({ scenario: { ...scenario, dt }, reversed: dt < 0 });
  client?.setDt(dt);
}

export function setCameraMode(mode: CameraMode): void {
  view?.setCameraMode(mode);
  set({ cameraMode: mode });
}

export function toggleCameraMode(): void {
  setCameraMode(get().cameraMode === '2d' ? '3d' : '2d');
}

/** Called by the render loop when the renderer changed the mode itself. */
export function syncCameraMode(mode: CameraMode): void {
  if (get().cameraMode !== mode) set({ cameraMode: mode });
}

export function toggleFollow(): void {
  view?.toggleFollow();
}

export function setRenderOption<K extends keyof RenderOptions>(
  key: K,
  value: RenderOptions[K],
): void {
  set({ options: { ...get().options, [key]: value } });
}

export function setInspectorOpen(open: boolean): void {
  set({ inspectorOpen: open });
}

export function setPaletteOpen(open: boolean): void {
  set({ paletteOpen: open });
}

export function setHelpOpen(open: boolean): void {
  set({ helpOpen: open });
}

/** Records and applies an edit. */
export function runCommand(command: EditCommand): void {
  if (!client) return;
  command.apply(client);

  const state = get();
  let scenario = state.scenario;
  if (command.document) scenario = command.document.apply(scenario);

  const previous = state.past[state.past.length - 1];
  const merge =
    command.mergeKey !== undefined && previous?.mergeKey === command.mergeKey ? previous : null;

  let past: EditCommand[];
  if (merge) {
    // A slider drag emits an edit per frame. Merging by key keeps the whole
    // drag as one undo step, with the original value as the thing to revert
    // to, which is what a user means by "undo that change".
    const merged: EditCommand = {
      ...command,
      revert: merge.revert,
      ...(command.document && merge.document
        ? { document: { apply: command.document.apply, revert: merge.document.revert } }
        : {}),
    };
    past = [...state.past.slice(0, -1), merged];
  } else {
    past = [...state.past, command].slice(-HISTORY_LIMIT);
  }

  set({ past, future: [], scenario });
}

export function undo(): void {
  const state = get();
  const command = state.past[state.past.length - 1];
  if (!command || !client) return;
  command.revert(client);
  set({
    past: state.past.slice(0, -1),
    future: [...state.future, command],
    scenario: command.document ? command.document.revert(state.scenario) : state.scenario,
  });
  setStatus(`Undid ${command.label}`);
}

export function redo(): void {
  const state = get();
  const command = state.future[state.future.length - 1];
  if (!command || !client) return;
  command.apply(client);
  set({
    future: state.future.slice(0, -1),
    past: [...state.past, command],
    scenario: command.document ? command.document.apply(state.scenario) : state.scenario,
  });
  setStatus(`Redid ${command.label}`);
}

/**
 * Edits a property that is part of what the system is.
 *
 * Applied to the live simulation and to the document, so a reset keeps it.
 */
export function editBodyProperty(
  id: string,
  patch: BodyPatch,
  label: string,
  mergeKey?: string,
): void {
  const body = get().scenario.bodies.find((candidate) => candidate.id === id);
  if (!body) return;

  const previous: BodyPatch = {};
  for (const key of Object.keys(patch) as (keyof BodyPatch)[]) {
    (previous as Record<string, unknown>)[key] = body[key];
  }

  runCommand({
    label,
    ...(mergeKey ? { mergeKey: `${mergeKey}:${id}` } : {}),
    apply: (engine) => engine.patchBody(id, patch),
    revert: (engine) => engine.patchBody(id, previous),
    document: {
      apply: (scenario) => withBody(scenario, id, patch),
      revert: (scenario) => withBody(scenario, id, previous),
    },
  });
}

/**
 * Edits where a body has got to, which is live state rather than definition.
 *
 * Deliberately not written to the document: a reset should put the system back
 * where it started, not where it was dragged to.
 */
export function editBodyState(
  id: string,
  patch: { position?: Vec3; velocity?: Vec3 },
  previous: { position?: Vec3; velocity?: Vec3 },
  label: string,
  mergeKey?: string,
): void {
  runCommand({
    label,
    ...(mergeKey ? { mergeKey: `${mergeKey}:${id}` } : {}),
    apply: (engine) => engine.patchBody(id, patch),
    revert: (engine) => engine.patchBody(id, previous),
  });
}

export function addBody(body: Body): void {
  runCommand({
    label: `add ${body.name}`,
    apply: (engine) => engine.addBody(body),
    revert: (engine) => engine.removeBody(body.id),
    document: {
      apply: (scenario) => ({ ...scenario, bodies: [...scenario.bodies, body] }),
      revert: (scenario) => ({
        ...scenario,
        bodies: scenario.bodies.filter((candidate) => candidate.id !== body.id),
      }),
    },
  });
}

export function removeBody(id: string): void {
  const state = get();
  const index = state.scenario.bodies.findIndex((body) => body.id === id);
  if (index < 0) return;
  const body = state.scenario.bodies[index]!;

  if (state.selectedBodyId === id) clearSelection();

  runCommand({
    label: `remove ${body.name}`,
    apply: (engine) => engine.removeBody(id),
    revert: (engine) => engine.addBody(body),
    document: {
      apply: (scenario) => ({
        ...scenario,
        bodies: scenario.bodies.filter((candidate) => candidate.id !== id),
      }),
      revert: (scenario) => {
        const bodies = [...scenario.bodies];
        bodies.splice(index, 0, body);
        return { ...scenario, bodies };
      },
    },
  });
}

type SettingKey = keyof ScenarioSettings;

const SETTING_SENDERS: {
  [K in SettingKey]: (engine: EngineClient, value: ScenarioSettings[K]) => void;
} = {
  G: (engine, value) => engine.setG(value),
  softening: (engine, value) => engine.setSoftening(value),
  integrator: (engine, value) => engine.setIntegrator(value),
  dt: (engine, value) => engine.setDt(value),
  forceModel: (engine, value) => engine.setForceModel(value),
  theta: (engine, value) => engine.setTheta(value),
  collisions: (engine, value) => engine.setCollisions(value),
  timeScale: (engine, value) => engine.setTimeScale(value),
};

export function editSetting<K extends SettingKey>(
  key: K,
  value: ScenarioSettings[K],
  mergeKey?: string,
): void {
  const previous = get().scenario[key];
  if (previous === value) return;

  const send = SETTING_SENDERS[key];
  runCommand({
    label: `change ${key}`,
    ...(mergeKey ? { mergeKey: `setting:${key}` } : {}),
    apply: (engine) => send(engine, value),
    revert: (engine) => send(engine, previous),
    document: {
      apply: (scenario) => ({ ...scenario, [key]: value }),
      revert: (scenario) => ({ ...scenario, [key]: previous }),
    },
  });

  if (key === 'dt') set({ reversed: (value as number) < 0 });
}

/**
 * Builds a share link for what is on screen right now.
 *
 * Snapshots the live state rather than the document, because the thing worth
 * sharing is the view someone is looking at, not the arrangement it started
 * from.
 */
export async function buildShareLink(): Promise<string> {
  const state = get();
  const engine = client;
  if (!engine) throw new Error('the simulation is not running');

  const live = await engine.snapshot();
  const preset = state.presetId ? getPreset(state.presetId) : undefined;

  // An untouched preset shares as its id: shorter, readable, and it picks up
  // any later improvement to the preset.
  const unmodified = preset && matchesPreset(live, preset) ? state.presetId! : undefined;

  if (!unmodified && tooLargeToShare(live)) {
    throw new Error('this system has too many bodies to fit in a link');
  }

  const url = new URL(window.location.href);
  url.hash = buildHash(live, unmodified);
  return url.toString();
}

/** The live state as a downloadable file, for systems too large to link. */
export async function buildScenarioFile(): Promise<Blob> {
  const engine = client;
  if (!engine) throw new Error('the simulation is not running');
  const live = await engine.snapshot();
  return new Blob([JSON.stringify(live, null, 2)], { type: 'application/json' });
}
