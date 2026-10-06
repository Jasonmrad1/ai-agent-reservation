import {it,expect} from 'vitest';import request from 'supertest';import {createApp} from '../src/app.js';import {config} from '../src/config/index.js';
it('persists a valid inbound before patient resolution can fail',async()=>{
 const a=createApp({config:{...config,databaseUrl:':memory:'}});a.db.customers.findOrCreate=()=>{throw new Error('Patient storage temporarily unavailable');};
 const r=await request(a.app).post('/api/webhook/whatsapp').send({From:'+96171000162',Body:'hello',MessageSid:'SM_STORAGE_REVIEW'});expect(r.status).toBe(200);expect((a.db.appDb.db.prepare('SELECT status FROM inbound_jobs WHERE message_sid=?').get('SM_STORAGE_REVIEW') as any).status).toBe('review');
});
