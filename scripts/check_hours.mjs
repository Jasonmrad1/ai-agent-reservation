import { createClient } from '@supabase/supabase-js';
import Database from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hzayinbtatjrykvwxprg.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function check() {
  console.log('🔍 [DB Query] Checking working hours and availability in DB...\n');

  // 1. Check Supabase
  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: rules, error: rErr } = await supabase.from('availability_rules').select('*').order('day_of_week');
    const { data: overrides, error: oErr } = await supabase.from('availability_overrides').select('*');
    const { data: appts, error: aErr } = await supabase.from('appointments').select('*');

    console.log('⚡ [Supabase Cloud] availability_rules:');
    console.log(JSON.stringify(rules, null, 2));

    console.log('\n⚡ [Supabase Cloud] availability_overrides:');
    console.log(JSON.stringify(overrides, null, 2));

    console.log('\n⚡ [Supabase Cloud] appointments:');
    console.log(JSON.stringify(appts, null, 2));
  }

  // 2. Check local SQLite
  const dbPath = path.resolve(process.cwd(), 'data/automation.sqlite');
  if (fs.existsSync(dbPath)) {
    console.log('\n📁 [Local SQLite] data/automation.sqlite:');
    const db = new Database.DatabaseSync(dbPath);
    const rules = db.prepare('SELECT * FROM availability_rules').all();
    const overrides = db.prepare('SELECT * FROM availability_overrides').all();
    const appts = db.prepare('SELECT * FROM appointments').all();
    console.log('Rules:', JSON.stringify(rules, null, 2));
    console.log('Overrides:', JSON.stringify(overrides, null, 2));
    console.log('Appointments:', JSON.stringify(appts, null, 2));
    db.close();
  }
}

check().catch(console.error);
