import {it,expect} from 'vitest';import {createDatabaseContext} from '../src/db/index.js';
import {SettingsRepository} from '../src/db/repositories/settings.repo.js';
it('encrypts refresh tokens at rest and rejects a missing or wrong decryption key',()=>{
 const d=createDatabaseContext(':memory:',{encryptionKey:'11'.repeat(32)});d.settings.set('google_calendar_refresh_token','private-token-sentinel');
 const raw=(d.appDb.db.prepare("SELECT value FROM settings WHERE key='google_calendar_refresh_token'").get() as any).value;expect(raw).not.toContain('private-token-sentinel');expect(d.settings.get('google_calendar_refresh_token')).toBe('private-token-sentinel');
 expect(()=>new SettingsRepository(d.appDb.db).get('google_calendar_refresh_token')).toThrow(/key/);
 expect(()=>new SettingsRepository(d.appDb.db,true,'22'.repeat(32)).get('google_calendar_refresh_token')).toThrow();
});
