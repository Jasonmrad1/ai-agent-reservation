import {it,expect} from 'vitest';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createApp} from '../src/app.js';import {config} from '../src/config/index.js';
it('stores sandbox data beside the configured database on its persistent volume',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'clinic-volume-'));const previous=process.cwd();process.chdir(dir);let a:ReturnType<typeof createApp>|undefined;
 try{const databaseUrl=path.join(dir,'persistent','clinic.sqlite');a=createApp({config:{...config,mode:'simulator',databaseUrl}});const file=(a.simulator.db.appDb.db.prepare('PRAGMA database_list').get() as any).file;expect(path.normalize(file)).toBe(path.join(dir,'persistent','simulator.sqlite'));}
 finally{a?.simulator.db.appDb.close();a?.db.appDb.close();process.chdir(previous);fs.rmSync(dir,{recursive:true,force:true});}
});
