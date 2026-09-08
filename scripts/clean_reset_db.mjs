import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hzayinbtatjrykvwxprg.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function resetAll() {
  console.log('🧹 [Reset] Starting full database wipe and clean reset...\n');

  // 1. Delete local SQLite database files
  const localDbs = [
    'data/practice.db',
    'data/automation.sqlite',
    'sqlite.db',
  ];

  for (const dbPath of localDbs) {
    const fullPath = path.resolve(process.cwd(), dbPath);
    if (fs.existsSync(fullPath)) {
      try {
        fs.unlinkSync(fullPath);
        console.log(`✅ [Local SQLite] Deleted local DB file: ${dbPath}`);
      } catch (err) {
        console.warn(`⚠️ [Local SQLite] Could not delete ${dbPath}:`, err.message);
      }
    }
  }

  // 2. Wipe Supabase Cloud Tables
  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    console.log('\n⚡ [Supabase Cloud] Connected to:', SUPABASE_URL);

    // Delete in reverse foreign-key order
    const tables = [
      'messages',
      'invoices',
      'appointments',
      'availability_overrides',
      'availability_rules',
      'conversations',
      'customers',
    ];

    for (const table of tables) {
      try {
        const { error } = await supabase.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000');
        if (error) {
          // If neq filter failed, try matching all rows
          const { error: err2 } = await supabase.from(table).delete().gte('created_at', '1970-01-01');
          if (err2) {
            console.warn(`⚠️ [Supabase Cloud] Failed to delete table ${table}:`, err2.message);
          } else {
            console.log(`✅ [Supabase Cloud] Wiped table: ${table}`);
          }
        } else {
          console.log(`✅ [Supabase Cloud] Wiped table: ${table}`);
        }
      } catch (err) {
        console.warn(`⚠️ [Supabase Cloud] Error wiping ${table}:`, err.message);
      }
    }

    // 3. Re-seed default weekly availability template (Mon-Fri 09:00 - 17:00, Sat-Sun Closed)
    console.log('\n🌱 [Supabase Cloud] Seeding clean availability rules...');
    const defaultRules = [
      { day_of_week: 1, start_time: '09:00', end_time: '17:00', is_active: true, shifts: [{ start_time: '09:00', end_time: '17:00' }] },
      { day_of_week: 2, start_time: '09:00', end_time: '17:00', is_active: true, shifts: [{ start_time: '09:00', end_time: '17:00' }] },
      { day_of_week: 3, start_time: '09:00', end_time: '17:00', is_active: true, shifts: [{ start_time: '09:00', end_time: '17:00' }] },
      { day_of_week: 4, start_time: '09:00', end_time: '17:00', is_active: true, shifts: [{ start_time: '09:00', end_time: '17:00' }] },
      { day_of_week: 5, start_time: '09:00', end_time: '17:00', is_active: true, shifts: [{ start_time: '09:00', end_time: '17:00' }] },
      { day_of_week: 6, start_time: '09:00', end_time: '17:00', is_active: false, shifts: [] },
      { day_of_week: 0, start_time: '09:00', end_time: '17:00', is_active: false, shifts: [] },
    ];

    for (const rule of defaultRules) {
      await supabase.from('availability_rules').upsert(rule, { onConflict: 'day_of_week' });
    }
    console.log('✅ [Supabase Cloud] Clean weekly availability rules seeded (Mon-Fri 09:00 - 17:00, Weekends Closed).');
  }

  console.log('\n✨ Database is completely wiped clean and initialized from scratch!');
}

resetAll().catch((err) => {
  console.error('❌ Error during reset:', err);
  process.exit(1);
});
