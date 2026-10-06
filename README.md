# Dr. Ziad clinic automation

A WhatsApp appointment assistant with an administrator dashboard and an offline simulator. It supports booking, moving and cancelling appointments, home visits, reminders, invoices and human takeover.

**Current status: the simulator MVP is available. Live clinic activation still requires provider verification, clinic configuration and a controlled live pilot.** The previous README described the system as production ready too broadly; this document explains the actual changes and limits.

## Did the review find bugs that could make the agent malfunction?

Yes. The most consequential weaknesses were:

| Weakness found | What could happen | What changed |
|---|---|---|
| A reply could imply success after a failed operation | A patient believes an appointment exists when it does not | Booking and mutation replies are tied to successful scheduling results; model-invented changes are rejected |
| Slot checking and booking were separate operations | Two requests could choose the same appointment time | SQLite reserves the slot before calendar calls and keeps uncertain operations reserved |
| Local clinic times were sometimes stored as UTC | Appointments, reminders and dashboard times could shift by hours | New records use real UTC and display in Beirut time; old ambiguous records require review |
| Messages and work existed only in memory in some paths | A crash could lose a request, duplicate a reply or miss a reminder | Durable inbound/outbound jobs, claims and recovery records were added |
| Failed asynchronous HTTP handlers were not consistently caught | Requests could hang or cause an unhandled rejection | Administrator and webhook handlers now forward failures to a controlled error response |
| Simulator startup could use clinic services or data | Testing could affect clinic jobs or contact providers | Simulator mode uses isolated mock services and suspends clinic workers and replication |
| Human takeover could end after ordinary patient text | The bot could interrupt a doctor-patient conversation | Resuming the bot now requires an explicit action |
| Cloud startup recovery could overwrite local records | Appointments and messages could become inconsistent | SQLite is authoritative; cloud restore is an explicit operation into an empty destination |

These fixes reduce known failure paths. Passing tests does not prove that every possible bug or real provider failure has been eliminated.

## Start the MVP without provider credits

1. Install Node **24.14 or later**.
2. Copy `.env.example` to `.env` and set `ADMIN_SESSION_SECRET` to your own administrator password.
3. Keep these settings:

```env
APP_MODE=simulator
NODE_ENV=development
SIMULATOR_LIVE_AI=false
```

4. Run:

```sh
npm ci
npm run dev
```

Open `http://localhost:3000/admin/login`, sign in, then open `/admin/simulator`. For terminal chat, run `npm run chat` while the server is running.

With the default database path, simulator records live in `data/simulator.sqlite`; clinic records live in `data/automation.sqlite`. With a custom path, the simulator database is stored beside the configured clinic database. Simulator messaging and calendar actions are mocked. Its AI is also mocked by default. Testing this way uses no Twilio or Gemini credits. Mock replies do not establish how the real Gemini model will handle every conversation.

## All changes explained by area

### 1. Agent replies and conversation workflows

| Earlier problem | Current behavior |
|---|---|
| Model responses could suggest a booking or move that never occurred | Generated text cannot create an appointment by itself; mutation replies use the actual operation result |
| Tool names, arguments and multiple requested actions were not sufficiently constrained | Tool actions are checked, arguments are bounded and ambiguous multiple actions are rejected before execution |
| A shared location could trigger a confirmation even if scheduling failed | Location bookings confirm only after scheduling succeeds |
| Old or multiple appointments could be selected incorrectly | Upcoming visits are filtered and ambiguous changes require clarification |
| Equal timestamps could make the active workflow unpredictable | Workflow selection uses a deterministic tie-breaker |
| Urgent symptoms could be handled as an ordinary booking, address reply or overlong message | Urgent detection interrupts workflows and takes priority over the message-length guardrail |
| Ordinary text could reactivate a conversation during human takeover | Takeover remains active until explicit resume; `/resume bot` and dashboard controls provide that action |
| Mock doctor-outbound events looked like proof of phone-app integration | Those events are restricted to tests; real takeover uses explicit dashboard controls |
| AI requests could run too long or use an outdated SDK | The agent uses `@google/genai`, configured model choices, bounded output and request timeouts |

