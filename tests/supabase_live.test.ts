import { describe, it, expect, beforeAll } from 'vitest';
import { getSupabaseClient, SupabaseSync } from '../src/db/supabase.js';
import { createDatabaseContext, DatabaseContext } from '../src/db/index.js';
import crypto from 'node:crypto';

describe('⚡ SUPABASE LIVE CLOUD INTEGRATION SUITE', () => {
  let supabase = getSupabaseClient();
  let db: DatabaseContext;

  beforeAll(() => {
    supabase = getSupabaseClient();
    db = createDatabaseContext(':memory:');
  });

  it('1. Connects successfully to live Supabase cloud instance', async () => {
    expect(supabase).not.toBeNull();
    if (!supabase) return;

    const { error } = await supabase.from('availability_rules').select('count', { count: 'exact', head: true });
    expect(error).toBeNull();
  });

  it('2. Inserts and syncs customer with live Supabase cloud', async () => {
    if (!supabase) return;

    const randSuffix = Math.floor(100000 + Math.random() * 900000);
    const testPhone = 'whatsapp:+96170' + randSuffix;
    const cust = db.customers.findOrCreate(testPhone, 'Live Test User');
    expect(cust).toBeDefined();

    // Sync to Supabase
    await SupabaseSync.syncCustomer(cust);

    // Query live from Supabase
    const { data, error } = await supabase
      .from('customers')
      .select('*')
      .eq('id', cust.id)
      .single();

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data.phone).toBe(testPhone);
    expect(data.name).toBe('Live Test User');
  });

  it('3. Syncs availability rules and handles day_of_week upsert conflict safely', async () => {
    if (!supabase) return;

    const testRule = {
      id: crypto.randomUUID(),
      day_of_week: 1, // Monday
      start_time: '09:00',
      end_time: '17:00',
      is_active: true,
      shifts: [{ start_time: '09:00', end_time: '17:00' }],
    };

    // Upsert to Supabase
    await SupabaseSync.syncAvailabilityRule(testRule);

    const { data, error } = await supabase
      .from('availability_rules')
      .select('*')
      .eq('day_of_week', 1)
      .single();

    expect(error).toBeNull();
    expect(Boolean(data.is_active)).toBe(true);
    expect(data.start_time).toBe('09:00');
  });

  it('4. Inserts appointment and syncs to Supabase cloud table', async () => {
    if (!supabase) return;

    const randSuffix = Math.floor(100000 + Math.random() * 900000);
    const testPhone = 'whatsapp:+96171' + randSuffix;
    const cust = db.customers.findOrCreate(testPhone, 'Dr Appointment Test');
    await SupabaseSync.syncCustomer(cust);

    const appt = db.appointments.create({
      customer_id: cust.id,
      start_time: '2026-09-22T10:00:00.000Z',
      end_time: '2026-09-22T11:00:00.000Z',
      visit_type: 'in_office',
      service: 'General Consultation',
      price: 120,
      status: 'booked',
    });

    await SupabaseSync.syncAppointment(appt);

    const { data, error } = await supabase
      .from('appointments')
      .select('*')
      .eq('id', appt.id)
      .single();

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data.service).toBe('General Consultation');
    expect(data.status).toBe('booked');
    expect(Number(data.price)).toBe(120);
  });

  it('5. Creates and syncs availability override (holiday / blockout) to Supabase', async () => {
    if (!supabase) return;

    const testOverride = {
      id: crypto.randomUUID(),
      date: '2026-10-15',
      is_unavailable: true,
      reason: 'Doctor Medical Conference',
    };

    await SupabaseSync.syncOverride(testOverride);

    const { data, error } = await supabase
      .from('availability_overrides')
      .select('*')
      .eq('date', '2026-10-15')
      .single();

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data.reason).toBe('Doctor Medical Conference');
    expect(Boolean(data.is_unavailable)).toBe(true);

    // Clean up
    await SupabaseSync.deleteOverride(data.id);
  });

  it('6. Hydrates fresh in-memory database completely from Supabase cloud', async () => {
    if (!supabase) return;

    const freshDb = createDatabaseContext(':memory:');
    await SupabaseSync.hydrateFromSupabase(freshDb);

    const rules = freshDb.availability.getAllRules();
    expect(rules.length).toBeGreaterThan(0);
  });
});
