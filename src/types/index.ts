export type VisitType = 'in_office' | 'home_visit';

export type AppointmentStatus = 'booked' | 'confirmed' | 'rescheduled' | 'cancelled' | 'completed';

export type MessageDirection = 'inbound' | 'outbound';

export type InvoiceStatus = 'unpaid' | 'paid';

export type AlertType = 'delivery_failure' | 'human_handoff' | 'system_error';

export type AlertStatus = 'pending' | 'resolved';

export interface Customer {
  id: string;
  phone: string; // WhatsApp phone e.g. "whatsapp:+1234567890" or "+1234567890"
  name?: string | null;
  opted_out: boolean;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: string;
  customer_id: string;
  channel: 'whatsapp';
  status: 'active' | 'escalated' | 'closed';
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  direction: MessageDirection;
  body: string;
  message_sid?: string | null;
  status: 'received' | 'queued' | 'sent' | 'delivered' | 'failed' | 'undelivered';
  raw_payload?: string | null;
  created_at: string;
}

export interface Appointment {
  id: string;
  customer_id: string;
  visit_type: VisitType;
  address?: string | null;
  service: string;
  price: number;
  start_time: string; // ISO 8601 UTC string
  end_time: string;   // ISO 8601 UTC string
  status: AppointmentStatus;
  google_event_id?: string | null;
  reminder_24h_sent: boolean;
  reminder_1h_sent: boolean;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AvailabilityRule {
  id: string;
  day_of_week: number; // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  start_time: string;  // "09:00" in 24-hour format
  end_time: string;    // "17:00" in 24-hour format
  is_active: boolean;
}

export interface AvailabilityOverride {
  id: string;
  date: string; // "YYYY-MM-DD"
  is_unavailable: boolean; // true if whole day is off/vacation
  start_time?: string | null; // override start time if partial day
  end_time?: string | null;   // override end time if partial day
  reason?: string | null;
}

export interface Invoice {
  id: string;
  appointment_id: string;
  customer_id: string;
  service_description: string;
  amount: number;
  currency: string;
  status: InvoiceStatus;
  payment_link?: string | null;
  created_at: string;
  paid_at?: string | null;
}

export interface AdminAlert {
  id: string;
  type: AlertType;
  title: string;
  details: string;
  customer_id?: string | null;
  status: AlertStatus;
  created_at: string;
  resolved_at?: string | null;
}

export interface CalendarEvent {
  id?: string;
  summary: string;
  description?: string;
  location?: string;
  start: Date;
  end: Date;
  metadata?: Record<string, any>;
}

export interface TimeSlot {
  start: Date;
  end: Date;
  available: boolean;
  reason?: string;
}
