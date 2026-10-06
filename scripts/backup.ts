import {config} from '../src/config/index.js';
import {backupSqliteFile} from '../src/db/backup.js';
import path from 'node:path';
console.log(backupSqliteFile(config.databaseUrl,process.env.BACKUP_DIRECTORY || path.join(path.dirname(config.databaseUrl),'backups')));
