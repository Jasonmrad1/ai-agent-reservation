import {it,expect} from 'vitest';import fs from 'node:fs';import {createDatabaseContext} from '../src/db/index.js';import {REPLICA_TABLES} from '../src/db/replication.js';
it('provides a non-root persistent deployment with credentials excluded from its build context',()=>{
 expect(fs.readFileSync('Dockerfile','utf8')).toContain('USER node');expect(fs.readFileSync('Dockerfile','utf8')).toContain('/app/data');
 const ignore=fs.readFileSync('.dockerignore','utf8');expect(ignore).toContain('.env');expect(ignore).toContain('data');
});
