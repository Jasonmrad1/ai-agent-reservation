# Customer Texting & Scheduling Agent — Build Brief

This document is written **for an AI coding agent** (e.g. Claude Code) that will build this
project. It describes the goal, architecture, required decisions, and a build order. Follow
it as a spec — where a decision is marked "default," use it unless the user says otherwise.

## 1. What this agent does

A backend service that:
1. Receives text messages from customers over WhatsApp (the only channel — no SMS/Twilio).
2. Uses Gemini to understand intent — book, reschedule ("move"), cancel, ask a question, or
   "I need a human."
3. Checks and updates a schedule/calendar accordingly, including whether the visit is the
   customer coming in or the doctor traveling to the customer's home.
4. Replies in a professional, on-brand tone, and sends confirmations/reminders automatically.
5. Falls back gracefully — retries or a human handoff — whenever something is uncertain or a
   service call fails, rather than guessing or going silent.
6. Gives the admin (the doctor or office staff) a page to set which hours/days they're
   available each week, and pings the admin whenever a customer books, reschedules, or
   cancels.
7. Generates and sends bills/invoices to customers for completed appointments.

"Reliable and professional" is the actual spec here, not a nice-to-have — see §5. A demo that
works once in testing is not the bar; an agent that never double-books, never leaves a
customer's message unanswered, and never invents information it doesn't have is the bar.

## 2. Architecture

```
Customer (WhatsApp)
        │
        ▼
Messaging Gateway  ──────────────►  Twilio WhatsApp API   (only channel)
  (webhook receiver)
        │
        ▼
Agent Core (Node.js/TypeScript or Python)
  ├─ Intent classification & reply generation → Gemini API (function calling)
  ├─ Conversation state & message log → Database
  ├─ Scheduling logic (incl. visit type: in-office / home visit) → Calendar backend
  ├─ Billing logic → Invoice/payment record → Database
  └─ Admin notifications → sent over WhatsApp too (same gateway)
        │
        ▼
Calendar Backend ────────────────►  Google Calendar API (decided)
                                     ↳ doctor installs/adds Google Calendar on
                                       his iPhone; agent reads/writes it via
                                       the API (see §3.3)
        │
        ▼
Outbound reminders / confirmations (scheduled jobs) → back through Messaging Gateway

Admin Dashboard (web page)
  ├─ Set weekly availability (which days/hours the doctor is bookable)
  ├─ View upcoming appointments — visit type, address for home visits, status
  └─ View/send bills, mark paid
```

## 3. Key decisions and defaults

### 3.1 Messaging: WhatsApp only, via Twilio
- WhatsApp is the sole channel — no SMS, no fallback channel. Every customer interaction
  (booking, rescheduling, reminders) and every admin notification goes over WhatsApp.
- **Default vendor: Twilio's WhatsApp API.** It wraps webhook handling, delivery tracking,
  and sending behind one clean API instead of talking to Meta's Graph API directly — less
  plumbing to write and maintain. The trade-off: Twilio adds its own per-message fee on top
  of Meta's, and it doesn't skip Meta's requirements below — it just makes the integration
  work easier.
