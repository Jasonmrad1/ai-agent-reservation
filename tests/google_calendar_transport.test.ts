import {it,expect,vi} from 'vitest';import {GoogleCalendarProvider} from '../src/calendar/provider.js';
const provider=(events:any)=>{const p=new GoogleCalendarProvider({clientId:'id',clientSecret:'secret',refreshToken:'token',calendarId:'clinic'});(p as any).getClient=async()=>({events});return p;};
it('recognizes an already-created event represented with a timezone offset',async()=>{
 const p=provider({insert:vi.fn().mockRejectedValue({code:409}),get:vi.fn().mockResolvedValue({data:{start:{dateTime:'2026-09-14T10:00:00+03:00'},end:{dateTime:'2026-09-14T11:00:00+03:00'}}})});
 await expect(p.createEvent({id:'abc123',summary:'Test',start:new Date('2026-09-14T07:00:00Z'),end:new Date('2026-09-14T08:00:00Z')})).resolves.toBe('abc123');
});
it('reads every calendar page, skips cancelled events and patches only supplied metadata',async()=>{
 const events={list:vi.fn().mockResolvedValueOnce({data:{items:[{id:'one',start:{dateTime:'2026-09-14T07:00:00Z'},end:{dateTime:'2026-09-14T08:00:00Z'}}],nextPageToken:'page2'}}).mockResolvedValueOnce({data:{items:[{id:'cancelled',status:'cancelled'},{id:'two',start:{dateTime:'2026-09-14T09:00:00Z'},end:{dateTime:'2026-09-14T10:00:00Z'}}]}}),patch:vi.fn().mockResolvedValue({})};const p=provider(events);
 expect(await p.listEvents(new Date('2026-09-14'),new Date('2026-09-15'))).toHaveLength(2);expect(events.list.mock.calls[1][0].pageToken).toBe('page2');
 expect(events.list.mock.calls[0][1]).toMatchObject({timeout:10000,retry:false});
 await p.updateEvent('one',{start:new Date('2026-09-14T10:00:00Z'),end:new Date('2026-09-14T11:00:00Z')} as any);expect(events.patch.mock.calls[0][0].requestBody).not.toHaveProperty('description');
});
