# Heavy booking end-to-end review

## How the system was exercised

42 new automated checks submit patient messages through the HTTP webhook or authenticated simulator API. These tests use the default offline AI planner, without overriding its tool selection. They exercise the actual agent, scheduler, SQLite repositories, durable messaging and mock calendar. No Twilio credits or paid model calls are used.

The tests verify both replies and saved results. The webhook matrix also compares every active appointment with the calendar: event count, event ID, start time and end time must match. Simulator lifecycle tests inspect history and verify clinic records and the real gateway remain untouched.

| Test file | Checks | Coverage |
|---|---:|---|
| [Conversation matrix](../tests/booking_conversation_matrix.test.ts) | 24 | Exact dates/times; closed, past and outside-hours slots; home location; missing visit type; confirmation; additional visits and appointment selection; moving/cancelling; conflicting moves; switching from home to clinic; changed home time; rebooking a cancelled slot; repeated cancellation; calendar failure; failed message delivery recovery |
| [Simulator lifecycle](../tests/simulator_booking_lifecycle.test.ts) | 2 | Clinic and home booking, confirmation, rescheduling, cancellation, history and sandbox isolation |
| [Confirmation languages](../tests/patient_confirmation_languages.test.ts) | 11 | English, French, Arabizi and Arabic; punctuation; choosing which of two appointments to confirm |
| [Address acknowledgements](../tests/home_address_acknowledgements.test.ts) | 4 | Thank-you/affirmative messages must not become home addresses; a subsequent real address completes booking |
| [First home request](../tests/home_first_message_location.test.ts) | 1 | First-message home request persists its date/time before a separate location pin arrives |

Concurrency tests include ten different patients competing for the same slot and twenty simultaneous deliveries of one booking webhook. They check one appointment, one patient confirmation and agreement with the calendar.

## Bugs found and fixed separately

| Bug reproduced before fixing | Change | Commit |
|---|---|---|
| First home request asked for an address but forgot its selected slot; the location reply produced a greeting | Persist the awaiting-address workflow before returning the prompt; preserve clean text addresses | `0d45bdd` |
| “thank you”, “yes please”, “ok thanks” and “merci beaucoup” became home addresses and triggered booking | Keep collecting the address after acknowledgements | `91d15e8` |
| Arabic confirmations left the appointment booked rather than confirmed | Share confirmation recognition between reminders and appointment selection | `b711daf` |

The broader conversation and simulator coverage is committed in `e6504fa`. Each bug regression was run before its patch and failed on the incorrect saved state, then passed after the patch.

## Limits

This expands coverage of ordinary booking flows; it does not prove that every possible patient phrase or provider failure is covered. The offline planner is deterministic and has a smaller language range than the live AI. The clock is fixed to September 1, 2026 for repeatable appointment scenarios. Actual model behavior, provider credentials and phone integration require a controlled live pilot.

See [verification results](VERIFICATION.md) for the complete suite/build and [earlier patient-flow fixes](PATIENT_FLOW_FIXES.md) for the previous review.
