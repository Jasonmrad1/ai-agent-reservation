import { describe, it, expect } from 'vitest';
import { config } from '../src/config/index.js';

describe('offline test isolation', () => {
  it('does not load live provider credentials into ordinary tests', () => {
    expect(Boolean(config.supabaseUrl || config.supabaseServiceRoleKey)).toBe(false);
    expect(Boolean(config.twilioAccountSid || config.twilioAuthToken)).toBe(false);
    expect(Boolean(config.geminiApiKey || config.googleCalendarClientSecret)).toBe(false);
  });
});
