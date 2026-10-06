# Dr. Ziad simulator: editable demo and manual test script

This is the script used for the latest simulator video. Edit the messages, narration and checkpoints below to plan your next recording or manual test.

## Before you start

- Sign in, then open `/admin/simulator`.
- Confirm the header says **Sandbox calendar**. Use its **Calendar**, **Work Hours** and **Patient Simulator** tabs throughout this walkthrough.
- Use future dates. The recorded example uses **Monday, October 12, 2026** and **Tuesday, October 13, 2026**. Replace both dates consistently if they have passed.
- Appointment times below are clinic time, **Asia/Beirut**.
- Use a clean demo sandbox or unused fictional patient phone numbers. Expected calendar totals assume the sandbox starts empty. If other test patients already have bookings, count the three demo patients separately.
- Keep each patient's phone unchanged while booking, moving and cancelling their visit. Changing the phone selects a different conversation.
- Use **Patient Simulator** to return from the calendar to the chat. Wait for each reply before sending the next message.

### Demo patients

| Patient | Test phone | Purpose |
| --- | --- | --- |
| Samir Demo | `+96171091001` | Booking, moving, cancellation and booking again |
| Maya Demo | `+96171091002` | Home visit and saved address |
| Rana Demo | `+96171091003` | Occupied slot and alternative booking |

These are fictional demo identities. For repeat testing, use new test phones or reset only these demo conversations before starting. Reset Chat cancels that patient's active test bookings; it does not clear everyone else's sandbox records.

## 1. Configure the schedule

**Feature:** hours configured through the actual website govern simulator bookings.

**Actions**

1. Open **Work Hours**.
2. Select **All-Time Default Template**.
3. Select **Time Inputs Form**.
4. Set Monday to **09:30–17:30**.
5. Set Tuesday to **09:30–17:30**.
6. Choose **45 mins** for the home-visit commute buffer.
7. Click **Save All-Time Default Hours**.
8. Open **Calendar** and navigate to the week containing your chosen Monday and Tuesday.

**Check**

- [ ] Monday and Tuesday show the saved opening hours.
- [ ] Reopening Work Hours shows the same hours and 45-minute buffer.
- [ ] Calendar is empty before these demo bookings: **0 active demo visits**.

**Narration used**

> Start with the real work hours page. Set Monday and Tuesday to nine thirty until five thirty, then save. These hours now govern the simulator calendar.

## 2. Book through the simulator

**Feature:** a patient message creates a saved clinic appointment.

**Actions**

1. Open **Patient Simulator**.
2. Select **Samir Demo**, phone `+96171091001`.
3. Send:

```text
Book in clinic October 12 at 11am
```

4. Read the reply, then open **Calendar**.
5. Click Samir's appointment card.

**Check**

- [ ] Reply confirms the booking with the correct name, date and time.
- [ ] Reservation details show **Monday, October 12, 11:00 AM–12:00 PM**.
- [ ] Visit type is **IN-OFFICE**.
- [ ] There is one Samir card: **1 active demo visit**.

**Narration used**

> Samir asks for a clinic visit on Monday at eleven. The assistant confirms. Now open the calendar: the saved visit is there, with the same patient and time.

## 3. Move the existing appointment

**Feature:** rescheduling updates the existing booking without creating a duplicate.

**Actions**

1. Close the reservation details and return to **Patient Simulator**.
2. Keep Samir's phone selected.
3. Send:

```text
Move my appointment to October 13 at 2pm
```

4. Open **Calendar**, then Samir's card.

**Check**

- [ ] Reply confirms the new date and time.
- [ ] Reservation details show **Tuesday, October 13, 2:00 PM–3:00 PM**.
- [ ] The old Monday 11 AM card is gone.
- [ ] There is still only one Samir card: **1 active demo visit**.

The automated recorder also checks that the saved appointment ID remains the same. The UI checks above demonstrate the visible result.

**Narration used**

> Samir changes plans and asks for Tuesday at two. Watch the same appointment move. The calendar shows the new date and time, with no duplicate booking.

## 4. Cancel and inspect the calendar

**Feature:** cancellation removes the visit from the active calendar.

**Actions**

1. Close the details and return to Samir's chat.
2. Send:

```text
cancel my appointment
```

3. Open **Calendar**.

**Check**

- [ ] Reply confirms cancellation.
- [ ] Samir's Tuesday 2 PM card is gone.
- [ ] No active Samir booking remains: **0 active demo visits**.

Cancellation preserves the cancelled record in storage. It removes the active calendar card rather than deleting the booking's history.

**Narration used**

> Next, Samir cancels in the chat. The assistant confirms cancellation. Back in the calendar, his card has disappeared and the slot is free again.

## 5. Book again after cancellation

**Feature:** a new booking succeeds after the previous visit was cancelled.

**Actions**

1. Return to Samir's chat.
2. Send:

```text
Book in clinic October 12 at 10am
```

3. Open **Calendar**, then Samir's card.

**Check**

- [ ] A fresh clinic visit is confirmed.
- [ ] Details show **Monday, October 12, 10:00 AM–11:00 AM**.
- [ ] The cancelled Tuesday visit has not reappeared.
- [ ] Calendar contains **1 active demo visit**.

This step uses a different time from the cancelled visit. It demonstrates booking again after cancellation; testing reuse of the exact cancelled slot is an additional check listed below.

**Narration used**

> Samir books a new visit on Monday at ten. Open the calendar again. A fresh booking is saved, while the cancelled visit stays cancelled.

