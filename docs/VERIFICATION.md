# Reliability verification — 2026-10-06

Verified on Windows with Node 24.14.0:

| Check | Result |
|---|---|
| Offline unit and regression suite | 237 passed; 0 failed |
| Backend and React TypeScript checks | Passed |
| Production application build | Passed |
| Dependency audit, including development packages | 0 reported vulnerabilities |
| Local compiled-server smoke test | Login, CSRF, readiness, simulator reply and persistence passed |
| Simulator isolation | Clinic patients unchanged; live webhook blocked; no provider credentials used |
| Cloud restore | Pagination and transactional rollback verified with a mock replica |
| SQLite backup | Snapshot integrity and restored patient data verified |

The latest full suite and build were rerun after eight practical patient-flow fixes and seven preceding reliability fixes. See [the patient-flow report](PATIENT_FLOW_FIXES.md) for HTTP scenarios, replies, saved records and separate commits. No new dependency audit or compiled-server smoke run was performed during this follow-up; those entries above record the earlier verification.

Bug fixes and their regression tests are committed separately. Tests cover webhook signatures, administrator sessions, canonical identities, appointment ambiguity, scheduling races, timezone/DST handling, calendar reconciliation, emergency triage, human takeover, message delivery, opt-outs/templates, reminders, billing, replication, recovery and HTTP failure handling. The normal suite excludes live integration tests and clears provider credentials before application imports.

No live provider pilot, phone migration, external messages or production deployment was performed. Docker is unavailable in this workspace; the image and compose configuration still need a target-machine build and startup check. The offline tests do not verify actual Google consent, approved WhatsApp templates, Gemini model access or phone coexistence.

Follow [the operations guide](OPERATIONS.md) before clinic activation. Keeping Dr. Ziad's current number in the WhatsApp Business mobile app requires a verified compatible provider; the current Twilio adapter does not establish that capability. Existing ambiguous timestamps, fake calendar IDs and duplicate invoices require explicit review. Clinic activation stays gated until configuration and review are complete.
