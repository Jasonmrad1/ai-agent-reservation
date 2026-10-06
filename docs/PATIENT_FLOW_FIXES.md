# Patient-flow fixes — 2026-10-06

This review focused on ordinary patient conversations after the request to prioritize practical failures. Each bug was reproduced in a failing automated test before applying its fix, checked again after fixing it, and committed separately.

## What changed

| Patient flow | What went wrong | Fix and commit | Regression test |
|---|---|---|---|
| Existing visit, new booking question, then YES | The reminder shortcut confirmed the old visit instead of continuing the booking question | Active booking questions take priority; `6de4450` | [Booking YES](../tests/patient_booking_yes.test.ts) |
| Ask for another appointment, then choose clinic or home | The system forgot “another” and moved the original visit | Preserve additional-visit intent across messages; `68c0ffd` | [Additional clinic and home bookings](../tests/patient_additional_booking.test.ts) |
| STOP, ordinary text, then START in simulator | STOP produced a greeting and did not save consent | Save opt-out, suppress normal replies, and resume on START; `f79a3e7` | [Patient consent](../tests/simulator_patient_consent.test.ts) |
| Doctor takeover or escalation in simulator | The bot continued answering and could act on cancellation text | Honor takeover until explicit resume; urgent symptoms still receive emergency instructions; `cd611c2` | [Patient handoff](../tests/simulator_patient_handoff.test.ts) |
| Ask for availability on a particular date | Offline replies and workflows used fixed September 10 | Use the requested date, or ask for one if missing; `3b0d7bb` | [Requested dates](../tests/simulator_requested_date.test.ts) |
| “Cancel my appointment” | The offline keyword planner treated “appointment” as booking and moved the visit | Cancellation takes priority over booking keywords; `9db01b9` | [Cancellation phrases](../tests/patient_cancellation_phrase.test.ts) |
| “Move my appointment to September 15 at 2pm” | Offline planning used a fixed date and sometimes the wrong time | Recognize moving before booking and parse the requested slot; `c3fc22d` | [Rescheduling phrases](../tests/patient_reschedule_phrase.test.ts) |
| “Book an appointment” or “book a home visit” without details | Offline planning invented a date, time and home address, then saved a booking | Ask for missing details; remove invented booking inputs; `c46465f` | [Missing details](../tests/simulator_missing_booking_details.test.ts) |

## What the tests inspect

These tests submit messages through the HTTP webhook or simulator API and inspect the patient-facing reply and saved state. They check appointment counts, status, date/time, visit type, home address, workflow state, patient consent and conversation status. Cancellation checks that the calendar event disappears. Rescheduling checks that exactly one calendar event remains at the new time. Additional-booking tests check that the original visit stays unchanged.

The clinic-flow tests use the same agent and scheduler as the application, with offline providers. Some booking-question tests explicitly control the mock model's tool selection so the scenario is reproducible. Simulator tests use its default offline planner. No Twilio messages or paid AI calls are made.

## Earlier fixes in this follow-up

Before narrowing the review to everyday flows, seven additional fixes were committed: quiet guardrail replies during takeover, atomic outbound intent/history storage, credential filtering during replication/restore, accurate idempotent send outcomes, inbound/outbound lock recovery, and canonical patient ordering. See [the complete commit index](CHANGELOG_RELIABILITY.md).

## Practical limits

The offline planner recognizes a limited set of phrases; it does not reproduce all possible live-model responses. Passing these scenarios does not mean every possible conversation is covered. The full existing regression suite also covers occupied slots, failed scheduling operations, multiple appointments, reminders and billing. Current verification results are recorded in [VERIFICATION.md](VERIFICATION.md).

Provider activation, real-phone behavior and a controlled live pilot remain separate checks before clinic deployment.
