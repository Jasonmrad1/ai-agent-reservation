# Complete reliability change index

This index covers the review and implementation ending at commit `9746285`, before the explanatory README rewrite. It includes bug fixes, regression coverage, deployment work and documentation. Entries are chronological; one entry can include several tests for the same fix.

Start with [the README](../README.md) for plain-English descriptions of the weaknesses, fixes and remaining limits. Use [the operations guide](OPERATIONS.md) for setup and recovery. The recorded verification was 210 passing tests, a passing build and zero reported dependency vulnerabilities; see [verification details](VERIFICATION.md).

## How to inspect a change

Run `git show <commit>` to see the exact changes in that entry. Test links below point to the current regression files. An empty test column identifies a commit without changed test files; it does not claim that the commit was independently validated against live providers. Documentation and deployment files have different verification limits, explained in the README.

## Commit-by-commit changes

| Commit | Change | Associated test files |
|---|---|---|
| `fdf5584` | fix(tests): isolate offline suites from live provider credentials | [supabase_live.test.ts](../tests/supabase_live.test.ts)<br>[test_isolation.test.ts](../tests/test_isolation.test.ts) |
| `f4888c7` | fix(simulator): authenticate and isolate sandbox services | [simulator_isolation.test.ts](../tests/simulator_isolation.test.ts) |
| `0ee81fc` | fix(config): reject incomplete production clinic setup | [config_validation.test.ts](../tests/config_validation.test.ts) |
| `8e3090b` | fix(webhooks): verify inbound and status requests fail closed | [webhook_security.test.ts](../tests/webhook_security.test.ts) |
| `d63973c` | fix(admin): protect sessions OAuth and sensitive settings | [admin_security.test.ts](../tests/admin_security.test.ts) |
| `a79a84a` | fix(identity): use exact canonical patient and doctor identities | [calendar.test.ts](../tests/calendar.test.ts)<br>[identity_security.test.ts](../tests/identity_security.test.ts) |
| `eb804e4` | fix(workflows): break equal timestamp ties deterministically | [workflow_ordering.test.ts](../tests/workflow_ordering.test.ts) |
| `34c3dec` | fix(appointments): filter upcoming visits and disambiguate changes | [appointment_disambiguation.test.ts](../tests/appointment_disambiguation.test.ts)<br>[upcoming_selection.test.ts](../tests/upcoming_selection.test.ts) |
| `0f0a3db` | fix(scheduling): reject closed past and invalid appointment windows | [scheduler_validation.test.ts](../tests/scheduler_validation.test.ts) |
| `4e22e0d` | fix(scheduling): reserve slots atomically before calendar calls | [atomic_booking.test.ts](../tests/atomic_booking.test.ts) |
| `fc6ab6f` | fix(travel): share weekly buffer rules and protect both travel directions | [weekly_buffer_consistency.test.ts](../tests/weekly_buffer_consistency.test.ts) |
| `a672013` | fix(timezone): store real UTC and render clinic times in Beirut | [agent.test.ts](../tests/agent.test.ts)<br>[appointment_state_machine.test.ts](../tests/appointment_state_machine.test.ts)<br>[calendar.test.ts](../tests/calendar.test.ts)<br>[e2e.test.ts](../tests/e2e.test.ts)<br>[e2e_master.test.ts](../tests/e2e_master.test.ts)<br>[heavy_scenarios.test.ts](../tests/heavy_scenarios.test.ts)<br>[location_sharing_and_voicenotes.test.ts](../tests/location_sharing_and_voicenotes.test.ts)<br>[multilingual_smooth_replies.test.ts](../tests/multilingual_smooth_replies.test.ts)<br>[shifts_commute.test.ts](../tests/shifts_commute.test.ts)<br>[timezone_and_past_slots.test.ts](../tests/timezone_and_past_slots.test.ts)<br>[timezone_storage.test.ts](../tests/timezone_storage.test.ts)<br>[weekly_buffer_consistency.test.ts](../tests/weekly_buffer_consistency.test.ts)<br>[weekly_schedule_slots.test.ts](../tests/weekly_schedule_slots.test.ts) |
| `34fd389` | fix(calendar): fail closed and preserve remote metadata | [calendar_fail_closed.test.ts](../tests/calendar_fail_closed.test.ts) |
| `2cd3405` | fix(calendar): journal uncertain operations and reconcile reserved slots | [calendar_fail_closed.test.ts](../tests/calendar_fail_closed.test.ts)<br>[calendar_reconciliation.test.ts](../tests/calendar_reconciliation.test.ts) |
| `c0de804` | fix(appointments): validate edits against calendar conflicts | [edit_conflicts.test.ts](../tests/edit_conflicts.test.ts) |
| `3a325cf` | fix(workflows): confirm location bookings only after successful scheduling | [location_booking_failure.test.ts](../tests/location_booking_failure.test.ts) |
| `7c4b97b` | fix(triage): intercept urgent symptoms before booking workflows | [medical_safety_triage.test.ts](../tests/medical_safety_triage.test.ts)<br>[urgent_workflows.test.ts](../tests/urgent_workflows.test.ts) |
| `6321dd6` | fix(agent): validate actions and reject model-invented mutations | [ai_action_safety.test.ts](../tests/ai_action_safety.test.ts)<br>[appointment_state_machine.test.ts](../tests/appointment_state_machine.test.ts)<br>[e2e_master.test.ts](../tests/e2e_master.test.ts)<br>[heavy_scenarios.test.ts](../tests/heavy_scenarios.test.ts)<br>[location_sharing_and_voicenotes.test.ts](../tests/location_sharing_and_voicenotes.test.ts) |
| `e1dba0a` | fix(handoff): require explicit resume after human takeover | [doctor_copresence.test.ts](../tests/doctor_copresence.test.ts)<br>[e2e_master.test.ts](../tests/e2e_master.test.ts)<br>[handoff_resume.test.ts](../tests/handoff_resume.test.ts)<br>[human_handoff_whatsapp_link.test.ts](../tests/human_handoff_whatsapp_link.test.ts) |
| `b7053c9` | fix(messaging): persist inbound jobs and recover failed outbound replies | [durable_messaging.test.ts](../tests/durable_messaging.test.ts) |
| `009876b` | fix(delivery): preserve terminal status against out-of-order callbacks | [delivery_status_ordering.test.ts](../tests/delivery_status_ordering.test.ts) |
| `6338851` | fix(whatsapp): enforce reply windows and configured approved templates | [whatsapp_delivery_policy.test.ts](../tests/whatsapp_delivery_policy.test.ts) |
| `4bc15dd` | fix(reminders): catch up after downtime and claim sends atomically | [reminder_recovery.test.ts](../tests/reminder_recovery.test.ts) |
| `ec391e7` | fix(replication): keep SQLite authoritative and queue cloud changes atomically | [replication_safety.test.ts](../tests/replication_safety.test.ts) |
| `dc97c0e` | fix(recovery): replace implicit hydration with explicit transactional restore | [restore_safety.test.ts](../tests/restore_safety.test.ts) |
| `9e1fd78` | fix(outreach): keep appointment status unchanged until an agreed move | [outreach_status.test.ts](../tests/outreach_status.test.ts)<br>[reminders_billing_admin.test.ts](../tests/reminders_billing_admin.test.ts)<br>[reschedule_conflict.test.ts](../tests/reschedule_conflict.test.ts) |
| `f16a799` | fix(billing): validate completion and deduplicate invoices and receipts | [billing_idempotency.test.ts](../tests/billing_idempotency.test.ts) |
| `18a8e9d` | fix(dashboard): check failed requests and expose live clinic alerts | [dashboard_http.test.ts](../tests/dashboard_http.test.ts) |
| `bc1db53` | fix(gemini): migrate to maintained SDK and bound configured model requests | [ai_action_safety.test.ts](../tests/ai_action_safety.test.ts)<br>[gemini_sdk.test.ts](../tests/gemini_sdk.test.ts) |
| `1235984` | fix(deps): patch proxy address IP spoofing vulnerability | [dependency_security.test.ts](../tests/dependency_security.test.ts) |
| `9c76301` | fix(deps): patch HTTP query parser denial-of-service vulnerabilities | [dependency_security.test.ts](../tests/dependency_security.test.ts) |
| `705d564` | fix(deps): patch source-map parser event-loop denial of service | [dependency_security.test.ts](../tests/dependency_security.test.ts) |
| `9d52cac` | fix(deps): remove vulnerable UUID through maintained Google client | [dependency_security.test.ts](../tests/dependency_security.test.ts) |
| `c531ba2` | fix(deps): patch vulnerable test worker and mocker packages | [dependency_security.test.ts](../tests/dependency_security.test.ts) |
| `65e6705` | fix(messaging): claim outbox sends atomically across workers | [durable_messaging.test.ts](../tests/durable_messaging.test.ts) |
| `15d0726` | fix(settings): preserve zero travel buffer and validate changes | [admin_security.test.ts](../tests/admin_security.test.ts) |
| `e2c6087` | fix(webhooks): restrict destructive reset commands to testing | [clinic_reset_security.test.ts](../tests/clinic_reset_security.test.ts)<br>[guardrails_and_reset.test.ts](../tests/guardrails_and_reset.test.ts) |
| `8bb4722` | fix(calendar): lock appointments during pending cancellations | [calendar_reconciliation.test.ts](../tests/calendar_reconciliation.test.ts) |
| `d3ea1ce` | fix(calendar): use injected OAuth configuration consistently | [admin_security.test.ts](../tests/admin_security.test.ts) |
| `2e171f5` | fix(replication): bootstrap existing records and billing claims | [replication_safety.test.ts](../tests/replication_safety.test.ts) |
| `d33c6c5` | fix(recovery): create verified SQLite backups before production startup | [backup_recovery.test.ts](../tests/backup_recovery.test.ts) |
| `8c5b0d7` | fix(timezone): flag legacy appointment timestamps for explicit review | [legacy_timezone.test.ts](../tests/legacy_timezone.test.ts) |
| `5754d35` | fix(config): require persistent storage and canonical production URLs | [config_validation.test.ts](../tests/config_validation.test.ts) |
| `1f15890` | fix(readiness): expose protected diagnostics and block unsafe legacy scheduling | [readiness.test.ts](../tests/readiness.test.ts) |
| `c9f422f` | fix(runtime): await background workers before closing databases | [background_shutdown.test.ts](../tests/background_shutdown.test.ts) |
| `9cb3ab2` | fix(privacy): exclude patient content and provider payloads from logs | [log_privacy.test.ts](../tests/log_privacy.test.ts) |
| `c569ae8` | fix(security): encrypt sensitive settings with authenticated encryption | [settings_encryption.test.ts](../tests/settings_encryption.test.ts) |
| `15000a8` | fix(triage): prioritize emergency replies over message guardrails | [urgent_workflows.test.ts](../tests/urgent_workflows.test.ts) |
| `4ea93fd` | fix(timezone): apply reviewed UTC mappings with backup and rollback | [legacy_migration.test.ts](../tests/legacy_migration.test.ts) |
| `1690b8a` | fix(simulator): authenticate terminal requests and check HTTP failures | [simulator_client.test.ts](../tests/simulator_client.test.ts) |
| `c7e6fdc` | fix(appointments): validate price and patient before calendar writes | [scheduler_mutation_validation.test.ts](../tests/scheduler_mutation_validation.test.ts) |
| `da959c1` | fix(travel): include return travel in weekly schedule conflict checks | [weekly_travel_conflicts.test.ts](../tests/weekly_travel_conflicts.test.ts) |
| `da1504b` | fix(admin): reject invalid manual duration and override values | [manual_booking_validation.test.ts](../tests/manual_booking_validation.test.ts) |
| `3c081f8` | fix(calendar): reconcile event retries by instant instead of timestamp spelling | [google_calendar_transport.test.ts](../tests/google_calendar_transport.test.ts) |
| `cc66268` | fix(calendar): respect all-day conflicts when DST skips midnight | [calendar_dst.test.ts](../tests/calendar_dst.test.ts) |
| `c336432` | fix(calendar): bound API and OAuth transport requests | [google_calendar_transport.test.ts](../tests/google_calendar_transport.test.ts) |
| `e342ef7` | fix(reminders): record reminders accepted during outbox recovery | [reminder_recovery.test.ts](../tests/reminder_recovery.test.ts) |
| `bcea887` | test(recovery): verify paginated cloud restore and transactional rollback | [restore_safety.test.ts](../tests/restore_safety.test.ts) |
| `e543b1b` | fix(simulator): default to offline mode and suspend clinic provider workers | [offline_startup.test.ts](../tests/offline_startup.test.ts) |
| `d39b693` | fix(simulator): keep sandbox storage on the configured persistent volume | [simulator_volume.test.ts](../tests/simulator_volume.test.ts) |
| `243925d` | fix(deployment): reject live inbound traffic until clinic activation review | [live_activation_gate.test.ts](../tests/live_activation_gate.test.ts) |
| `b1e7b0c` | fix(handoff): restrict simulated phone takeover events to tests | [clinic_reset_security.test.ts](../tests/clinic_reset_security.test.ts)<br>[doctor_copresence.test.ts](../tests/doctor_copresence.test.ts) |
| `d7143f4` | fix(delivery): require a canonical signed production status callback | [config_validation.test.ts](../tests/config_validation.test.ts) |
| `0d085e4` | fix(scheduling): recover abandoned pre-write reservations on restart | [reservation_restart.test.ts](../tests/reservation_restart.test.ts) |
| `8689159` | fix(replication): provide complete restricted cloud replica schema | [replica_schema.test.ts](../tests/replica_schema.test.ts) |
| `8b75f9f` | fix(deployment): add persistent non-root server image and offline CI | [deployment_artifacts.test.ts](../tests/deployment_artifacts.test.ts) |
| `c1fb6e2` | docs(operations): document offline MVP activation and reviewed recovery | No test-file changes in this commit |
| `16f9e4c` | fix(config): seed configured travel buffer without overwriting preferences | [configured_buffer.test.ts](../tests/configured_buffer.test.ts) |
| `acf90ad` | fix(http): forward asynchronous failures without crashing or hanging requests | [async_http_failures.test.ts](../tests/async_http_failures.test.ts) |
| `e9de597` | fix(messaging): persist inbound requests before patient lookup | [inbound_storage_failure.test.ts](../tests/inbound_storage_failure.test.ts) |
| `9746285` | docs(verification): record final offline checks and live deployment limits | No test-file changes in this commit |

