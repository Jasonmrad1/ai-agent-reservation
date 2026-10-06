# Video demo for Dr. Ziad

## Recommended: simulator journey with visible saved results

[Watch the simulator demo](../artifacts/demo-simulator/Dr-Ziad-Simulator-Demo.mp4).

Approximately **2 minutes 12 seconds**, in **1080p**. [Interactive chapter player](../artifacts/demo-simulator/Watch-Demo.html) lets viewers jump between workflows when opened in a browser alongside the MP4.

This version centers on patient conversations. After every step, it opens the actual simulator calendar to show what was saved. The calendar and appointment details use the existing website components, with a new Patient Simulator tab for returning to the same chat.

| Step | What the video visibly checks |
| --- | --- |
| Configure hours through Work Hours | Monday and Tuesday show 09:30–17:30; the simulator uses those saved hours |
| Book Samir at 11 AM | Calendar card and reservation details show Monday at 11 AM |
| Move to Tuesday at 2 PM | Same saved appointment ID; one card at the new time |
| Cancel through chat | No active calendar card remains |
| Book again at 10 AM | A fresh appointment appears; the earlier record remains cancelled |
| Book Maya's home visit | Address is requested first, then saved in home-visit details |
| Request an occupied slot | No extra booking is created; existing cards remain |
| Choose Tuesday at 3 PM | Rana's alternative visit appears alongside the other two |

### What changed in the application

Previously, clicking Calendar or Work Hours from the simulator accessed clinic records. That prevented a continuous simulator demonstration. Those controls now access authenticated sandbox endpoints backed by the same database and scheduling engine as simulator conversations. They use mocked messaging and billing services and cannot enter live OAuth routes. Clinic appointments and settings remain isolated.

The chat stays mounted while switching tabs, preserving the selected patient and conversation. The sandbox context is labelled in the header, and live Google connection controls are hidden there. The clinic dashboard retains its own endpoints and controls.

Four new tests failed before implementation, then passed after the change. They cover booking/moving/cancelling through the sandbox calendar, hours affecting booking while clinic hours stay unchanged, authentication and session CSRF, and client endpoint selection. The full suite passed **283 tests**, and the build passed.

### Video production

The video uses a natural female neural voice (`en-US-JennyNeural`), an original synthesized instrumental score, animated chapter labels, click rings at recorded mouse positions, a moving timeline and saved-result callouts. The score ducks under narration. These are editing elements around the recorded website; the calendar cards and appointment details are real UI output. This is not Apple's Siri voice.

