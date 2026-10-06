import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** VACUUM INTO takes a consistent SQLite snapshot, including committed WAL data. */
export function backupSqliteFile(source:string,directory:string):string {
 if(source===':memory:' || !fs.existsSync(source))throw new Error('Backup requires an existing persistent SQLite database');
 fs.mkdirSync(directory,{recursive:true,mode:0o700});
 const target=path.resolve(directory,`clinic-${Date.now()}-${crypto.randomUUID()}.sqlite`);
 const sql=new DatabaseSync(source,{readOnly:true});
 try {
  if(sql.prepare('PRAGMA quick_check').get()?.quick_check!=='ok')throw new Error('Source database integrity check failed');
  sql.prepare('VACUUM INTO ?').run(target);
 }finally{sql.close();}
 const copy=new DatabaseSync(target,{readOnly:true});
 try {if(copy.prepare('PRAGMA integrity_check').get()?.integrity_check!=='ok')throw new Error('Backup integrity check failed');}finally{copy.close();}
 fs.chmodSync(target,0o600);return target;
}
