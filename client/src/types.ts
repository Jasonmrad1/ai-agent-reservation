export type VisitType = 'in_office' | 'home_visit';
export type AppointmentStatus = 'booked' | 'confirmed' | 'rescheduled' | 'cancelled' | 'completed';

export interface TimeInterval {
  start_time: string; // e.g. "09:00"
  end_time: string;   // e.g. "13:00"
}

export interface Appointment {
  id: string;
  customer_id: string;
  customer_name?: string;
  customer_phone?: string;
  visit_type: VisitType;
  address?: string | null;
  service: string;
  price: number;
  start_time: string;
  end_time: string;
  status: AppointmentStatus;
  notes?: string | null;
  conversation_history?: Array<{
    direction: 'inbound' | 'outbound';
    body: string;
    timestamp: string;
  }>;
}

export interface AvailabilityRule {
  id?: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_active: boolean;
  shifts?: TimeInterval[];
}

export interface DateOverride {
  id: string;
  date: string;
  is_unavailable: boolean;
  reason?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  shifts?: TimeInterval[];
}

export interface AppSettings {
  home_visit_buffer_minutes: number;
}
