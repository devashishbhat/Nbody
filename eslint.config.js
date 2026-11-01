import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/pkg/**',
      '**/target/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/playwright-report/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // The numeric layers pass pre-allocated scratch buffers by reference on
      // purpose; flagging every unused binding prefix is noise.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Hot loops are allowed to be explicit about non-null invariants that
      // the protocol layer already guarantees.
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    // The frame loop must not allocate. These rules make accidental
    // allocation in a hot path visible at review time.
    files: ['packages/renderer/src/**/*.ts', 'packages/engine/src/**/*.ts'],
    rules: {
      'prefer-const': 'error',
      'no-new-object': 'error',
    },
  },
);
