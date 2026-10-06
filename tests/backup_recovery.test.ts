import {it,expect} from 'vitest';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {DatabaseSync} from 'node:sqlite';
import {backupSqliteFile} from '../src/db/backup.js';import {createDatabaseContext} from '../src/db/index.js';
it('creates an integrity-checked backup that preserves committed patient data',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'clinic-backup-'));const source=path.join(dir,'clinic.sqlite');const db=createDatabaseContext(source);
 const c=db.customers.findOrCreate('+96171000888');db.appDb.close();const target=backupSqliteFile(source,path.join(dir,'backups'));
 const restored=new DatabaseSync(target,{readOnly:true});expect(restored.prepare('SELECT id FROM customers WHERE id=?').get(c.id)).toBeTruthy();expect(restored.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe('ok');restored.close();
 expect(()=>backupSqliteFile(path.join(dir,'missing.sqlite'),path.join(dir,'backups'))).toThrow();
 fs.rmSync(dir,{recursive:true,force:true});
});
