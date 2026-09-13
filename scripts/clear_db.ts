import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { DEFAULT_WEEKLY_AVAILABILITY } from '../src/db/schema.js';

async function clearDatabase() {
  console.log('🧹 Clearing all data from both Supabase Cloud and Local SQLite...');

  // 1. Supabase Cloud cleanup
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && serviceRoleKey) {
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    console.log('⚡ [Supabase] Connected. Deleting cloud records...');
    
    // Delete in reverse dependency order
    const tables = [
      'messages',
      'appointments',
      'pending_booking_workflows',
      'invoices',
      'admin_alerts',
      'conversations',
      'customers',
      'availability_overrides',
    ];

    for (const table of tables) {
      try {
        const { error } = await supabase.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000');
        if (error) {
          console.warn(`ℹ️ [Supabase] Table ${table}: ${error.message}`);
        } else {
          console.log(`✅ [Supabase] Cleared table: ${table}`);
        }
      } catch (err: any) {
        console.warn(`ℹ️ [Supabase] ${table}:`, err.message);
      }
    }
  }

  // 2. Local SQLite cleanup
  const dbPaths = [
    process.env.DATABASE_URL,
    'data/automation.sqlite',
    'local.db',
  ].filter(Boolean) as string[];

  const uniquePaths = Array.from(new Set(dbPaths));
  for (const dbPath of uniquePaths) {
    if (fs.existsSync(dbPath)) {
      console.log(`📂 [SQLite] Clearing local database at ${dbPath}...`);
      const sqlite = new DatabaseSync(dbPath);
      sqlite.exec('PRAGMA foreign_keys = OFF;');
      sqlite.exec('DELETE FROM messages;');
      sqlite.exec('DELETE FROM appointments;');
      try {
        sqlite.exec('DELETE FROM pending_booking_workflows;');
      } catch {}
      sqlite.exec('DELETE FROM invoices;');
      sqlite.exec('DELETE FROM admin_alerts;');
      sqlite.exec('DELETE FROM conversations;');
      sqlite.exec('DELETE FROM customers;');
      sqlite.exec('DELETE FROM availability_overrides;');
      
      // Reset availability rules to standard clinic defaults (Mon-Fri 9:00 - 17:00)
      sqlite.exec('DELETE FROM availability_rules;');
      const insertRule = sqlite.prepare(`
        INSERT INTO availability_rules (id, day_of_week, start_time, end_time, is_active)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const rule of DEFAULT_WEEKLY_AVAILABILITY) {
        insertRule.run(crypto.randomUUID(), rule.day_of_week, rule.start_time, rule.end_time, rule.is_active);
      }
      sqlite.exec('PRAGMA foreign_keys = ON;');
      sqlite.close();
      console.log(`✅ [SQLite] Local database at ${dbPath} cleared and reset successfully.`);
    }
  }

  console.log('\n🎉 ALL DATABASES CLEARED! Ready for fresh testing.');
}

clearDatabase().catch((err) => {
  console.error('❌ Failed to clear database:', err);
  process.exit(1);
});