Neural speech is generated using [Edge TTS](https://github.com/andresayac/edge-tts), which needs a network connection. Only the scripted narration is submitted; the application and patient conversations use offline mocks. No Twilio messages are sent. Fictional patients and temporary in-memory databases are used throughout.

Regenerate after building the application:

```powershell
npm install --prefix .demo-tools playwright ffmpeg-static @andresaya/edge-tts --no-audit --no-fund
node .demo-tools/node_modules/playwright/cli.js install ffmpeg
npm run build
node scripts/record-simulator-story.mjs
node scripts/edit-simulator-story.mjs
```

Raw footage, eight calendar proof screenshots, responses, click positions, narration and the original score are saved in `artifacts/demo-simulator`. The recorder checks UI card counts and saved dates/times after each operation, and asserts that the clinic database remains empty.

The final MP4 was decoded completely without errors. Its audio was checked as 48 kHz stereo AAC with audible levels and no clipping. The chapter player's third button was checked to seek to the rescheduling chapter and start playback.

## Website recording with cinematic edits

The current version is approximately **2 minutes 3 seconds**, at **1600 × 900**. It preserves the website's actual layout and controls. Every visible operation is performed through the browser UI. There are no injected captions, invented screens, or changes to the website's appearance. Editing adds fades and cross-dissolves between recorded scenes. English narration is optional.

- [Narrated website video](../artifacts/demo-cinematic/Dr-Ziad-Website-Demo-Narrated.mp4).
- [Website video without narration](../artifacts/demo-cinematic/Dr-Ziad-Website-Demo.mp4).

The sequence starts by changing Monday and Tuesday opening hours to 09:30–17:30 and saving a 45-minute home-visit buffer. It then shows patient messages: booking, cancellation, booking again, rescheduling and collecting a home address. The clinic calendar follows: manual booking, moving a visit, Quick WhatsApp, cancellation and completion.

The application runs with fictional patients, temporary in-memory databases and offline provider mocks. The built-in simulator has its own isolated records and schedule; the clinic hours changed in the opening scene belong to the clinic database. Quick WhatsApp demonstrates mock delivery, not a real message to a phone. Completion generates an invoice in storage; the recording does not add an invoice screen to the product.

The recorder checks saved hours and buffer settings, patient reply patterns and appointment counts, calendar appointment statuses and invoice creation. This demonstrates the recorded workflows, not every possible conversation or live provider integration.

After installing the tools below and building the application, regenerate this version with:

```powershell
node scripts/record-website-demo.mjs
node scripts/edit-website-demo.mjs
node scripts/narrate-demo.mjs artifacts/demo-cinematic Dr-Ziad-Website-Demo.mp4
```

Raw footage, scene screenshots, conversation responses and chapter timings are kept in `artifacts/demo-cinematic`. The scripts alter no application code and perform no hidden booking or schedule mutations. The exported narrated MP4 was decoded completely without errors, and its audio levels were checked to confirm the narration is present.

## Earlier annotated overview

The completed recording is approximately **2 minutes 14 seconds**, at **1600 × 900**.

- [Narrated MP4](../artifacts/demo/Dr-Ziad-MVP-Demo-Narrated.mp4): English computer-generated voice and captions.
- [Caption-only MP4](../artifacts/demo/Dr-Ziad-MVP-Demo.mp4): the same walkthrough without narration.
- [Chapter notes](../artifacts/demo/README.md).

It demonstrates clinic availability and booking, Arabic confirmation, rescheduling, cancellation, home addresses, additional visits, human handoff, STOP/START, credential guardrails, urgent symptoms, manual booking, the clinic calendar, work hours, visit completion, an invoice and a reminder.

## What viewers are seeing

The browser uses the actual compiled local application. Presentation captions identify the recording as an offline MVP demo. All patients are fictitious, both databases are in memory, and AI, messaging and calendar providers are mocked. The simulator and clinic dashboard use separate datasets; simulator bookings are not copied into the clinic calendar.

The final reminder and invoice report is a read-only presentation assembled from outputs actually generated during the run. It is explicitly labelled as a demonstration report rather than a product screen. Work hours are shown for review; editing the schedule is not demonstrated. This is a guided feature overview, not a demonstration of every possible patient conversation or live phone/provider integration.

The recorder checks returned replies and saved booking counts, confirms isolation, and checks that manual completion creates one invoice and that one reminder is accepted by the mock gateway. The exported narrated video is checked for decoding errors. Screenshots and `walkthrough.json` are retained alongside the videos.

## Regenerate

Requires Windows, Node 24.14 or later, installed Google Chrome, and the Microsoft Zira Desktop speech voice for narration.

```powershell
npm install --prefix .demo-tools playwright ffmpeg-static --no-audit --no-fund
node .demo-tools/node_modules/playwright/cli.js install ffmpeg
npm run build
node scripts/record-demo.mjs
node scripts/narrate-demo.mjs
```

The scripts launch a temporary server on an available loopback port, authenticate with a generated demo-only secret, choose future Monday/Tuesday appointment dates and shut down their server and database connections after recording. Caption overlays affect only the recording page. The optional narration is generated locally through Windows speech synthesis.

The recorder follows [Playwright's video-recording workflow](https://playwright.dev/docs/videos), closes its browser context to finalize the recording, then exports an H.264 MP4 through FFmpeg. Tool dependencies are isolated in `.demo-tools`; the application's dependencies are unchanged. Videos, screenshots and tooling are ignored by Git. The scripts and this guide are versioned.

Send the narrated MP4 manually when you are happy with the preview. Nothing has been sent to Dr. Ziad automatically.