This remains a scheduling assistant. Urgent symptom detection is an escalation safeguard, not diagnosis or a substitute for medical care. Voice notes and attachments are not evidence of a verified speech-transcription service.

### 2. Appointments, working hours and travel

| Earlier problem | Current behavior |
|---|---|
| Closed dates, past times or invalid appointment windows could slip through | Scheduling checks clinic hours, future time, lead notice, duration and visit type |
| Overrides could bypass essential safety checks | Overrides relax working hours and lead notice; overlap, invalid-time and past-time checks still apply |
| Simultaneous bookings could race | Reservations are acquired atomically before awaiting the calendar |
| Administrator edits could bypass calendar conflict checks | Edits and moves use the scheduling engine |
| Home-visit travel gaps were inconsistent | Shared buffer rules protect travel between appointments in both directions |
| Weekly hours changes could miss return travel at the end of a shift | Conflict detection includes the home visit's return buffer |
| A zero-minute buffer became 30 minutes | Zero is preserved and invalid administrator settings are rejected |
| New databases ignored the configured default buffer | New databases seed the configured value; existing administrator preferences remain intact |
| Invalid prices or missing patients could reach the calendar | These inputs are checked before writing a calendar event |
| Manual zero duration, unknown visit types or text override flags were accepted | Manual booking validates these inputs |
| Requesting a new time after hours changed altered appointment status prematurely | Outreach leaves the appointment unchanged until an actual move is agreed and executed |

### 3. Timezones and Google Calendar

| Earlier problem | Current behavior |
|---|---|
| Beirut wall time was sometimes treated as UTC | Booking inputs are converted to real UTC; displayed times use `Asia/Beirut` |
| Daylight-saving transitions could create invalid or ambiguous times | Ambiguous/nonexistent booking wall times are rejected |
| All-day events failed when daylight saving skipped midnight | All-day boundaries use the first real instant of the clinic date |
| Missing calendar access could look like an empty calendar or fake success | Disconnected or failed calendar access stops scheduling and reports the failure |
| Event updates could overwrite omitted metadata | Updates use patches to preserve omitted fields |
| Only the first page of calendar events was considered | Calendar reads follow pagination |
| Retrying an event create could duplicate it | Calendar operations use stable event IDs and reconcile already-created events |
| Equivalent timestamps with different timezone offsets were treated as conflicts | Retry comparison checks the actual instant in time |
| A remote write could succeed while the local write failed | A durable operation journal retains the reservation and supports reconciliation |
| A pending cancellation could race with a move | Pending cancellation operations block competing changes |
| A crash before writing a calendar journal could leave a slot blocked forever | Startup releases only abandoned reservations that have no write journal |
| Calendar and OAuth calls could wait indefinitely | Transport requests have explicit timeouts |
| The dashboard and provider read different Google configuration sources | They now use the injected application configuration consistently |

