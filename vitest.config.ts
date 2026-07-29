import { defineConfig } from 'vitest/config';

// Domain logic is pure TS and runs under plain Node, no Workers runtime needed.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
});
