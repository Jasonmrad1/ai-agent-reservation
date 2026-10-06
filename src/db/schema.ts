export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS message_status_events (message_sid TEXT PRIMARY KEY,status TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS inbound_jobs (message_sid TEXT PRIMARY KEY, sender TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, last_error TEXT);
CREATE TABLE IF NOT EXISTS outbound_jobs (id TEXT PRIMARY KEY, recipient TEXT NOT NULL, body TEXT NOT NULL, customer_id TEXT NOT NULL, conversation_id TEXT NOT NULL, status TEXT NOT NULL, message_sid TEXT, attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT, last_error TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS calendar_operations (id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL, reservation_id TEXT, created_at TEXT NOT NULL, last_error TEXT);
CREATE TABLE IF NOT EXISTS scheduling_reservations (
  id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, appointment_id TEXT,
  visit_type TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS appointment_operations (
  operation_key TEXT PRIMARY KEY, appointment_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  phone TEXT UNIQUE NOT NULL,
  name TEXT,
  opted_out INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  body TEXT NOT NULL,
  message_sid TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'received',
  raw_payload TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);

CREATE INDEX IF NOT EXISTS idx_messages_message_sid ON messages(message_sid);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);

CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  visit_type TEXT NOT NULL,
  address TEXT,
  service TEXT NOT NULL,
  price REAL NOT NULL DEFAULT 0,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'booked',
  google_event_id TEXT,
  reminder_24h_sent INTEGER DEFAULT 0,
  reminder_1h_sent INTEGER DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE INDEX IF NOT EXISTS idx_appointments_start_time ON appointments(start_time);
CREATE INDEX IF NOT EXISTS idx_appointments_customer ON appointments(customer_id);

CREATE TABLE IF NOT EXISTS availability_rules (
  id TEXT PRIMARY KEY,
  day_of_week INTEGER NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  shifts TEXT
);

CREATE TABLE IF NOT EXISTS availability_overrides (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  is_unavailable INTEGER DEFAULT 1,
  start_time TEXT,
  end_time TEXT,
  reason TEXT,
  shifts TEXT
);

CREATE INDEX IF NOT EXISTS idx_overrides_date ON availability_overrides(date);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  service_description TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'unpaid',
  payment_link TEXT,
  created_at TEXT NOT NULL,
  paid_at TEXT,
  FOREIGN KEY (appointment_id) REFERENCES appointments(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS admin_alerts (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  details TEXT NOT NULL,
  customer_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS pending_booking_workflows (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'collecting_preferences',
  date TEXT,
  time TEXT,
  service TEXT,
  price REAL,
  visit_type TEXT,
  address TEXT,
  location_lat REAL,
  location_lng REAL,
  last_message_sid TEXT,
  appointment_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);

CREATE INDEX IF NOT EXISTS idx_workflows_customer_state ON pending_booking_workflows(customer_id, state);
CREATE INDEX IF NOT EXISTS idx_workflows_expires ON pending_booking_workflows(expires_at);
`;

export const DEFAULT_WEEKLY_AVAILABILITY = [
  { day_of_week: 1, start_time: '09:00', end_time: '17:00', is_active: 1 }, // Monday
  { day_of_week: 2, start_time: '09:00', end_time: '17:00', is_active: 1 }, // Tuesday
  { day_of_week: 3, start_time: '09:00', end_time: '17:00', is_active: 1 }, // Wednesday
  { day_of_week: 4, start_time: '09:00', end_time: '17:00', is_active: 1 }, // Thursday
  { day_of_week: 5, start_time: '09:00', end_time: '17:00', is_active: 1 }, // Friday
  { day_of_week: 6, start_time: '09:00', end_time: '13:00', is_active: 0 }, // Saturday (off by default)
  { day_of_week: 0, start_time: '09:00', end_time: '13:00', is_active: 0 }, // Sunday (off by default)
];
