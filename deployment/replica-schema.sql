-- Generated from SQLite. Apply only to a new empty Supabase replica.
-- SQLite remains authoritative; cloud restore verifies relationships.
BEGIN;
CREATE TABLE IF NOT EXISTS public.customers (
  "id" text PRIMARY KEY,
  "phone" text NOT NULL,
  "name" text,
  "opted_out" bigint DEFAULT 0,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customers FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customers TO service_role;

CREATE TABLE IF NOT EXISTS public.conversations (
  "id" text PRIMARY KEY,
  "customer_id" text NOT NULL,
  "channel" text NOT NULL DEFAULT 'whatsapp',
  "status" text NOT NULL DEFAULT 'active',
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.conversations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations TO service_role;

CREATE TABLE IF NOT EXISTS public.messages (
  "id" text PRIMARY KEY,
  "conversation_id" text NOT NULL,
  "direction" text NOT NULL,
  "body" text NOT NULL,
  "message_sid" text,
  "status" text NOT NULL DEFAULT 'received',
  "raw_payload" text,
  "created_at" text NOT NULL
);
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.messages FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO service_role;

CREATE TABLE IF NOT EXISTS public.appointments (
  "id" text PRIMARY KEY,
  "customer_id" text NOT NULL,
  "visit_type" text NOT NULL,
  "address" text,
  "service" text NOT NULL,
  "price" double precision NOT NULL DEFAULT 0,
  "start_time" text NOT NULL,
  "end_time" text NOT NULL,
  "status" text NOT NULL DEFAULT 'booked',
  "google_event_id" text,
  "reminder_24h_sent" bigint DEFAULT 0,
  "reminder_1h_sent" bigint DEFAULT 0,
  "notes" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.appointments FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.appointments TO service_role;

CREATE TABLE IF NOT EXISTS public.availability_rules (
  "id" text PRIMARY KEY,
  "day_of_week" bigint NOT NULL,
  "start_time" text NOT NULL,
  "end_time" text NOT NULL,
  "is_active" bigint DEFAULT 1,
  "shifts" text
);
ALTER TABLE public.availability_rules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.availability_rules FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.availability_rules TO service_role;

CREATE TABLE IF NOT EXISTS public.availability_overrides (
  "id" text PRIMARY KEY,
  "date" text NOT NULL,
  "is_unavailable" bigint DEFAULT 1,
  "start_time" text,
  "end_time" text,
  "reason" text,
  "shifts" text
);
ALTER TABLE public.availability_overrides ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.availability_overrides FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.availability_overrides TO service_role;

CREATE TABLE IF NOT EXISTS public.settings (
  "key" text PRIMARY KEY,
  "value" text NOT NULL
);
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.settings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.settings TO service_role;

CREATE TABLE IF NOT EXISTS public.invoices (
  "id" text PRIMARY KEY,
  "appointment_id" text NOT NULL,
  "customer_id" text NOT NULL,
  "service_description" text NOT NULL,
  "amount" double precision NOT NULL,
  "currency" text NOT NULL DEFAULT 'USD',
  "status" text NOT NULL DEFAULT 'unpaid',
  "payment_link" text,
  "created_at" text NOT NULL,
  "paid_at" text
);
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.invoices FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoices TO service_role;

CREATE TABLE IF NOT EXISTS public.admin_alerts (
  "id" text PRIMARY KEY,
  "type" text NOT NULL,
  "title" text NOT NULL,
  "details" text NOT NULL,
  "customer_id" text,
  "status" text NOT NULL DEFAULT 'pending',
  "created_at" text NOT NULL,
  "resolved_at" text
);
ALTER TABLE public.admin_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_alerts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_alerts TO service_role;

CREATE TABLE IF NOT EXISTS public.pending_booking_workflows (
  "id" text PRIMARY KEY,
  "customer_id" text NOT NULL,
  "conversation_id" text NOT NULL,
  "state" text NOT NULL DEFAULT 'collecting_preferences',
  "date" text,
  "time" text,
  "service" text,
  "price" double precision,
  "visit_type" text,
  "address" text,
  "location_lat" double precision,
  "location_lng" double precision,
  "last_message_sid" text,
  "appointment_id" text,
  "version" bigint NOT NULL DEFAULT 1,
  "expires_at" text NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);
ALTER TABLE public.pending_booking_workflows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pending_booking_workflows FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pending_booking_workflows TO service_role;

CREATE TABLE IF NOT EXISTS public.scheduling_reservations (
  "id" text PRIMARY KEY,
  "customer_id" text NOT NULL,
  "appointment_id" text,
  "visit_type" text NOT NULL,
  "start_time" text NOT NULL,
  "end_time" text NOT NULL,
  "created_at" text NOT NULL
);
ALTER TABLE public.scheduling_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.scheduling_reservations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scheduling_reservations TO service_role;

CREATE TABLE IF NOT EXISTS public.calendar_operations (
  "id" text PRIMARY KEY,
  "kind" text NOT NULL,
  "payload" text NOT NULL,
  "reservation_id" text,
  "created_at" text NOT NULL,
  "last_error" text
);
ALTER TABLE public.calendar_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.calendar_operations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.calendar_operations TO service_role;

CREATE TABLE IF NOT EXISTS public.appointment_operations (
  "operation_key" text PRIMARY KEY,
  "appointment_id" text NOT NULL
);
ALTER TABLE public.appointment_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.appointment_operations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.appointment_operations TO service_role;

CREATE TABLE IF NOT EXISTS public.inbound_jobs (
  "message_sid" text PRIMARY KEY,
  "sender" text NOT NULL,
  "payload" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "created_at" text NOT NULL,
  "last_error" text
);
ALTER TABLE public.inbound_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inbound_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inbound_jobs TO service_role;

CREATE TABLE IF NOT EXISTS public.outbound_jobs (
  "id" text PRIMARY KEY,
  "options" text,
  "idempotency_key" text,
  "recipient" text NOT NULL,
  "body" text NOT NULL,
  "customer_id" text NOT NULL,
  "conversation_id" text NOT NULL,
  "status" text NOT NULL,
  "message_sid" text,
  "attempts" bigint NOT NULL DEFAULT 0,
  "next_attempt_at" text,
  "last_error" text,
  "created_at" text NOT NULL
);
ALTER TABLE public.outbound_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.outbound_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.outbound_jobs TO service_role;

CREATE TABLE IF NOT EXISTS public.reminder_claims (
  "claim_key" text PRIMARY KEY,
  "appointment_id" text NOT NULL,
  "created_at" text NOT NULL
);
ALTER TABLE public.reminder_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reminder_claims FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reminder_claims TO service_role;

CREATE TABLE IF NOT EXISTS public.message_status_events (
  "message_sid" text PRIMARY KEY,
  "status" text NOT NULL
);
ALTER TABLE public.message_status_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.message_status_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_status_events TO service_role;

CREATE TABLE IF NOT EXISTS public.billing_notifications (
  "notification_key" text PRIMARY KEY,
  "created_at" text NOT NULL
);
ALTER TABLE public.billing_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_notifications FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_notifications TO service_role;

COMMIT;
