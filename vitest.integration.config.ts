import { defineConfig } from 'vitest/config';

if (process.env.ALLOW_LIVE_TESTS !== 'true' ||
    !process.env.TEST_SUPABASE_URL || !process.env.TEST_SUPABASE_SERVICE_ROLE_KEY ||
    process.env.TEST_SUPABASE_URL === process.env.SUPABASE_URL) {
  throw new Error('Live tests require ALLOW_LIVE_TESTS=true and a separate TEST_SUPABASE project.');
}
process.env.SUPABASE_URL = process.env.TEST_SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
export default defineConfig({ test: {
  environment: 'node', include: ['tests/supabase_live.test.ts'], testTimeout: 20000,
} });
