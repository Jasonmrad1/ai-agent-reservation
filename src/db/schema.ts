export const SCHEMA_SQL = `
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
  is_active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS availability_overrides (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  is_unavailable INTEGER DEFAULT 1,
  start_time TEXT,
  end_time TEXT,
  reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_overrides_date ON availability_overrides(date);

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
