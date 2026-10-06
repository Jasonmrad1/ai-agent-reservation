# 🎬 CODEX PRODUCTION BRIEF: HIGH-END CINEMATIC DEMO VIDEO
## Project: Dr. Ziad El Khoury Clinic — WhatsApp & AI Scheduling Engine

You are building the production-grade video demo for the Dr. Ziad WhatsApp Scheduling Agent.
This document contains the exact script, UI action sequences, visual animation specs, modern typography choices, and human-like neural voiceover configuration.

---

## 🎨 1. VISUAL AESTHETICS & MOTION DESIGN SPECS

Do **NOT** use basic system fonts (like Times New Roman, Arial, or generic Segoe UI) and do **NOT** use harsh jump cuts. The video must look like a modern SaaS showcase (Linear / Vercel / Apple product keynote style).

### Typography Palette (Clean, Modern SaaS)
- **Primary Display Font**: `Inter Display`, `Plus Jakarta Sans`, or `SF Pro Display` (Bold weight 700 / Semi-Bold 600 for titles).
- **Secondary Body / Monospace**: `JetBrains Mono` or `Fira Code` for timestamp badges, phone numbers, and code blocks.
- **Badge & Card Subtitles**: Light muted slate (`#94A3B8`) on deep obsidian (`#0F172A`).
- **Accent Highlight**: Emerald green (`#10B981`) for confirmed appointments, vibrant amber (`#F59E0B`) for home visits / commute buffers, and crimson (`#EF4444`) for blocked conflicts.

### Visual Effects & Transition Standards
- **Framing**: Place the 1600x900 browser window centered inside a 1920x1080 canvas (`#090F18` dark theme background) with a subtle radial glow behind the active window.
- **Window Frame**: 16px rounded border radius (`rounded-2xl`) with a 1px border (`#1E293B`) and a 40px soft drop shadow (`shadow-2xl`).
- **Cursor & Clicks**: Smooth cubic-bezier mouse interpolations (`ease-out`) with expanding translucent emerald ripple rings upon clicking.
- **Dynamic Zooms & Pans**:
  - When typing a message: smooth 1.2x zoom centered on the WhatsApp chat container.
  - When inspecting a calendar slot: smooth pan to the calendar card, highlighting the commute buffer and location details.
- **Motion Proof Badges**: Animated pill badges sliding in from top-right:
  `[ ✓ In-Office · 11:00 AM ]`  
  `[ 🏠 Home Visit · 45m Commute Buffer Protected ]`  
  `[ 🛡️ Conflict Intercepted · 0 Double Bookings ]`

---

## 🎙️ 2. VOICE & AUDIO DIRECTIVE (ULTRA-HUMAN VOICE)

- **Voice Model**: Use Microsoft Edge Neural (`en-US-JennyMultilingualNeural` or `en-US-AriaNeural`) or ElevenLabs ("Rachel" / "Adam").
- **Persona**: Warm, confident, calm, articulate tech coordinator (similar to Apple Siri or modern executive product demo narrators).
- **Audio Mix**:
  - **Voice**: Normalized to `-16 LUFS` (loud, crisp, close-mic studio presence).
  - **Ducking**: Whenever the voice speaks, automatically duck background music by `-14 dB`.
  - **Background Track**: Subtle ambient lo-fi synth pad (108 BPM) with a warm sub-bass pulse and gentle arpeggio.

---

## 📜 3. THE 8 SCENE SCRIPT & ACTION TIMELINE

---

### SCENE 1: Real Work Hours & Commute Buffer Setup
- **Visual**: Admin Portal $\rightarrow$ **Work Hours** $\rightarrow$ **Time Inputs Form**.
- **Action**:
  1. Open Work Hours.
  2. Set Monday and Tuesday to `09:30 – 17:30`.
  3. Toggle Home Visit Commute Buffer to **45 mins**.
  4. Click **Save All-Time Default Hours**.
  5. Navigate to **Calendar**; show an empty, clean weekly grid.
- **On-Screen Badge**: `[ ⚙️ Schedule Locked: Mon/Tue 09:30–17:30 · 45m Travel Buffer ]`
- **Voiceover**:
  > *"Every booking starts with ground truth. In the clinic admin portal, the doctor configures working hours from nine-thirty to five-thirty, locking in a mandatory forty-five-minute travel buffer for home visits. These settings strictly govern the AI booking engine."*

---

### SCENE 2: In-Office Booking (Tight & Efficient)
- **Visual**: **Patient Simulator** tab $\rightarrow$ Samir Demo (`+96171091001`).
- **Message**:
  ```text
  Book in clinic Monday October 12 at 11am
  ```
- **Action**:
  1. Send message. Assistant responds with bilingual confirmation.
  2. Switch to **Calendar**, click Samir's card.
  3. Modal displays: `IN-OFFICE · 11:00 AM – 12:00 PM`.
- **On-Screen Badge**: `[ ✓ In-Office Consultation Confirmed · 11:00 AM–12:00 PM ]`
- **Voiceover**:
  > *"Samir requests a clinic visit on Monday at eleven. The assistant verifies availability and confirms the appointment. On the calendar, Samir's visit is locked in with zero travel padding needed, keeping clinic slots compact and efficient."*

---

### SCENE 3: Home Visit Booking + Address Collection + Commute Buffer
- **Visual**: Patient Simulator $\rightarrow$ Maya Demo (`+96171091002`).
- **Message 1**:
  ```text
  Book a home visit Monday October 12 at 1pm
  ```
- **Assistant Reply**:
  > *"Great Maya! Monday October 12 from 1:00 PM to 2:00 PM is available. Please share your home address or location pin so Dr. Ziad knows where to visit you."*
