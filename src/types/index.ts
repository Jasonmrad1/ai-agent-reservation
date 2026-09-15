export type VisitType = 'in_office' | 'home_visit';

export type AppointmentStatus = 'booked' | 'confirmed' | 'rescheduled' | 'cancelled' | 'completed';

export type WorkflowState =
  | 'idle'
  | 'collecting_preferences'
  | 'slot_selected'
  | 'awaiting_slot'
  | 'awaiting_visit_type'
  | 'awaiting_address'
  | 'ready_to_book'
  | 'booking'
  | 'booked'
  | 'cancelled'
  | 'expired'
  | 'failed';

export interface PendingBookingWorkflow {
  id: string;
  customer_id: string;
  conversation_id: string;
  state: WorkflowState;
  date?: string | null;
  time?: string | null;
  service?: string | null;
  price?: number | null;
  visit_type?: VisitType | null;
  address?: string | null;
  location_lat?: number | null;
  location_lng?: number | null;
  last_message_sid?: string | null;
  appointment_id?: string | null;
  version: number;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export type MessageDirection = 'inbound' | 'outbound';

export type InvoiceStatus = 'unpaid' | 'paid';

export type AlertType = 'delivery_failure' | 'human_handoff' | 'system_error' | 'schedule_conflict' | 'booking_alert';

export type AlertStatus = 'pending' | 'resolved';

export interface Customer {
  id: string;
  phone: string; // WhatsApp phone e.g. "whatsapp:+1234567890" or "+1234567890"
  name?: string | null;
  address?: string | null;
  opted_out: boolean;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: string;
  customer_id: string;
  channel: 'whatsapp';
  status: 'active' | 'escalated' | 'doctor_active' | 'closed';
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

export interface TimeInterval {
  start_time: string; // "09:00" in 24-hour format
  end_time: string;   // "13:00" in 24-hour format
}

export interface AvailabilityRule {
  id: string;
  day_of_week: number; // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  start_time: string;  // "09:00" in 24-hour format (earliest shift start)
  end_time: string;    // "17:00" in 24-hour format (latest shift end)
  is_active: boolean;
  shifts?: TimeInterval[]; // non-continuous shift intervals (e.g. 09:00-13:00 and 16:00-20:00)
}

export interface AvailabilityOverride {
  id: string;
  date: string; // "YYYY-MM-DD"
  is_unavailable: boolean; // true if whole day is off/vacation
  start_time?: string | null; // override start time if partial day
  end_time?: string | null;   // override end time if partial day
  reason?: string | null;
  shifts?: TimeInterval[];
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
