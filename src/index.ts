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

const reconciliationTimer = setInterval(() => { void instance.scheduler.reconcileCalendarOperations(); }, 60000);
void instance.scheduler.reconcileCalendarOperations();

// Periodic reminder job (runs every 15 minutes in production)
const REMINDER_INTERVAL_MS = 15 * 60 * 1000;
const reminderTimer = setInterval(async () => {
  try {
    const sent24 = await reminders.send24HourReminders();
    const sent1 = await reminders.send1HourReminders();
    if (sent24 > 0 || sent1 > 0) {
      console.log(`[Reminders] Sent ${sent24} 24-hour reminders and ${sent1} 1-hour reminders.`);
    }
  } catch (err) {
    console.error('[Reminders] Error running reminder jobs:', err);
  }
}, REMINDER_INTERVAL_MS);

// Graceful shutdown
function shutdown() {
  console.log('\nShutting down server gracefully...');
  clearInterval(reminderTimer);
  clearInterval(reconciliationTimer);
  server.close(() => {
    instance.db.appDb.close();
    console.log('Server and database closed. Goodbye.');
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
