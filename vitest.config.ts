import { defineConfig } from 'vitest/config';

// Domain logic is pure TS and runs under plain Node, no Workers runtime needed.
export default defineConfig({
  test: {
    // Node 22.12 (our supported minimum) still gates the real-SQL test adapter.
    execArgv: ['--experimental-sqlite'],
    include: ['test/**/*.test.ts'],
  },
});
