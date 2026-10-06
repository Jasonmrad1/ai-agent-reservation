> Current setup and reliability instructions: [MVP and deployment operations](docs/OPERATIONS.md). Start with `APP_MODE=simulator` for zero-credit testing. Live phone activation requires provider verification and clinic review. Older feature descriptions below are historical; the operations guide defines the current behavior.

# 🩺 ClinicFlow — Intelligent WhatsApp Medical Scheduling & Texting Automation

[![Tests](https://img.shields.io/badge/Tests-108%20Passing%20(22%20Suites)-emerald?style=flat-square&logo=vitest)](tests/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue?style=flat-square&logo=typescript)](tsconfig.json)
[![Gemini API](https://img.shields.io/badge/AI-Gemini%20Function%20Calling-8E75B2?style=flat-square&logo=googlegemini)](src/gemini/)
[![Supabase](https://img.shields.io/badge/Cloud%20DB-Supabase%20%2B%20SQLite-3ECF8E?style=flat-square&logo=supabase)](src/db/)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

A production-grade, autonomous **WhatsApp Medical Receptionist & Scheduling Service** designed specifically for private medical clinics and home-care practices. Built strictly around deterministic function-calling, conflict-free scheduling algorithms, multi-turn state machines, and natural multilingual communication (English, Lebanese Arabizi, Arabic, and French).

---

## 🌟 Key Architecture & Highlights

```
                       ┌──────────────────────────────────────────────┐
                       │             Customer (WhatsApp)              │
                       └──────────────────────┬───────────────────────┘
                                              │  (Webhook & Status Callback)
                                              ▼
                       ┌──────────────────────────────────────────────┐
                       │        WhatsApp Gateway / Twilio API         │
                       │    - Rate Limiting & Guardrails Filter       │
                       │    - Idempotent Message Deduplication        │
                       │    - Automatic Retries & Backoff             │
                       └──────────────────────┬───────────────────────┘
                                              │
                                              ▼
                       ┌──────────────────────────────────────────────┐
                       │            Agent Core & Workflows            │
                       │  ├─ Gemini Intent & Function Calling         │
                       │  ├─ Multi-Turn Pending State Machine         │
                       │  ├─ Language Auto-Mirroring (Eng/Arabizi/Ar) │
                       │  └─ Human Escalation & Voice Fallbacks       │
                       └───────────┬──────────────────────┬───────────┘
                                   │                      │
           ┌───────────────────────┴────────┐    ┌────────┴─────────────────────┐
           ▼                                ▼    ▼                              ▼
┌───────────────────────┐ ┌──────────────────────────┐ ┌──────────────────────────┐
│   Scheduling Engine   │ │     Dual Database Sync   │ │     Admin Dashboard      │
│ - In-Office & Home    │ │ - Local SQLite Cache     │ │ - Live Availability Grid │
│ - Commute Buffering   │ │ - Supabase Cloud Sync    │ │ - One-Click Slot Booking │
│ - Google Calendar API │ │ - Audit Message Logging  │ │ - Invoicing & Outreach   │
└───────────────────────┘ └──────────────────────────┘ └──────────────────────────┘
```

---

## 🚀 Core Features

### 1. 🤖 Gemini Function-Calling & Tool Determinism
- **Deterministic Calendar Mutation**: The LLM *never* directly mutates appointments or availability on its own. It acts as an intent classifier and reply drafter, while backend tools (`check_availability`, `book_appointment`, `reschedule_appointment`, `cancel_appointment`, `escalate_to_human`) strictly validate slots, shifts, and conflict rules.
- **Zero Hallucination Guard**: Service policies, working hours, and time slots are strictly fetched from live calendar engines, never guessed.

### 2. 🚗 In-Office vs. Home Visit Commute Buffering
- **Smart Commute Buffering**: Automatically enforces fixed travel-time buffers (e.g. 30–45 mins) before and after home visits, preventing impossible back-to-back cross-town bookings.
- **WhatsApp Location Pin & GPS Support**: Seamlessly extracts GPS coordinates, Google Maps URLs, and address labels directly from shared WhatsApp location pins during booking workflows.

### 3. 🌐 Natural Multilingual Adaptation & WhatsApp Styling
- **Zero-Bias Mirroring**: Responds in the patient's language of choice:
  - **English**: Warm, professional, and clear.
  - **Lebanese Arabizi**: Authentic Latin/Franco-Arabe phrasing (`Ahla`, `nhar l tnen`, `zyara 3al beit`, `Salemet albak`).
  - **Arabic Script**: Lebanese Arabic wording.
  - **French**: Formal medical French (`au cabinet`, `visite à domicile`).
- **Clean WhatsApp UX**: Strictly eliminates raw asterisks (`*`, `**`) to ensure pristine, clean typography on mobile WhatsApp.

### 4. 🔄 Multi-Turn Pending Workflow State Machine
- Manages complex conversational workflows gracefully:
  $$\text{awaiting\_visit\_type} \longrightarrow \text{awaiting\_slot} \longrightarrow \text{awaiting\_address} \longrightarrow \text{booked}$$
- Handles interruptions, slot changes mid-flow, voice notes, location pins, and typos with ease.

### 5. 👨‍⚕️ Doctor Direct Phone Sensitivity & Command Desk
- Automatically detects messages sent from the doctor's registered phone number:
  - Commands like `"who is booked today"`, `"my schedule"`, or `"blockout tomorrow"` trigger instant doctor schedule summaries and calendar blocking instead of patient onboarding flows.

### 6. 📊 Interactive Admin Dashboard & Simulator
- **Live Weekly Calendar**: Visual availability grid with real-time slot status (In-Office, Home Visit, Commute Buffer).
- **One-Click Manual Booking & Rescheduling**: Complete administrative control with custom time overrides and cancellation reasons.
- **WhatsApp Interactive Simulator**: Built-in chat client to test conversations, location pins, and bot responses in real-time.
- **Invoicing & Billing**: One-click invoice dispatch over WhatsApp with payment status tracking.

---

## 🛠️ Tech Stack

- **Runtime & Language**: Node.js, TypeScript 5.4, Express
- **AI & NLP**: Google Gemini 2.5 / 3.x Flash (`@google/generative-ai`) with Structured Function Calling
- **Calendar Integrations**: Google Calendar API (`googleapis`) & In-Memory Provider
- **Databases**: SQLite (`better-sqlite3`) with bidirectional **Supabase** cloud replication
- **Messaging**: Twilio WhatsApp API & Interactive Webhook Receiver
- **Frontend**: React 18, TypeScript, Tailwind CSS / Vanilla CSS bundling
- **Testing**: Vitest, Supertest

---

## 📁 Directory Structure

```
.
├── client/                     # Admin dashboard & WhatsApp Simulator (React + TS)
│   ├── src/
│   │   ├── components/         # CalendarGrid, WorkHoursModal, WhatsAppSimulator, etc.
│   │   ├── App.tsx             # Main dashboard application
│   │   └── types.ts            # Frontend TypeScript definitions
│   └── build.js                # Frontend ESBuild bundler script
├── src/
│   ├── admin/                  # Admin API router & session authentication
│   ├── billing/                # Invoice generation, PDF receipts, payment tracking
│   ├── calendar/               # Scheduler engine, buffer calculations, Google Calendar
│   ├── config/                 # Environment variables & runtime settings
│   ├── db/                     # SQLite schema, repositories & Supabase synchronizer
│   ├── gemini/                 # Agent core, system prompts, tool schemas, guardrails
│   ├── notifications/          # Admin WhatsApp notifier & outbound reminders
│   ├── simulator/              # Simulator webhook router
│   ├── twilio/                 # Twilio WhatsApp client, signature verification, gateway
│   └── app.ts                  # Express application factory & middleware
├── tests/                      # 22 automated test suites (108 tests)
└── public/                     # Compiled frontend assets
```

---

## ⚙️ Environment Variables

Create a `.env` file in the root directory:

```env
# Gemini AI
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash

# WhatsApp / Twilio
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_WHATSAPP_NUMBER=whatsapp:+1XXXXXXXXXX
ADMIN_WHATSAPP_NUMBER=whatsapp:+1XXXXXXXXXX

# Security & Admin
ADMIN_SESSION_SECRET=your_secure_admin_secret
PORT=3000
NODE_ENV=production

# Databases
DATABASE_URL=./data/automation.sqlite
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key

# Google Calendar (Optional for Live Production Sync)
GOOGLE_CALENDAR_CLIENT_ID=your_client_id
GOOGLE_CALENDAR_CLIENT_SECRET=your_client_secret
GOOGLE_CALENDAR_ID=your_calendar_id
```

---

## 🧪 Testing & Verification

The codebase is fortified with **108 unit, integration, and E2E tests** across **22 suites**:

```bash
# Run the entire test suite
npm test

# Run tests in watch mode
npx vitest

# Run a specific suite
npx vitest run tests/location_sharing_and_voicenotes.test.ts
```

### Key Test Coverage
- `tests/agent.test.ts`: Function calling, tool determinism, and hallucination resistance.
- `tests/calendar.test.ts`: Slot availability, multi-shift ranges, and commute travel buffers.
- `tests/guardrails_and_reset.test.ts`: Prompt injection, jailbreaks, rate limits, and `#reset` commands.
- `tests/doctor_phone_sensitivity.test.ts`: Doctor administrative commands via WhatsApp.
- `tests/supabase_live.test.ts`: Real-time cloud synchronization and state hydration.
- `tests/location_sharing_and_voicenotes.test.ts`: GPS parsing, location pins, and voice note fallbacks.

---

## 🚀 Getting Started

### 1. Installation
```bash
git clone https://github.com/your-username/CustomerAutomation.git
cd CustomerAutomation
npm install
```

### 2. Build Frontend & TypeScript
```bash
npm run build
```

### 3. Start Development Server
```bash
npm run dev
```

### 4. Access Admin Dashboard
Navigate to `http://localhost:3000/admin?key=YOUR_ADMIN_SECRET` in your browser.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
