import Database from 'node:sqlite';
import path from 'path';
import fs from 'fs';

const dbPath = path.resolve(process.cwd(), 'data/automation.sqlite');
if (fs.existsSync(dbPath)) {
  try {
    const db = new Database.DatabaseSync(dbPath);
    db.prepare('DELETE FROM messages').run();
    db.prepare('DELETE FROM appointments').run();
    db.prepare('DELETE FROM availability_overrides').run();
    db.prepare('DELETE FROM availability_rules').run();
    db.prepare('DELETE FROM admin_alerts').run();
    db.prepare('DELETE FROM conversations').run();
    db.prepare('DELETE FROM customers').run();
    db.close();
    console.log('✅ [SQLite] Cleaned all tables inside data/automation.sqlite');
  } catch (e) {
    console.log('Note:', e.message);
  }
}
