import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/supabase_live.test.ts'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 20000,
  },
});
