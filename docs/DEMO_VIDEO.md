# Video demo for Dr. Ziad

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
