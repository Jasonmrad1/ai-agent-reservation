# WhatsApp Customer Texting & Scheduling Automation

A production-ready WhatsApp texting and scheduling backend for medical practices, built strictly according to [`GEMINI.md`](file:///C:/CS/CustomerAutomation/GEMINI.md).

## 🚀 Key Features

1. **WhatsApp Messaging Gateway (Twilio)**:
   - Webhook receiver (`POST /api/webhook/whatsapp`) with signature verification.
   - Message deduplication & idempotency via `MessageSid`.
   - Outbound WhatsApp client with exponential backoff retries and alert escalation.
   - Immediate opt-out compliance (`STOP`, `UNSUBSCRIBE`, `CANCEL`, `START`).
   - Delivery status callback receiver (`POST /api/webhook/whatsapp/status`).

2. **Scheduling Engine & Google Calendar Sync**:
   - `CalendarProvider` abstraction (`GoogleCalendarProvider` for production, `InMemoryCalendarProvider` for testing).
   - Distinguishes **In-Office Visits** vs. **Home Visits**.
   - Enforces physical address collection for home visits.
   - Configurable travel time buffers around home visits (default: 30 minutes before and after).
   - Conflict checking against availability rules, vacation overrides, and existing appointments to **guarantee NO double-booking**.

3. **Gemini AI Tool-Calling Agent Core**:
   - Uses Gemini function-calling / structured tool use (`check_availability`, `book_appointment`, `reschedule_appointment`, `cancel_appointment`, `escalate_to_human`, `get_services_and_policies`).
   - Strict grounding: prices, hours, and slots are never hallucinated.
   - Automatic escalation to human doctor/staff upon customer demand, uncertainty, or medical emergency.

4. **Outbound Interactive Reminders**:
   - Background jobs for 24-hour and 1-hour appointment reminders.
   - Interactive confirmation ("Reply *YES* to confirm or *MOVE* to reschedule").
   - Idempotent tracking to prevent duplicate messages.

5. **Billing & Invoicing**:
   - Deterministic invoice generation derived strictly from the completed appointment record.
   - Dispatches formatted invoice receipt over WhatsApp.
   - Records paid/unpaid status with receipt dispatch.

6. **Admin Dashboard**:
   - Single-page responsive web dashboard (`/admin/dashboard?key=<SECRET>`).
   - Weekly availability rules management (Mon-Sun hours).
   - One-off date overrides & vacation management.
   - Upcoming appointments view (visit type, home address, status).
   - One-click "Complete & Bill" action.
   - Invoices management and mark-paid functionality.
   - Real-time alerts queue (failed deliveries, human handoffs).

---

## 🧪 Testing Phases & Test Suite

The project is built test-first and covered by 6 comprehensive test suites (37 automated tests):

| Phase | Test File | Description |
|---|---|---|
| **Phase 1: DB & Repositories** | [`tests/db.test.ts`](file:///C:/CS/CustomerAutomation/tests/db.test.ts) | 12 tests: Schema, customers, conversations, messages, appointments, rules, invoices, alerts. |
| **Phase 2: WhatsApp & Gateway** | [`tests/webhook.test.ts`](file:///C:/CS/CustomerAutomation/tests/webhook.test.ts) | 5 tests: Twilio webhook, idempotency, opt-out/in, delivery status callbacks, retries with backoff. |
| **Phase 3: Calendar & Scheduling** | [`tests/calendar.test.ts`](file:///C:/CS/CustomerAutomation/tests/calendar.test.ts) | 6 tests: Slot generation, overrides, double-booking prevention, home visit travel buffer conflicts. |
| **Phase 4: Gemini Agent Core** | [`tests/agent.test.ts`](file:///C:/CS/CustomerAutomation/tests/agent.test.ts) | 7 tests: Tool calls, booking, rescheduling, cancellation, human escalation, grounding verification. |
| **Phase 5, 6, 7: Reminders, Admin, Billing** | [`tests/reminders_billing_admin.test.ts`](file:///C:/CS/CustomerAutomation/tests/reminders_billing_admin.test.ts) | 6 tests: 24h/1h reminders, confirmation replies, invoice generation, admin API auth & actions. |
| **Phase 8: End-to-End Lifecycle** | [`tests/e2e.test.ts`](file:///C:/CS/CustomerAutomation/tests/e2e.test.ts) | 1 full lifecycle test: WhatsApp inquiry -> booking -> calendar sync -> admin alert -> 24h reminder -> YES confirmation -> 1h reminder -> completion -> billing -> paid receipt. |

Run tests:
```bash
npm test
```

Build:
```bash
npm run build
```

Run in development:
```bash
npm run dev
```