- **Message 2**:
  ```text
  My address is Beirut, Hamra, building 20, floor 2
  ```
- **Action**:
  1. Assistant confirms the home visit.
  2. Switch to **Calendar**, click Maya's card.
  3. Zoom into card details: shows `HOME VISIT`, Hamra address, and visual **45-minute commute window** around the visit.
- **On-Screen Badge**: `[ 🏠 Home Visit Saved · Hamra Address Attached · 45m Commute Buffer ]`
- **Voiceover**:
  > *"Home visits require special precision. When Maya requests a visit at one, the assistant holds the slot but requires her address before finalizing. Once sent, the visit is confirmed with her exact address and a forty-five-minute travel buffer locked to protect doctor transit."*

---

### SCENE 4: Commute Protection in Action (Transit Time Enforcement)
- **Visual**: Patient Simulator $\rightarrow$ Karim Demo (`+96171091004`).
- **Message**:
  ```text
  Book in clinic Monday October 12 at 2pm
  ```
- **Action**:
  1. Send text.
  2. Assistant rejects 2:00 PM because the doctor is traveling back from Maya's Hamra home visit. It offers slots after the 45m travel buffer (e.g., `2:45 PM` or `3:00 PM`).
- **On-Screen Badge**: `[ 🛡️ Commute Buffer Enforced · Doctor in Transit from Hamra ]`
- **Voiceover**:
  > *"Here is the travel buffer in action. Karim asks for an in-clinic visit at two PM, right after Maya's visit. Because Dr. Ziad needs forty-five minutes to drive back from Hamra, the engine blocks the slot and offers safe alternatives that respect actual travel time."*

---

### SCENE 5: Rescheduling (Move Existing Without Ghost Slots)
- **Visual**: Patient Simulator $\rightarrow$ Samir Demo (`+96171091001`).
- **Message**:
  ```text
  Move my appointment to Tuesday October 13 at 2pm
  ```
- **Action**:
  1. Assistant confirms the reschedule.
  2. Switch to **Calendar**: Monday at 11:00 AM is completely freed; Tuesday at 2:00 PM displays Samir's updated visit.
- **On-Screen Badge**: `[ 🔁 Rescheduled · Monday 11:00 AM Freed · Zero Duplicate Cards ]`
- **Voiceover**:
  > *"Plans change. Samir asks to move his visit to Tuesday at two. The assistant identifies his active reservation and updates it cleanly. Monday's eleven AM slot is instantly liberated, with no duplicate bookings left behind."*

---

### SCENE 6: Instant Cancellation & Slot Reclaim
- **Visual**: Patient Simulator $\rightarrow$ Samir Demo.
- **Message**:
  ```text
  cancel my appointment
  ```
- **Action**:
  1. Assistant confirms cancellation.
  2. Switch to **Calendar**: Tuesday at 2:00 PM card disappears immediately.
- **On-Screen Badge**: `[ ✕ Cancelled · Tuesday 2:00 PM Returned to Open Pool ]`
- **Voiceover**:
  > *"When Samir cancels in the chat, the assistant updates the schedule immediately. The calendar clears his card, making Tuesday afternoon instantly open for other patients."*

---

### SCENE 7: Re-Booking & Double-Booking Protection
- **Visual**: Patient Simulator $\rightarrow$ Rana Demo (`+96171091003`).
- **Message 1 (Conflict Attempt)**:
  ```text
  Book in clinic Monday October 12 at 1pm
  ```
- **Assistant Reply**: Rejects 1:00 PM because Maya's home visit is taking place.
- **Message 2 (Alternative Booking)**:
  ```text
  Book in clinic Tuesday October 13 at 3pm
  ```
- **Action**: Assistant confirms Tuesday at 3:00 PM.
- **On-Screen Badge**: `[ 🛡️ Conflict Prevented · Alternative Confirmed for Tuesday ]`
- **Voiceover**:
  > *"When Rana asks for Monday at one, the system protects Maya's slot and turns down the request. Rana chooses Tuesday at three instead, and her booking is locked in instantly."*

---

### SCENE 8: Grand Finale — Full Interactive Calendar Showcase
- **Visual**: Full Screen **Calendar (Week View)**.
- **Display Overview**:
  - **Monday**:
    - `10:00 AM – 11:00 AM`: Samir Demo (In-Office Clinic Visit)
    - `1:00 PM – 2:00 PM`: Maya Demo (Home Visit · Beirut Hamra)
    - Clearly highlighted 45-minute commute margins.
  - **Tuesday**:
    - `3:00 PM – 4:00 PM`: Rana Demo (In-Office Clinic Visit)
  - Interactive clicks into cards displaying live patient phone numbers, GPS addresses, and timestamps.
- **On-Screen Badge**: `[ 🏆 Multi-Patient Calendar · 100% Autonomous & Conflict-Free ]`
- **Voiceover**:
  > *"And here is the complete picture: an organized, multi-patient week. In-office visits scheduled tightly, home visits equipped with patient addresses and protected travel buffers, and zero double-bookings. Complete calendar control, operating twenty-four-seven over WhatsApp."*

---

## 🛠️ 4. HOW TO RUN & COMPILE VIA CLI

```powershell
# Step 1: Execute the browser automated playback and recorder
node scripts/record-simulator-story.mjs

# Step 2: Render neural speech, typography overlays, and animations
node scripts/edit-simulator-story.mjs

# Result output:
# artifacts/demo-simulator/Dr-Ziad-Simulator-Demo.mp4
# artifacts/demo-simulator/Watch-Demo.html
```
