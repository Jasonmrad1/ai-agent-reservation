import {it,expect} from 'vitest';import {createApp} from '../src/app.js';import {config} from '../src/config/index.js';import {createDatabaseContext} from '../src/db/index.js';
it('seeds the configured travel buffer in new clinic and simulator databases',()=>{
 const a=createApp({config:{...config,databaseUrl:':memory:',homeVisitBufferMinutes:45}});expect(a.scheduler.getHomeVisitBufferMinutes()).toBe(45);expect(a.simulator.db.settings.get('home_visit_buffer_minutes')).toBe('45');
});
it('preserves an existing administrator buffer preference',()=>{
 const db=createDatabaseContext(':memory:');db.settings.set('home_visit_buffer_minutes','0');const a=createApp({db,config:{...config,databaseUrl:':memory:',homeVisitBufferMinutes:45}});expect(a.scheduler.getHomeVisitBufferMinutes()).toBe(0);
});
