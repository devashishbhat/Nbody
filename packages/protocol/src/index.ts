/**
 * @nbody/protocol
 *
 * The frozen contract every other package depends on, and the only package
 * they are allowed to share. Nothing here may import from another @nbody
 * package.
 *
 * Changing anything in this package is a protocol change: it needs a note in
 * docs/CONTRACTS.md and affects every lane. See docs/AGENTS.md.
 */
export * from './units.ts';
export * from './scenario.ts';
export * from './frame.ts';
export * from './messages.ts';
export * from './engine.ts';
export * from './schema.ts';
export * from './define.ts';
