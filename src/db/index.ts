export * from './schema.js';
export * from './database.js';
export * from './repositories/customer.repo.js';
export * from './repositories/conversation.repo.js';
export * from './repositories/message.repo.js';
export * from './repositories/appointment.repo.js';
export * from './repositories/availability.repo.js';
export * from './repositories/invoice.repo.js';
export * from './repositories/alert.repo.js';
export * from './repositories/settings.repo.js';
export * from './repositories/appointment-workflow.repo.js';

import { AppDatabase } from './database.js';
import { CustomerRepository } from './repositories/customer.repo.js';
import { ConversationRepository } from './repositories/conversation.repo.js';
import { MessageRepository } from './repositories/message.repo.js';
import { AppointmentRepository } from './repositories/appointment.repo.js';
import { AvailabilityRepository } from './repositories/availability.repo.js';
import { InvoiceRepository } from './repositories/invoice.repo.js';
import { AdminAlertRepository } from './repositories/alert.repo.js';
import { SettingsRepository } from './repositories/settings.repo.js';
import { AppointmentWorkflowRepository } from './repositories/appointment-workflow.repo.js';

export interface DatabaseContext {
  appDb: AppDatabase;
  customers: CustomerRepository;
  conversations: ConversationRepository;
  messages: MessageRepository;
  appointments: AppointmentRepository;
  availability: AvailabilityRepository;
  invoices: InvoiceRepository;
  alerts: AdminAlertRepository;
  settings: SettingsRepository;
  workflows: AppointmentWorkflowRepository;
}

export function createDatabaseContext(dbPath: string = ':memory:', options: { syncEnabled?: boolean } = {}): DatabaseContext {
  const appDb = new AppDatabase(dbPath);
  return {
    appDb,
    customers: new CustomerRepository(appDb.db, options.syncEnabled ?? true),
    conversations: new ConversationRepository(appDb.db),
    messages: new MessageRepository(appDb.db),
    appointments: new AppointmentRepository(appDb.db, options.syncEnabled ?? true),
    availability: new AvailabilityRepository(appDb.db, options.syncEnabled ?? true),
    invoices: new InvoiceRepository(appDb.db, options.syncEnabled ?? true),
    alerts: new AdminAlertRepository(appDb.db),
    settings: new SettingsRepository(appDb.db, options.syncEnabled ?? true),
    workflows: new AppointmentWorkflowRepository(appDb.db, options.syncEnabled ?? true),
  };
}
