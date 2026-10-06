# Dr. Ziad MVP and deployment

## Offline MVP

Use Node 24.14 or later. Copy `.env.example` to `.env`, set an administrator password, keep `APP_MODE=simulator`, then run:

```sh
npm ci
npm run dev
```

Open `/admin/login`, then `/admin/simulator`. `npm run chat` provides the terminal simulator. Requests are authenticated. The simulator uses `data/simulator.sqlite`, a mock calendar and mock messages. AI is mocked unless `SIMULATOR_LIVE_AI=true` is explicitly enabled. Leave that flag false for zero provider credits. Main clinic records and simulator records are separate.

## Clinic activation

The software runs on a persistent server; Dr. Ziad opens the protected dashboard from his phone. Run exactly one server process and one replica. SQLite is authoritative and must live on a persistent local volume. Supabase is an optional asynchronous replica, with visible failures; it does not replace SQLite on startup.

Before switching to `APP_MODE=clinic` and `NODE_ENV=production`:

1. Choose the phone integration with Dr. Ziad. The current adapter is Twilio. Keeping the same number in the WhatsApp Business mobile app needs a provider with verified coexistence and outbound-message events. The simulated doctor-outbound fixtures do not establish this capability. Do not migrate or delete his existing mobile WhatsApp account as part of this MVP. A dedicated Twilio sender is another option only if he approves it. See [Twilio number migration requirements](https://www.twilio.com/docs/whatsapp/migrate-numbers-and-senders).
2. Configure real provider credentials and canonical international numbers. Set `PUBLIC_BASE_URL=https://your-clinic-host` and `GOOGLE_CALENDAR_REDIRECT_URI=https://your-clinic-host/admin/oauth2callback`. Register the identical callback with Google. Configure Twilio inbound `/api/webhook/whatsapp` and status `/api/webhook/whatsapp/status`; set `STATUS_CALLBACK_URL` to its complete HTTPS URL.
3. Generate separate random secrets: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Use separate outputs for `ADMIN_SESSION_SECRET` and `SETTINGS_ENCRYPTION_KEY`. Keep the encryption key backed up separately from the database. Changing it requires decrypting/re-encrypting existing tokens or reconnecting Google after a reviewed token reset.
4. Connect Google through `/admin/auth/google` after cookie login. Review clinic hours, home visit buffer, services, prices, payment instructions and languages with Dr. Ziad. Current service/pricing defaults require his review.
5. Obtain approved WhatsApp templates and configure category SIDs and variables. [Twilio requires approved templates outside the 24-hour reply window](https://www.twilio.com/docs/content/send-templates-created-with-the-content-template-builder). Missing templates stop the send and create a review item; consent is checked again before sending.
6. Back up and review existing appointments and duplicate invoices. Resolve legacy timestamp and fake calendar IDs. Test the exact providers, phone, consent flow, approved templates, booking, move, cancellation, reminder, invoice, handoff and webhook retries in a controlled live pilot. This step incurs provider charges and has not been run by the offline tests.
7. Set `CLINIC_SETUP_REVIEWED=true` only after completing that review. Inspect `/admin/api/readiness` while authenticated. `/ready` returns minimal readiness, `/health` process liveness. Review queue counts and clinic alerts daily.

## Server deployment

```sh
npm run build
npm start
```

Or use `docker compose -f deployment/compose.yml up -d --build`. The image runs as `node`, defaults to simulator mode and mounts `/app/data`. Supply a strong administrator password even for a production simulator. The compose port is bound to loopback; configure an HTTPS reverse proxy. Set a 70-second service shutdown grace period. Keep the persistent volume owned by the container user. Container build, hosting, certificates and live callbacks must be verified in the target environment before activation.

Run `npm test -- --silent`, `npm run build` and `npm audit --audit-level=moderate` before deployment. CI runs these without live credentials. Do not run the separate integration suite against clinic credentials. `npm run test:integration` additionally requires explicit live-test approval and a separate test Supabase project.

## Backups and local restore

Production startup backs up existing SQLite before migrations. The background job creates an integrity-checked daily snapshot. `npm run backup` creates one manually, including committed WAL data. Backups contain private data and encrypted secrets: restrict filesystem access and copy snapshots to encrypted storage on another machine. Monitor successful backup age and disk capacity. No automated deletion of old snapshots is performed; establish a clinic-approved retention policy.

For local disaster recovery, stop the service, preserve the damaged original, choose a verified snapshot, copy it to a new database path and set `DATABASE_URL` to that path. Restore the matching encryption key, run integrity and foreign-key checks and inspect readiness. Exercise this procedure on an isolated copy before the live pilot. Pending sends with unknown outcomes require provider review before retrying.

## Legacy timezone review

New storage uses real UTC, displayed in `Asia/Beirut`. Older versions stored some local wall times with a `Z` suffix. The application flags existing unmarked appointments as `legacy-review` and blocks new scheduling instead of guessing.

Stop the server. Export every appointment and compare its times with patient agreements and the real calendar, then produce:

```json
{"reviewed":true,"appointments":[{"id":"appointment-id","start_time":"2026-09-14T07:00:00.000Z","end_time":"2026-09-14T08:00:00.000Z","google_event_id":"verified-calendar-event-id"}]}
```

Include every appointment exactly once, including historical ones. Review reminder claims and queued messages referring to old times; stale queued reminders are suppressed. `npm run migrate:times -- reviewed-times.json` backs up first, validates the complete mapping and commits atomically. The script updates SQLite only: reconcile actual calendar events before approving the mapping. Ambiguous DST wall times need a human decision.

## Supabase replica and explicit cloud recovery

Apply `deployment/replica-schema.sql` only to a new empty Supabase destination. It mirrors local columns as text/numbers, enables RLS and grants access only to the service role. Existing cloud boolean/timestamp schemas need a separately reviewed migration or a new destination. Keep the service role key on the server. Default rules, existing records, mutations and billing claims are queued; credential settings are excluded. Cloud tables intentionally omit foreign keys to allow replay of historical updates/deletes; local restore validates relationships.

If cloud schema or connectivity fails, the oldest failing job remains queued and raises an alert. Fix the failure, then let ordered replication catch up. Do not discard jobs to conceal an error.

For cloud recovery, stop all source writes and wait for the replica backlog to reach zero. Quiesce replication so paged reads describe a stable snapshot. Run `npm run restore:replica -- data/recovered.sqlite` with a new nonexistent target filename. It downloads all pages before writing and rolls back broken relationships. Select the recovered path explicitly, reconnect excluded provider credentials and review interrupted jobs before serving patients.

## Uncertain operations and human control

Calendar operations retain reservations and retry with stable event IDs. Unknown message-send outcomes are marked `review` and are not automatically resent. Compare job IDs and provider SIDs with Twilio before making an explicit retry decision. Definitive rate-limit failures can retry automatically. Startup marks interrupted processing for review rather than re-running medical or booking actions blindly.

Use dashboard takeover before manual messaging and explicit resume after handoff. Patient `YES`, `help` or ordinary booking text does not resume the bot; `/resume bot` is explicit. Emergency symptoms interrupt workflows and direct patients to emergency assistance; this is scheduling software, not medical diagnosis. For Lebanon, the [Lebanese Red Cross lists 140 for emergency medical services](https://www.redcross.org.lb/get-in-touch/).

Process logs omit patient identities and message contents. Patient records, operational details and alerts remain in the authenticated dashboard/database. Configure access and retention for these records and backups with the clinic.