## 6. Book a home visit with an address

**Feature:** a home visit requires an address and saves it with the appointment.

**Actions**

1. Open **Patient Simulator**.
2. Change the patient to **Maya Demo**, phone `+96171091002`.
3. Send:

```text
Book a home visit October 12 at 1pm
```

4. Wait for the address request. Then send:

```text
My address is Beirut, Hamra, building 20, floor 2
```

5. Open **Calendar**, then Maya's card.

**Check**

- [ ] The first reply asks for an address and does not confirm a home visit yet.
- [ ] After the address message, the assistant confirms the home visit.
- [ ] Details show **Monday, October 12, 1:00 PM–2:00 PM** and **HOME VISIT**.
- [ ] Saved address is **Beirut, Hamra, building 20, floor 2**.
- [ ] Samir's visit remains: **2 active demo visits**.

The recorded offline reply initially says it could not confirm because an address is required. Its wording is more apologetic than the narration; the important checks are that no visit is booked before the address and that the supplied address is saved afterward. The video opens the calendar after address completion. For manual testing, you can also check it between the two messages: Maya should have no card yet.

**Narration used**

> Maya requests a home visit at one. The assistant asks for her address before booking. After she shares it, the calendar shows a home visit with that address saved.

## 7. Try an occupied slot

**Feature:** another patient cannot take an already booked time.

**Actions**

1. Open **Patient Simulator**.
2. Change the patient to **Rana Demo**, phone `+96171091003`.
3. Send:

```text
Book in clinic October 12 at 10am
```

4. Open **Calendar**.

**Check**

- [ ] The assistant says the requested slot is unavailable.
- [ ] No appointment is confirmed for Rana.
- [ ] Samir's Monday 10 AM card remains unchanged.
- [ ] Maya's home visit remains unchanged.
- [ ] Calendar still contains **2 active demo visits**.

**Narration used**

> What if another patient asks for Samir's time? Rana requests Monday at ten. The assistant rejects the occupied slot. The calendar still has only the two existing visits.

## 8. Choose an alternative

**Feature:** the patient can book an available alternative after a rejected slot.

**Actions**

1. Return to Rana's chat.
2. Send:

```text
Book in clinic October 13 at 3pm
```

3. Open **Calendar**, then Rana's card.
4. Close the details to finish on the full calendar.

**Check**

- [ ] Reply confirms the alternative.
- [ ] Details show **Tuesday, October 13, 3:00 PM–4:00 PM**, **IN-OFFICE**.
- [ ] No rejected Monday booking appears for Rana.
- [ ] Calendar now contains **3 active demo visits**.

**Narration used**

> Rana chooses Tuesday at three instead. Her booking is confirmed and appears in the calendar. Three saved visits, all created through the simulator. Test freely, with no Twilio messages.

## Final expected calendar

| Patient | Date | Time | Visit type |
| --- | --- | --- | --- |
| Samir Demo | Monday, October 12 | 10:00–11:00 AM | In-office |
| Maya Demo | Monday, October 12 | 1:00–2:00 PM | Home visit, address saved |
| Rana Demo | Tuesday, October 13 | 3:00–4:00 PM | In-office |

## Additional manual checks you can add

These are suggestions for extending the script. They are **not scenes in the current video**, and their exact conversations have not been run as part of this recording.

- [ ] **Hours enforcement:** a fresh patient requests Monday at 8 AM. No appointment should be saved outside the configured hours.
- [ ] **Exact cancelled-slot reuse:** after step 4, a fresh patient requests Tuesday at 2 PM. It should be available again. Cancel this extra test booking before continuing the original script.
- [ ] **Failed move preserves the original:** after step 8, ask Samir to move to Rana's occupied Tuesday 3 PM slot. The request should fail and Samir should remain on Monday at 10 AM.
- [ ] **Address required:** inspect the calendar before supplying Maya's address. No Maya visit should exist yet.
- [ ] **Travel buffer enforcement:** after Maya's booking, a fresh patient requests a visit immediately next to it. Check that the configured travel buffer prevents a conflicting booking.
- [ ] **Refresh persistence:** reload the simulator page, select the same patient phone and navigate to the demo week. Verify the chat history and calendar records still exist in your running application. The video's temporary server is intentionally discarded after recording.

Use a clean sandbox for each added scenario or write down its effect on the expected appointment totals.

## Your changes and test notes

```text
Demo Monday:
Demo Tuesday:
Hours and buffer:
Patient names and test phones:
Steps/messages to change:
Features to add or remove:
Narration changes:
Failed step:
Message sent:
Actual reply:
Calendar result:
Expected result:
```

## Where the recording follows this script

- [Browser recorder](../scripts/record-simulator-story.mjs): UI actions, patient messages, dates and saved-result assertions.
- [Video editor](../scripts/edit-simulator-story.mjs): neural narration generation, music and animations.
- [Video guide](DEMO_VIDEO.md): output files and regeneration commands.

In the recorder, each `scene(title, detail, ...)` supplies a chapter title, narration text and browser actions. Dates are chosen dynamically as a future Monday and the following Tuesday. Changing this document alone does not automatically change those actions. You can edit this document and give it back to me to update the recording accordingly.

When changing narration, regenerate its cached chapter audio as well; the editor reuses existing `artifacts/demo-simulator/narration/chapter-N.mp3` files. When changing actions or visual effects, make a fresh recording/export rather than using `--reuse-clips`.
