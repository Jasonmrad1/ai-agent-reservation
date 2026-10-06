import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';

export class SettingsRepository {
  constructor(private db: DatabaseSync, private syncEnabled = true,private encryptionKey?:string) {
    if(encryptionKey && !/^[a-f0-9]{64}$/i.test(encryptionKey))throw new Error('Settings encryption key must contain 32 random bytes encoded as hex');
    if(encryptionKey)for(const row of db.prepare('SELECT key,value FROM settings').all() as any[])if(/token|secret|password|credential/i.test(row.key) && row.value && !row.value.startsWith('enc:v1:'))this.set(row.key,row.value);
  }
  private encode(value:string):string {
    const iv=crypto.randomBytes(12);const cipher=crypto.createCipheriv('aes-256-gcm',Buffer.from(this.encryptionKey!,'hex'),iv);
    const data=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return ['enc','v1',iv.toString('hex'),cipher.getAuthTag().toString('hex'),data.toString('hex')].join(':');
  }
  private decode(value:string):string {
    if(!value.startsWith('enc:v1:'))return value;
    if(!this.encryptionKey)throw new Error('Settings decryption key is missing');
    const [, ,iv,tag,data]=value.split(':');const cipher=crypto.createDecipheriv('aes-256-gcm',Buffer.from(this.encryptionKey,'hex'),Buffer.from(iv,'hex'));cipher.setAuthTag(Buffer.from(tag,'hex'));
    return Buffer.concat([cipher.update(Buffer.from(data,'hex')),cipher.final()]).toString('utf8');
  }

  public get(key: string, defaultValue: string = ''): string {
      const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
      return row ? this.decode(row.value) : defaultValue;
  }

  public set(key: string, value: string): void {
    if(this.encryptionKey && /token|secret|password|credential/i.test(key) && value)value=this.encode(value);
    this.db.prepare(`
      INSERT INTO settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);

  }

  public getAll(): Record<string, string> {
    try {
      const rows = this.db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>;
      const result: Record<string, string> = {};
      for (const r of rows) {
        result[r.key] = r.value;
      }
      return result;
    } catch {
      return {};
    }
  }

  public delete(key: string): void {
    try {
      this.db.prepare('DELETE FROM settings WHERE key = ?').run(key);
    } catch {}
  }
}
