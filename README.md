# EMA Forge

Free, open-source builder for web-based ecological momentary assessment (EMA) studies with physiological measurements. Build a survey-only study, a task-only study, or an ordered sequence of both without writing code.

Move from a draft to a functioning study in one workflow: choose a protocol or start blank, arrange questions and optional phone-camera tasks, preview the participant flow, then deploy to your own Cloudflare account. The researcher controls the hosted study, participant links, and private response storage. EMA Forge itself requires no account or persistent project upload.

**[Open the builder](https://emaforge.keeganwhitacre.com/builder.html)** · [Browse the library](https://emaforge.keeganwhitacre.com/library.html) · [Explore Analyze](https://emaforge.keeganwhitacre.com/dashboard.html) · [Read the full guide](https://emaforge.keeganwhitacre.com/readme.html)

## Create a study

1. Enter study details and replace the consent template with approved text.
2. In **Schedule**, set your session times. A new draft begins with one simple mood rating; replace it, add more questions, or add PPG heart-rate capture and physiology tasks as needed. Reorder steps in each session.
3. Preview the participant flow and resolve blocking issues in **Review & Deploy**.
4. Download the prepared Cloudflare study, then deploy the included Worker template. Replace Cloudflare's masked example `ADMIN_TOKEN` with your own 32+ character password. Twilio is optional and can be connected inside Study Admin after deployment. The template enables its `workers.dev` address and provisions private R2 storage.
5. Copy the Worker address Cloudflare displays and paste it into **Review & Deploy**. A bare address such as `my-study.workers.dev` is accepted and normalized to HTTPS. Open `/admin`; a new deployment opens directly on **Install study**. Upload the prepared `-cloudflare-study.html` file.
6. Run `/check.html`. It reports a clear pass or failure and saves its synthetic record under `setup-tests/`, never in participant response counts or exports. Then complete one full session on a supported phone and confirm it appears in Admin.
7. Use `/admin` to monitor responses, run browser-local descriptive analysis, create participant links, manage optional Twilio delivery, and download lossless response and dispatch exports. Independent static hosting and receiver setup remain available under the manual deployment option.

Each Cloudflare deployment hosts **one study**. You can update that study through its protected admin page, but run a different study with a separate Worker and private R2 bucket in the same Cloudflare account. Reusing one Worker for multiple studies would mix response and roster records; the admin page rejects a differently named study.

## Cost and study approval

EMA Forge is free and open source. A small study may fit within [Cloudflare Workers Free limits](https://developers.cloudflare.com/workers/platform/limits/) (currently 100,000 requests per day) and [R2 Standard free usage](https://developers.cloudflare.com/r2/pricing/) (currently 10 GB-month storage, 1 million Class A operations, and 10 million Class B operations monthly). An R2 subscription/checkout must still be activated in the Cloudflare account; usage beyond included allowances may cost money. Optional [Twilio SMS has separate usage and sender charges](https://www.twilio.com/en-us/pricing/messaging). Estimate expected traffic and retention before recruitment.

Cloudflare hosting does not itself make a study IRB approved or suitable for protected health information. Before enrolling participants, give your IRB and institutional security staff the data flow, provider and region, data types, access controls, consent method, retention/deletion plan, and incident procedures. Use an institutionally approved platform when required. See the [HHS IRB review guidance](https://www.hhs.gov/ohrp/education-and-outreach/online-education/human-research-protection-training/lesson-4-irb-review-of-research/index.html).

## Protocol library

Browse the standalone **Protocol Library** to review descriptions, burden, device requirements, validation status, and evidence links before opening an item in the Builder. Complete showcase protocols, reusable survey packs, and physiology presets demonstrate repeated measures, response piping, compound branching, ordered survey/task steps, camera PPG, ePAT, and heartbeat counting.

The library is intentionally simple: every item is versioned, inspectable JSON in [`library/`](library/). Researchers can create a protocol, survey pack, or physiology preset from their currently saved study, add it to **My Library**, download validated JSON, or open a prefilled **Submit for review** request without writing code. Official shared-catalog publication remains human-reviewed through GitHub; submissions are never published automatically. Library JSON may configure surveys and existing built-in tasks, but it cannot execute uploaded JavaScript; new task engines require normal source-code and measurement review. Instrument entries include provenance, permissions, timeframe, scoring, and validation metadata. Included demonstration items are not substitutes for validated instruments or study-specific ethical review.

## One ordered measure flow

The Measures screen treats survey questions, instruction screens, body maps, PPG capture, ePAT, HCT, and every registered task module as peers in one draggable session list. Instructions and physiology tasks create their own participant-screen boundaries automatically. For example, dragging ePAT between two questions is compiled internally as `survey → ePAT → survey`; researchers do not have to build or name those phases. Page breaks are only needed when splitting adjacent response questions across screens.

Adding a future built-in task to the module registry makes it appear in the same Add measure menu and ordered flow. A new task engine still needs its runtime, validation allowlist, settings renderer, simulator, and export tests before it is safe to ship.

The builder itself needs no account or backend. The recommended Cloudflare export embeds the same-host `/submit` receiver automatically, so researchers should not paste a Cloudflare address into the manual webhook field. The deployment lives entirely in the researcher's account; EMA Forge does not receive the deployment token, study file, credentials, or participant responses. Without an approved receiver, participants must download or otherwise return their data; see the [data delivery guide](https://emaforge.keeganwhitacre.com/readme.html#webhook-upload) before running a study.

## Analyze and simulate

Analyze imports Cloudflare NDJSON exports, EMA Forge JSON, or long-format CSV locally in the browser. The deployed `/admin` workspace also provides live descriptive monitoring without returning data to EMA Forge. It provides study-day summaries, participant and item views, response-status-preserving CSV export, rapid-duration review flags, and dedicated ePAT summaries. Observed response files alone cannot establish how many prompts were missed, so completion and delivery metrics remain separate from Twilio's explicit dispatch and delivery-event log.

Use **Simulate study** to generate a deterministic, clearly labeled synthetic dataset from a curated protocol. The simulator follows session order, branching, item missingness, and physiological task envelopes; because it also creates an explicit schedule manifest, Analyze can demonstrate expected-versus-completed metrics. Synthetic exports include a `data_source` column and use a distinct filename. Simulation is for workflow testing, not measurement validation or statistical inference.

## Included measures

- Survey ratings, choices, open text, affect grid, branching, camera-based PPG heart-rate capture, and a source-documented K6 pack.
- ePAT and heartbeat counting (beta), using a phone camera and flashlight for PPG. Check device compatibility and your research protocol before collecting data.
- Implicit Association Task (experimental; not validated for confirmatory research).

If a camera cannot start, physiology screens now offer a retry and an explicit **Continue without measurement** path. The runtime records structured unavailable-task metadata and preserves earlier survey answers; it never fabricates a physiological value. Researchers should still define device eligibility and missing-data procedures before enrollment.

The participant runtime and exported study files are inspectable. Run `npm run check` for syntax checks and protocol tests. See the [methods and limitations](https://emaforge.keeganwhitacre.com/readme.html) for measurement details.

## License and contact

[MIT License](LICENSE). Questions: keeganwhitacre at gmail dot com.
