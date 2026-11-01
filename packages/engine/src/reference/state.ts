import { cloneScenario, type Body, type Scenario, type Vec3 } from '@nbody/protocol';

/**
 * Structure-of-arrays simulation state for the reference engine.
 *
 * The reference engine exists for two reasons: it unblocks the renderer and UI
 * lanes before the Rust engine lands, and it stays forever as the parity
 * oracle that the WASM engine is tested against. It is written for clarity
 * first, but it still uses the same SoA layout and the same allocation-free
 * stepping discipline as the Rust core, because a reference that cannot be
 * compared like-for-like is not much of a reference.
 */
export class RefState {
  count = 0;
  capacity = 0;

  x = new Float64Array(0);
  y = new Float64Array(0);
  z = new Float64Array(0);
  vx = new Float64Array(0);
  vy = new Float64Array(0);
  vz = new Float64Array(0);
  mass = new Float64Array(0);
  radius = new Float64Array(0);

  /** Accelerations for the current positions. Kept valid between steps so
   *  that leapfrog needs only one force evaluation per step. */
  ax = new Float64Array(0);
  ay = new Float64Array(0);
  az = new Float64Array(0);

  /** 1 when a body is immovable. Forces act from it but not on it. */
  locked = new Uint8Array(0);

  /** Stable handle per slot. Survives merges and removals. */
  handles = new Uint32Array(0);

  /** Presentation data, parallel to the numeric arrays. */
  ids: string[] = [];
  names: string[] = [];
  colors: string[] = [];
  trails: boolean[] = [];

  private slotById = new Map<string, number>();
  private nextHandle = 1;

  reserve(capacity: number): void {
    if (capacity <= this.capacity) return;
    const next = Math.max(capacity, 64, this.capacity * 2);
    const grow = (old: Float64Array) => {
      const a = new Float64Array(next);
      a.set(old);
      return a;
    };
    this.x = grow(this.x);
    this.y = grow(this.y);
    this.z = grow(this.z);
    this.vx = grow(this.vx);
    this.vy = grow(this.vy);
    this.vz = grow(this.vz);
    this.mass = grow(this.mass);
    this.radius = grow(this.radius);
    this.ax = grow(this.ax);
    this.ay = grow(this.ay);
    this.az = grow(this.az);

    const locked = new Uint8Array(next);
    locked.set(this.locked);
    this.locked = locked;

    const handles = new Uint32Array(next);
    handles.set(this.handles);
    this.handles = handles;

    this.capacity = next;
  }

  loadFrom(scenario: Scenario): void {
    this.count = 0;
    this.ids.length = 0;
    this.names.length = 0;
    this.colors.length = 0;
    this.trails.length = 0;
    this.slotById.clear();
    this.nextHandle = 1;
    this.reserve(scenario.bodies.length);
    for (const body of scenario.bodies) this.push(body);
  }

  push(body: Body): number {
    this.reserve(this.count + 1);
    const i = this.count++;
    this.x[i] = body.position[0];
    this.y[i] = body.position[1];
    this.z[i] = body.position[2];
    this.vx[i] = body.velocity[0];
    this.vy[i] = body.velocity[1];
    this.vz[i] = body.velocity[2];
    this.mass[i] = body.mass;
    this.radius[i] = body.radius;
    this.ax[i] = 0;
    this.ay[i] = 0;
    this.az[i] = 0;
    this.locked[i] = body.locked ? 1 : 0;
    this.handles[i] = this.nextHandle++;
    this.ids[i] = body.id;
    this.names[i] = body.name;
    this.colors[i] = body.color;
    this.trails[i] = body.trail ?? false;
    this.slotById.set(body.id, i);
    return i;
  }

  /**
   * Removes a slot by swapping the last slot into it.
   *
   * Order is not meaningful to the physics, and swap-removal keeps this O(1).
   * Consumers must treat slot indices as unstable and use handles instead,
   * which is exactly why the frame carries a handle block.
   */
  removeAt(i: number): void {
    const last = this.count - 1;
    if (i !== last) {
      this.x[i] = this.x[last];
      this.y[i] = this.y[last];
      this.z[i] = this.z[last];
      this.vx[i] = this.vx[last];
      this.vy[i] = this.vy[last];
      this.vz[i] = this.vz[last];
      this.mass[i] = this.mass[last];
      this.radius[i] = this.radius[last];
      this.ax[i] = this.ax[last];
      this.ay[i] = this.ay[last];
      this.az[i] = this.az[last];
      this.locked[i] = this.locked[last];
      this.handles[i] = this.handles[last];
      this.ids[i] = this.ids[last]!;
      this.names[i] = this.names[last]!;
      this.colors[i] = this.colors[last]!;
      this.trails[i] = this.trails[last]!;
    }
    this.count = last;
    this.ids.length = last;
    this.names.length = last;
    this.colors.length = last;
    this.trails.length = last;
    this.reindex();
  }

  private reindex(): void {
    this.slotById.clear();
    for (let i = 0; i < this.count; i++) this.slotById.set(this.ids[i]!, i);
  }

  slotOf(id: string): number {
    const slot = this.slotById.get(id);
    return slot === undefined ? -1 : slot;
  }

  totalMass(): number {
    let m = 0;
    for (let i = 0; i < this.count; i++) m += this.mass[i];
    return m;
  }

  /** Rebuilds a Scenario from the live state, for sharing and download. */
  toScenario(template: Scenario): Scenario {
    const scenario = cloneScenario(template);
    const bodies: Body[] = new Array(this.count);
    for (let i = 0; i < this.count; i++) {
      const body: Body = {
        id: this.ids[i]!,
        name: this.names[i]!,
        mass: this.mass[i],
        radius: this.radius[i],
        position: [this.x[i], this.y[i], this.z[i]] as Vec3,
        velocity: [this.vx[i], this.vy[i], this.vz[i]] as Vec3,
        color: this.colors[i]!,
      };
      if (this.locked[i]) body.locked = true;
      if (this.trails[i]) body.trail = true;
      bodies[i] = body;
    }
    scenario.bodies = bodies;
    return scenario;
  }
}
