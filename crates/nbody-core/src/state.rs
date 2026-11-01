//! Simulation state, structure-of-arrays.
//!
//! Separate arrays per component rather than an array of structs, because the
//! force kernel sweeps one component at a time across all bodies and that is
//! the layout a vectorised inner loop needs.
//!
//! Slot indices are NOT stable: removals swap the last slot down, and merges
//! remove slots. Consumers identify bodies by `handles`, which is why the
//! frame buffer carries a handle block alongside the positions.

/// Per-body simulation state.
#[derive(Debug, Default, Clone)]
pub struct State {
    pub count: usize,

    pub x: Vec<f64>,
    pub y: Vec<f64>,
    pub z: Vec<f64>,

    pub vx: Vec<f64>,
    pub vy: Vec<f64>,
    pub vz: Vec<f64>,

    pub mass: Vec<f64>,
    pub radius: Vec<f64>,

    /// Non-zero marks a body as immovable. Forces act from it but not on it,
    /// which is how restricted problems are expressed without a second code
    /// path.
    pub locked: Vec<u8>,

    /// Stable identity per slot. Survives removals and merges.
    pub handles: Vec<u32>,
}

/// Accelerations, held separately from `State` so that a force model can read
/// the whole state while writing accelerations without borrow conflicts.
#[derive(Debug, Default, Clone)]
pub struct Accel {
    pub ax: Vec<f64>,
    pub ay: Vec<f64>,
    pub az: Vec<f64>,
}

impl Accel {
    pub fn with_capacity(capacity: usize) -> Self {
        Self {
            ax: vec![0.0; capacity],
            ay: vec![0.0; capacity],
            az: vec![0.0; capacity],
        }
    }

    pub fn resize(&mut self, capacity: usize) {
        self.ax.resize(capacity, 0.0);
        self.ay.resize(capacity, 0.0);
        self.az.resize(capacity, 0.0);
    }

    pub fn zero(&mut self, count: usize) {
        self.ax[..count].fill(0.0);
        self.ay[..count].fill(0.0);
        self.az[..count].fill(0.0);
    }
}

impl State {
    pub fn is_empty(&self) -> bool {
        self.count == 0
    }

    /// Grows every array to hold at least `capacity` bodies.
    pub fn resize(&mut self, capacity: usize) {
        self.x.resize(capacity, 0.0);
        self.y.resize(capacity, 0.0);
        self.z.resize(capacity, 0.0);
        self.vx.resize(capacity, 0.0);
        self.vy.resize(capacity, 0.0);
        self.vz.resize(capacity, 0.0);
        self.mass.resize(capacity, 0.0);
        self.radius.resize(capacity, 0.0);
        self.locked.resize(capacity, 0);
        self.handles.resize(capacity, 0);
    }

    pub fn total_mass(&self) -> f64 {
        self.mass[..self.count].iter().sum()
    }

    /// Removes slot `i` by swapping the last slot into it.
    ///
    /// O(1), and order carries no physical meaning. Callers iterating while
    /// removing must not advance past `i`, because an unexamined body has just
    /// been moved into it.
    pub fn swap_remove(&mut self, i: usize) {
        let last = self.count - 1;
        if i != last {
            self.x[i] = self.x[last];
            self.y[i] = self.y[last];
            self.z[i] = self.z[last];
            self.vx[i] = self.vx[last];
            self.vy[i] = self.vy[last];
            self.vz[i] = self.vz[last];
            self.mass[i] = self.mass[last];
            self.radius[i] = self.radius[last];
            self.locked[i] = self.locked[last];
            self.handles[i] = self.handles[last];
        }
        self.count = last;
    }
}
