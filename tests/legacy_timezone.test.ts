import {it,expect} from 'vitest';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {DatabaseSync} from 'node:sqlite';
import {backupSqliteFile} from '../src/db/backup.js';import {createDatabaseContext} from '../src/db/index.js';
it('flags existing appointments with unknown timestamp semantics for review',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'clinic-legacy-'));const file=path.join(dir,'clinic.sqlite');let d=createDatabaseContext(file);const c=d.customers.findOrCreate('+96171000889');
 d.appointments.create({customer_id:c.id,visit_type:'in_office',service:'Consultation',price:100,start_time:'2026-09-14T10:00:00Z',end_time:'2026-09-14T11:00:00Z',status:'booked'} as any);d.settings.delete('timezone_storage_version');d.appDb.close();d=createDatabaseContext(file);
 expect(d.settings.get('timezone_storage_version')).toBe('legacy-review');d.appDb.close();fs.rmSync(dir,{recursive:true,force:true});
});
