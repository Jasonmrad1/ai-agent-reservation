import fs from 'node:fs';import path from 'node:path';
import {config} from '../src/config/index.js';import {createDatabaseContext} from '../src/db/index.js';import {backupSqliteFile} from '../src/db/backup.js';import {applyReviewedTimes} from '../src/db/legacy-times.js';
const reviewPath=process.argv[2];if(!reviewPath)throw new Error('Usage: npm run migrate:times -- reviewed-times.json (stop the server first)');
const review=JSON.parse(fs.readFileSync(reviewPath,'utf8'));if(review.reviewed!==true || !Array.isArray(review.appointments))throw new Error('A reviewed appointment mapping is required');
backupSqliteFile(config.databaseUrl,path.join(path.dirname(config.databaseUrl),'backups'));
const db=createDatabaseContext(config.databaseUrl,{encryptionKey:config.settingsEncryptionKey});try{applyReviewedTimes(db,review.appointments);console.log('Reviewed UTC mapping committed.');}finally{db.appDb.close();}
