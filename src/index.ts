import {createApp} from './app.js';
import {config} from './config/index.js';
import {BackgroundTasks} from './runtime/background.js';
import {backupSqliteFile} from './db/backup.js';
import path from 'node:path';

const instance=createApp();
const server=instance.app.listen(config.port,()=>console.log(`Clinic service listening on ${config.port}; dashboard: /admin/login`));
instance.inbox.recoverInterrupted();instance.outbox.recoverInterrupted();
const tasks=new BackgroundTasks(name=>{
 console.error(`Background job failed: ${name}`);
 instance.db.alerts.create({type:'system_error',title:'Background job failed',details:`Job ${name} failed. Review the protected clinic queues.`});
});
tasks.every('inbox',1000,()=>instance.inbox.drain());
tasks.every('outbox',1000,()=>instance.outbox.drain());
tasks.every('replica',1000,()=>instance.replica.drain());
tasks.every('calendar',60000,()=>instance.scheduler.reconcileCalendarOperations());
tasks.every('reminders',15*60000,async()=>{await instance.reminders.send24HourReminders();await instance.reminders.send1HourReminders();});
if(config.databaseUrl!==':memory:')tasks.every('backup',24*60*60000,async()=>{
 backupSqliteFile(config.databaseUrl,process.env.BACKUP_DIRECTORY || path.join(path.dirname(config.databaseUrl),'backups'));
 instance.db.settings.set('last_verified_backup_at',new Date().toISOString());
});
let shuttingDown=false;
async function shutdown(){
 if(shuttingDown)return;shuttingDown=true;
 const deadline=setTimeout(()=>{console.error('Shutdown timed out; durable jobs will be reviewed on restart');process.exit(1);},60000);deadline.unref();
 const httpClosed=new Promise<void>(resolve=>server.close(()=>resolve()));server.closeIdleConnections();
 await Promise.all([httpClosed,tasks.stop()]);
 instance.simulator.db.appDb.close();instance.db.appDb.close();clearTimeout(deadline);
}
process.on('SIGINT',()=>{void shutdown();});process.on('SIGTERM',()=>{void shutdown();});
