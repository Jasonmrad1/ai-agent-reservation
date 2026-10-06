import { createApp } from './app.js';
import { config } from './config/index.js';

const instance = createApp();
const { app, reminders } = instance;

const server = app.listen(config.port, () => {
  console.log(`====================================================`);
  console.log(`🚀 Customer Texting & Scheduling Service is running!`);
  console.log(`📡 Port: ${config.port}`);
  console.log(`💬 WhatsApp Webhook: http://localhost:${config.port}/api/webhook/whatsapp`);
  console.log(`🩺 Admin Dashboard: http://localhost:${config.port}/admin/login`);
  console.log(`❤️  Health Check: http://localhost:${config.port}/health`);
  console.log(`====================================================`);
});

instance.inbox.recoverInterrupted();
instance.outbox.recoverInterrupted();
const messagingTimer=setInterval(()=>{void instance.inbox.drain();void instance.outbox.drain();void instance.replica.drain();},1000);
const reconciliationTimer = setInterval(() => { void instance.scheduler.reconcileCalendarOperations(); }, 60000);
void instance.scheduler.reconcileCalendarOperations();

// Periodic reminder job (runs every 15 minutes in production)
const REMINDER_INTERVAL_MS = 15 * 60 * 1000;
let remindersRunning=false;
async function runReminders() {
  if(remindersRunning) return;remindersRunning=true;
  try {
    const sent24 = await reminders.send24HourReminders();
    const sent1 = await reminders.send1HourReminders();
    if (sent24 > 0 || sent1 > 0) {
      console.log(`[Reminders] Sent ${sent24} 24-hour reminders and ${sent1} 1-hour reminders.`);
    }
  } catch (err) {
    console.error('[Reminders] Error running reminder jobs:', err);
  }
  finally {remindersRunning=false;}
}
const reminderTimer = setInterval(()=>{void runReminders();},REMINDER_INTERVAL_MS);
void runReminders();

// Graceful shutdown
function shutdown() {
  console.log('\nShutting down server gracefully...');
  clearInterval(reminderTimer);
  clearInterval(reconciliationTimer);
  clearInterval(messagingTimer);
  server.close(() => {
    instance.db.appDb.close();
    console.log('Server and database closed. Goodbye.');
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
