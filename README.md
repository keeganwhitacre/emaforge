# EMA Forge

Free, open-source builder for web-based ecological momentary assessment (EMA) studies with physiological measurements. Build a survey-only study, a task-only study, or an ordered sequence of both without writing code.

**[Open the builder](https://emaforge.keeganwhitacre.com/builder.html)** · [Browse the library](https://emaforge.keeganwhitacre.com/library.html) · [Explore Analyze](https://emaforge.keeganwhitacre.com/dashboard.html) · [Read the full guide](https://emaforge.keeganwhitacre.com/readme.html)

## Create a study

1. Enter study details and replace the consent template with approved text.
2. In **Schedule**, set your session times. A new study begins with an ePAT session; add survey questions, PPG heart-rate capture, or other tasks as needed. Reorder steps in each session.
3. Preview the participant flow and resolve blocking issues in **Review & Deploy**.
4. Download the prepared Cloudflare study, deploy the included Worker template, and install the file at the new Worker's token-protected `/admin` page. Cloudflare provisions the private R2 bucket and hosts the participant app in the researcher's account.
5. Open the live `/check.html` page and confirm its synthetic record reached R2.
6. Use the hosted study URL to reveal the participant, administration, and connection-check destinations in **Review & Deploy**. Complete one full test session, then use `/admin` to monitor responses, run browser-local descriptive analysis, manage an optional Twilio roster, and download lossless response and dispatch exports. Independent static hosting and receiver setup remain available under the manual deployment option.

## Protocol library

Browse the standalone **Protocol Library** to review descriptions, burden, device requirements, validation status, and evidence links before opening an item in the Builder. Complete showcase protocols, reusable survey packs, and physiology presets demonstrate repeated measures, response piping, compound branching, ordered survey/task steps, camera PPG, ePAT, and heartbeat counting.

The library is intentionally simple: every item is versioned, inspectable JSON in [`library/`](library/). Researchers can create a protocol, survey pack, or physiology preset from their currently saved study, add it to **My Library**, download validated JSON, or open a prefilled **Submit for review** request without writing code. Official shared-catalog publication remains human-reviewed through GitHub; submissions are never published automatically. Library JSON may configure surveys and existing built-in tasks, but it cannot execute uploaded JavaScript; new task engines require normal source-code and measurement review. Instrument entries include provenance, permissions, timeframe, scoring, and validation metadata. Included demonstration items are not substitutes for validated instruments or study-specific ethical review.

## One ordered measure flow

The Measures screen treats survey questions, instruction screens, body maps, PPG capture, ePAT, HCT, and every registered task module as peers in one draggable session list. Instructions and physiology tasks create their own participant-screen boundaries automatically. For example, dragging ePAT between two questions is compiled internally as `survey → ePAT → survey`; researchers do not have to build or name those phases. Page breaks are only needed when splitting adjacent response questions across screens.

Adding a future built-in task to the module registry makes it appear in the same Add measure menu and ordered flow. A new task engine still needs its runtime, validation allowlist, settings renderer, simulator, and export tests before it is safe to ship.

The builder itself needs no account or backend. The Cloudflare deployment lives entirely in the researcher's account; EMA Forge does not receive the deployment token, study file, or participant responses. Hosting, automatic data return, and sending prompt links remain separable so a lab can use institutionally approved services. Without a receiver, participants must download or otherwise return their data; see the [data delivery guide](https://emaforge.keeganwhitacre.com/readme.html#webhook-upload) before running a study.

## Analyze and simulate

Analyze imports Cloudflare NDJSON exports, EMA Forge JSON, or long-format CSV locally in the browser. The deployed `/admin` workspace also provides live descriptive monitoring without returning data to EMA Forge. It provides study-day summaries, participant and item views, response-status-preserving CSV export, rapid-duration review flags, and dedicated ePAT summaries. Observed response files alone cannot establish how many prompts were missed, so completion and delivery metrics remain separate from Twilio's explicit dispatch and delivery-event log.

Use **Simulate study** to generate a deterministic, clearly labeled synthetic dataset from a curated protocol. The simulator follows session order, branching, item missingness, and physiological task envelopes; because it also creates an explicit schedule manifest, Analyze can demonstrate expected-versus-completed metrics. Synthetic exports include a `data_source` column and use a distinct filename. Simulation is for workflow testing, not measurement validation or statistical inference.

## Included measures

- Survey ratings, choices, open text, affect grid, branching, camera-based PPG heart-rate capture, and a source-documented K6 pack.
- ePAT and heartbeat counting (beta), using a phone camera and flashlight for PPG. Check device compatibility and your research protocol before collecting data.
- Implicit Association Task (experimental; not validated for confirmatory research).

The participant runtime and exported study files are inspectable. Run `npm run check` for syntax checks and protocol tests. See the [methods and limitations](https://emaforge.keeganwhitacre.com/readme.html) for measurement details.

## License and contact

[MIT License](LICENSE). Questions: keeganwhitacre at gmail dot com.