## Follow-up fixes

The latest patient-flow review is explained in [PATIENT_FLOW_FIXES.md](PATIENT_FLOW_FIXES.md). Full regression result: 237 passed, zero failed; application build passed.

| Commit | Change | Regression tests |
|---|---|---|
| `3a60ef1` | fix(handoff): suppress guardrail replies during human takeover | [handoff_guardrails.test.ts](../tests/handoff_guardrails.test.ts) |
| `ed60cd0` | fix(outbox): store send intent and audit message atomically | [outbound_atomic_intent.test.ts](../tests/outbound_atomic_intent.test.ts) |
| `cfc857d` | fix(replica): exclude credentials from queued changes and restore | [credential_replica_filter.test.ts](../tests/credential_replica_filter.test.ts) |
| `c5c3fcf` | fix(outbox): reject duplicate jobs without provider acceptance | [outbound_idempotency_outcome.test.ts](../tests/outbound_idempotency_outcome.test.ts) |
| `fcb6ca6` | fix(outbox): release worker lock when database claims fail | [outbound_claim_recovery.test.ts](../tests/outbound_claim_recovery.test.ts) |
| `2567738` | fix(inbox): release patient lock after database claim failure | [inbound_claim_recovery.test.ts](../tests/inbound_claim_recovery.test.ts) |
| `f85a6fd` | fix(inbox): serialize canonical patient phone numbers | [inbound_phone_ordering.test.ts](../tests/inbound_phone_ordering.test.ts) |
| `6de4450` | fix(booking): keep affirmative replies in the active booking flow | [patient_booking_yes.test.ts](../tests/patient_booking_yes.test.ts) |
| `68c0ffd` | fix(booking): preserve additional visit intent across patient messages | [patient_additional_booking.test.ts](../tests/patient_additional_booking.test.ts) |
| `f79a3e7` | fix(simulator): persist and honor patient messaging consent | [simulator_patient_consent.test.ts](../tests/simulator_patient_consent.test.ts) |
| `cd611c2` | fix(simulator): honor doctor takeover and explicit bot resume | [simulator_patient_handoff.test.ts](../tests/simulator_patient_handoff.test.ts) |
| `3b0d7bb` | fix(simulator): check the date requested by the patient | [simulator_requested_date.test.ts](../tests/simulator_requested_date.test.ts) |
| `9db01b9` | fix(simulator): prioritize cancellation over appointment keywords | [patient_cancellation_phrase.test.ts](../tests/patient_cancellation_phrase.test.ts) |
| `c3fc22d` | fix(simulator): reschedule to the requested patient slot | [patient_reschedule_phrase.test.ts](../tests/patient_reschedule_phrase.test.ts) |
| `c46465f` | fix(simulator): ask for missing booking details without inventing them | [simulator_missing_booking_details.test.ts](../tests/simulator_missing_booking_details.test.ts) |

## Heavy booking end-to-end review

See [BOOKING_E2E_REVIEW.md](BOOKING_E2E_REVIEW.md) for 42 additional checks and three reproduced bugs. The full suite has 279 passing tests and zero failures.

| Commit | Change | Regression tests |
|---|---|---|
| `0d45bdd` | fix(booking): persist first home request before collecting location | [home_first_message_location.test.ts](../tests/home_first_message_location.test.ts) |
| `91d15e8` | fix(booking): reject acknowledgements as home addresses | [home_address_acknowledgements.test.ts](../tests/home_address_acknowledgements.test.ts) |
| `b711daf` | fix(confirmation): recognize Arabic replies and appointment choices | [patient_confirmation_languages.test.ts](../tests/patient_confirmation_languages.test.ts) |
| `e6504fa` | test(e2e): exercise booking conversations concurrency and simulator lifecycle | [booking_conversation_matrix.test.ts](../tests/booking_conversation_matrix.test.ts), [simulator_booking_lifecycle.test.ts](../tests/simulator_booking_lifecycle.test.ts) |
