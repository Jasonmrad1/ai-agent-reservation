import fs from 'node:fs';
import {createDatabaseContext} from '../src/db/index.js';
import {getSupabaseClient} from '../src/db/supabase.js';
import {restoreReplica} from '../src/db/restore.js';
const destination=process.argv[2];
if(!destination || fs.existsSync(destination)) throw new Error('Specify a new database file; existing files cannot be overwritten');
const db=createDatabaseContext(destination,{syncEnabled:false});
try {console.log(await restoreReplica(db,getSupabaseClient()));}
finally {db.appDb.close();}