Existing records are not silently reinterpreted. Records with unclear timestamp history are marked for review, and new scheduling is blocked until the reviewed UTC mapping is applied. See [legacy recovery instructions](docs/OPERATIONS.md#legacy-timezone-review).

### 4. WhatsApp delivery and reminders

| Earlier problem | Current behavior |
|---|---|
| An inbound request could be lost before processing | Validated inbound messages are saved as durable jobs before processing |
| A patient lookup failure looked like an invalid phone number | The valid request is persisted first and retained for review if resolution fails |
| A failed outbound reply disappeared | Send intent is stored before contacting the provider |
| Overlapping outbox workers could resend an accepted message | A conditional SQLite claim prevents duplicate worker sends |
| Retrying after an unknown provider outcome could duplicate a message | Uncertain sends require review; definite retryable rejections use controlled retries |
| A late status callback could downgrade delivered/read status | Delivery status updates preserve terminal progress |
| A callback could arrive before the send response was saved | Early callbacks are retained and applied after the provider ID is known |
| Proactive messages ignored the reply window or lacked approved templates | Production sends outside the reply window require a configured approved template and variables |
| Consent or appointment state could change while a message waited | Opt-out, appointment version and reminder expiry are checked before sending |
| Downtime could skip the reminder window | Reminder scans include catch-up windows |
| Two reminder runners could send the same reminder | Persistent claims prevent duplicate sends |
| A recovered reminder send did not update its reminder flag | Outbox recovery updates the matching appointment's reminder state |
| Reminder text claimed the doctor was already travelling | Home-visit wording describes the scheduled visit without inventing travel status |
| Delivery failures could be invisible without callbacks | Clinic production requires the canonical signed status callback URL |

A provider accepting a message is not proof that the patient received it. Delivery callbacks and review alerts provide the later status.

### 5. Security, privacy and administrator access

| Earlier problem | Current behavior |
|---|---|
| Missing verification configuration could allow unsigned webhooks | Inbound and delivery callbacks fail closed when signature verification cannot succeed |
| URL secrets, weak session handling or missing CSRF protection exposed administrator actions | Administrator access uses expiring cookie sessions, login limits and CSRF checks; URL credentials are limited to test compatibility |
| OAuth callbacks lacked sufficient binding to the signed-in user | OAuth state is bound to a session, expires and is consumed once |
| Settings responses could expose credentials | Sensitive settings are filtered from administrator responses |
| Refresh tokens were stored in plaintext | Sensitive settings use authenticated encryption when configured; clinic production requires the encryption key |
| Phone matching could confuse patients or doctor identities | Identities use exact canonical international phone numbers |
| Process logs included patient names, phones, messages or provider payloads | These values are omitted from process logs; protected records remain available to the clinic |
| `#reset` could cancel real appointments without updating the calendar | Destructive reset commands are restricted to testing/simulator use |
| A production configuration could silently fall back to mocks | Clinic production requires provider credentials, persistent storage, canonical HTTPS URLs, callback configuration and security keys |

### 6. Data, billing and recovery

| Earlier problem | Current behavior |
|---|---|
| Fire-and-forget cloud writes could lose updates or apply them out of order | SQLite changes queue replication work atomically and replay it in order |
| Existing records and default rules were missing from a new replica | Replica initialization queues existing data |
| Billing delivery claims were missing from recovery | Billing claims are included in replication |
| Cloud startup hydration could overwrite authoritative data | Automatic hydration is disabled |
| Cloud recovery could restore only part of the data | Explicit restore downloads all pages before writing, requires an empty destination and rolls back invalid relationships |
| New operational tables were missing from the cloud schema | A complete restricted replica schema and generation script were added |
| There was no verified local recovery snapshot | SQLite backups are integrity-checked; existing production databases are backed up before startup migrations |
| Repeated completion/payment actions could duplicate invoices or receipts | Invoice creation, completion and notification claims are deduplicated |
| Invalid amounts or cancelled appointments could be invoiced | Billing validates amounts and appointment state |
| A notification failure could misrepresent the appointment/invoice operation | Billing outcomes distinguish the saved operation from notification delivery |
| Messages used inappropriate branding or assumed payment methods | Billing uses clinic branding and configured payment instructions |

SQLite is authoritative. Supabase is an optional replica. The encryption key must be recoverable separately from the database backup. Old duplicate invoices are flagged for review and are not silently deleted.

### 7. Dashboard, simulator, runtime and deployment

- Dashboard HTTP calls check failures and authentication expiry. Errors are visible instead of being treated as successful updates.
- Alerts, appointments, availability and provider status refresh periodically; connection failures preserve the previously loaded data.
- The dashboard exposes clinic alerts and explicit conversation takeover/resume controls.
- Frontend date handling uses clinic time; incorrect settings URLs and zero-buffer display were fixed.
- Simulator access requires administrator authentication. Browser and terminal clients support the authentication requirement.
- Simulator records, calendar, messaging and default AI are separate from clinic services. Simulator startup does not process clinic queues or initialize cloud replication.
- Simulator storage follows the configured persistent database directory, including custom paths and container volumes.
- Background workers handle failures and avoid overlapping runs. Shutdown waits for work before closing both databases.
- Asynchronous HTTP failures return controlled responses, with review alerts and retained durable jobs where applicable.
- `/health` reports process liveness; `/ready` reports readiness; authenticated `/admin/api/readiness` provides blockers and queue counts.
- Production inbound clinic traffic is gated until activation review and readiness checks pass.
- A container image, persistent-volume compose configuration and offline CI workflow were added.

### 8. Dependencies and testing

- Migrated the deprecated Gemini SDK to `@google/genai` and updated the Google API client.
- Patched vulnerable `proxy-addr`, `qs`, `source-map-js`, UUID dependencies and test worker/mocking packages. Some vulnerable dependencies were removed through upgrades.
- Updated and locked the test runner; dependency-version regressions protect the patched versions.
- Added backend and React TypeScript checks to the production build.
- Cleared live provider credentials before normal test imports and excluded live Supabase tests from the offline suite.
- Stabilized scenario clocks and updated scheduling fixtures for real UTC storage.
- Added regression tests for the failure paths above and committed fixes separately.

The [complete commit index](docs/CHANGELOG_RELIABILITY.md) lists every commit from this reliability work and its associated test files.

## What was verified?

The last implementation verification on **2026-10-06** recorded:

| Check | Result |
|---|---|
| Offline unit and regression suite | **210 passed, 0 failed** |
| Backend and React TypeScript checks | Passed |
| Production application build | Passed |
| Dependency audit, including development packages | **0 reported vulnerabilities** |
| Local compiled-server smoke test | Login, CSRF, readiness, simulator reply and persistence passed |
| Simulator isolation | Clinic patients unchanged and live inbound webhook blocked |
| Backup and restore | Local snapshot integrity, cloud pagination and transactional rollback verified |

These are the recorded implementation results, not a claim that live providers were tested. This README update changes documentation only. See [verification details](docs/VERIFICATION.md).

To repeat the offline checks:

```sh
npm test -- --silent
npm run typecheck
npm run build
npm audit --audit-level=moderate
```

## Remaining weaknesses and limits before live use

1. **Phone integration:** keeping Dr. Ziad's current number in the WhatsApp Business mobile app is not verified through the current Twilio adapter. Mock doctor-outbound tests do not establish coexistence. A compatible provider or an approved separate sender still needs to be selected and tested.
2. **Actual provider behavior:** Google consent, Gemini access/model behavior, real WhatsApp delivery, approved templates and callback routing require a controlled live pilot. That pilot has not been performed.
3. **Legacy data:** ambiguous timestamps, fake calendar event IDs and old duplicate invoices need reviewed correction before activation. No automatic guessing or deletion is performed.
4. **Clinic configuration:** Dr. Ziad must approve working hours, travel buffers, services, prices, payment instructions and patient-facing wording. Current defaults are not evidence of that approval.
5. **Human review:** an unknown send/calendar outcome may pause an operation. Clinic staff must inspect alerts and provider outcomes before replaying it. This is an intentional safeguard against duplicate or false actions.
6. **Hosting:** use one server process with persistent SQLite storage. Multi-instance deployment is not a supported production setup. Backups need restricted access, external encrypted copies, retention and recovery drills.
7. **Container verification:** Docker was unavailable during this work. The image still needs a build and startup check on the deployment machine.
8. **AI and safety coverage:** free mock AI does not test real model understanding. Emergency detection and multilingual replies need clinic review and real-world evaluation. Test success does not guarantee error-free behavior.

## Current technology and useful commands

- Node 24.14+, TypeScript and Express 4.
- React 19 dashboard bundled with esbuild.
- SQLite through Node's `node:sqlite`; optional ordered Supabase replication.
- Google Calendar through `googleapis`; Gemini through `@google/genai`.
- Twilio WhatsApp adapter and isolated mock providers.
- Vitest and Supertest for offline verification.

| Command | Purpose |
|---|---|
| `npm run dev` | Start the development server |
| `npm run chat` | Authenticated terminal simulator |
| `npm test -- --silent` | Offline unit/regression suite |
| `npm run build` / `npm start` | Build and run the server |
| `npm run backup` | Create a verified SQLite snapshot |
| `npm run migrate:times -- reviewed-times.json` | Apply a complete reviewed UTC mapping after backup |
| `npm run restore:replica -- data/recovered.sqlite` | Restore a quiesced replica into a new database |
| `npm run schema:replica` | Generate the cloud replica schema |

For live configuration, recovery procedures and deployment, follow [the operations guide](docs/OPERATIONS.md). Migration and recovery commands require the preparation described there.