- Either way (Twilio or Meta's Cloud API directly), the business still needs Meta business
  verification and message template approval for business-initiated messages (reminders,
  admin notifications) — build this into the timeline, it isn't instant.
- Because there's no fallback channel, WhatsApp delivery failures need to be retried
  aggressively and surfaced to the admin some other way if they persist (e.g. a dashboard
  alert) — see §5.

### 3.2 AI: Gemini
- Use Gemini's function-calling / tool-use mode, not free-text parsing. Define tools like
  `check_availability`, `book_appointment`, `cancel_appointment`, `escalate_to_human` — let
  Gemini decide which to call, then the backend executes it deterministically. This is what
  makes behavior reliable: Gemini classifies and drafts language, it never directly mutates
  the schedule on its own say-so.
- Keep a strict system prompt: business hours, services offered, cancellation policy, and a
  hard rule to say "let me check with the team" (and escalate) rather than fabricate an answer
  it doesn't have grounding for.

### 3.3 iOS scheduling: Google Calendar (decided)
The doctor installs the Google Calendar app on his iPhone (or just adds the Google account to
the built-in iOS Calendar app) and the agent reads/writes that calendar via the Google
Calendar API. No native iOS app is being built — the schedule shows up on his phone through
that sync, which is all "on iOS" requires here.

### 3.4 Backend & data
- Node.js + TypeScript + Express (or Fastify) is a reasonable default; Python + FastAPI is
  equally fine if the user has a preference.
- Postgres for production, SQLite acceptable for prototyping.
- Minimum tables: `customers`, `conversations`, `messages`, `appointments`, `availability_rules`,
  `invoices`.
- `appointments` needs a `visit_type` field (`in_office` / `home_visit`) and, when it's a home
  visit, a customer address (and optionally a travel-time buffer around it so the doctor isn't
  double-booked back-to-back across town — flag this as an open question, see §8).
- `availability_rules` is what the admin page in §3.5 writes to: a simple weekly template
  (e.g. "Mon–Fri 9–17, closed weekends") plus one-off overrides (a day off, an extra slot).

### 3.5 Admin dashboard: weekly availability
- A simple authenticated web page (even a single page is enough at first) where the admin
  sets which days and hours they're bookable each week, and can block out one-off exceptions
  (vacation, a half-day).
- This is the source of truth `check_availability` reads from — Gemini/customers never see a
  slot the admin hasn't opened up.
- The same page should list upcoming appointments (with visit type and, for home visits, the
  address) so the admin has one place to see the week at a glance.

### 3.6 Visit type: in-office vs. home visit
- Every appointment carries a `visit_type`. When a customer books via WhatsApp, Gemini should
  ask (or infer from what the customer says) whether it's an in-office visit or a home visit,
  and collect an address for the latter.
- Home visits likely need more calendar buffer than office visits (travel time) — the default
  is to let the admin set a fixed buffer per home visit in §3.5 rather than trying to calculate
  real travel time; real-time travel-time calculation (e.g. via a maps API) is a possible
  later upgrade, not a v1 requirement.

### 3.7 Billing
- Default: the agent generates a simple invoice (service, amount, date) after a completed
  appointment and sends it to the customer — as a WhatsApp message/PDF and/or logged in the
  admin dashboard as "unpaid" until the admin marks it paid.
- Whether the agent should also **collect** payment online (e.g. a Stripe payment link sent
  over WhatsApp) or just **generate the bill** and let payment happen offline (cash/transfer at
  the visit) is an open decision — see §8. Default to generate-and-send only for v1; online
  collection is a clean add-on once the core flow works.

## 4. Core flow

1. Webhook receives inbound message → verify webhook signature → store raw message.
2. Look up or create the customer record; load recent conversation context.
3. Call Gemini with the conversation context + available tools.
4. Execute whatever tool call Gemini returns against the calendar/database.
5. Gemini drafts the reply using the tool result (never before it).
6. Send the reply through the same channel the customer used.
7. Log everything — inbound text, tool calls, outbound text, timestamps — for audit and
   debugging.
8. Separately, a scheduled job sends reminders (e.g., 24h and 1h before an appointment) and
   asks for confirmation.
9. Any booking, reschedule, or cancellation triggers an admin notification (WhatsApp/SMS/email
   — pick one primary channel, see §8) so the admin never has to check the dashboard to find
   out something changed.
10. After a completed appointment, the billing step (§3.7) creates an invoice record and sends
    it to the customer.

## 5. Reliability & professionalism checklist

This is the part that turns a prototype into something a real business can depend on:

- **Retries with backoff** on every external API call (Twilio/WhatsApp, Gemini, Calendar).
- **Idempotency** — a webhook or reminder job retried by the provider must not double-book or
  double-send.
- **No fallback channel, so retry harder** — since WhatsApp is the only channel, a failed send
  should retry with backoff and, if it keeps failing, raise a dashboard alert for the admin
  rather than silently giving up.
- **Human handoff threshold** — if Gemini's confidence is low, the request is unusual, or the
  customer explicitly asks for a person, escalate (e.g., notify the owner) instead of guessing.
- **No hallucinated facts** — prices, hours, and policies come from a data source the agent
  looks up, never from the model's own assumption.
- **Rate limiting & signature verification** on all inbound webhooks.
- **Opt-out compliance** — honor WhatsApp opt-outs immediately.
- **PII handling** — store only what's needed (name, phone, appointment history); document
  retention and deletion.
- **Monitoring & alerting** — error rate, failed sends, and calendar-sync failures should page
  a human, not just sit in a log file.
- **Staging before production** — test against a WhatsApp sandbox number and a test calendar
  before pointing at real customers.
- **Admin notifications must not get lost** — treat them like any other outbound WhatsApp
  message (retry, dashboard alert on repeated failure) since a missed "customer just
  cancelled" defeats the point.
- **Billing accuracy** — an invoice should only ever be generated from the actual appointment
  record (service, date, agreed price), never drafted freehand by Gemini.

## 6. Environment variables

```
GEMINI_API_KEY=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_NUMBER=
GOOGLE_CALENDAR_CLIENT_ID=
GOOGLE_CALENDAR_CLIENT_SECRET=
GOOGLE_CALENDAR_ID=
DATABASE_URL=
ADMIN_SESSION_SECRET=
# Optional, only if online payment collection is added (see §3.7 / §8):
STRIPE_SECRET_KEY=
```

## 7. Suggested build order

1. Webhook skeleton — receive and log a WhatsApp message, reply with a static "got it."
2. Wire in Gemini for intent classification on top of the skeleton (no calendar yet).
3. Add the calendar backend (Option A or B from §3.3) and the `check_availability` /
   `book_appointment` / `cancel_appointment` tools.
4. Add outbound reminder/confirmation jobs.
5. Build the admin dashboard (§3.5): weekly availability, upcoming-appointments view.
6. Add visit type (in-office/home visit + address) to booking, and admin notifications on
   any booking/reschedule/cancellation.
7. Add billing: generate an invoice on appointment completion, send to the customer, show
   paid/unpaid status in the admin dashboard.
8. Add the reliability layer from §5 (retries, fallback channel, handoff, rate limiting).
9. Test end-to-end against a WhatsApp sandbox number and a test calendar.
10. Get WhatsApp message templates approved, then go live.

## 8. Open decisions for the user (confirm before building)

- Single business owner/number vs. a team with multiple staff calendars.
- Generate-and-send invoices only (default), vs. also collecting payment online (e.g. a
  Stripe link) through the same WhatsApp flow.
- How much travel buffer to reserve around home visits, and whether it's a fixed admin-set
  buffer (default) or calculated from a real address/distance.
