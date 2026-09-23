# EMA Forge

Free, open-source builder for web-based ecological momentary assessment (EMA) studies with physiological measurements. Build a survey-only study, a task-only study, or an ordered sequence of both without writing code.

**[Open the builder](https://emaforge.keeganwhitacre.com/builder.html)** · [Explore Analyze](https://emaforge.keeganwhitacre.com/dashboard.html) · [Read the full guide](https://emaforge.keeganwhitacre.com/readme.html)

## Create a study

1. Enter study details and replace the consent template with approved text.
2. In **Schedule**, set your session times. A new study begins with an ePAT session; add survey questions, PPG heart-rate capture, or other tasks as needed. Reorder steps in each session.
3. Preview the participant flow and resolve blocking issues in **Review & Deploy**.
4. For automatic data return, download the reference receiver starter in **Review & Deploy**, deploy it to a private R2 bucket, and paste its `/submit` URL into the builder.
5. Export the static-hosting bundle and upload it to an HTTPS host such as GitHub Pages. Open the included `check.html` on the hosted site and confirm the synthetic record reached storage.
6. Use the hosted study URL to generate participant links in **Review & Deploy**. Complete and inspect one full test session before enrollment.

## Protocol library

Open **Protocol Library** from the builder overview to use a complete showcase protocol or add a reusable question pack or physiology task preset to your current study. The included protocols demonstrate repeated measures, response piping, compound branching, ordered survey/task steps, camera PPG, ePAT, and heartbeat counting.

The library is intentionally simple: every item is versioned, inspectable JSON in [`library/`](library/). Community contributions can be proposed through GitHub. Library JSON may configure surveys and existing built-in tasks, but it cannot execute uploaded JavaScript; new task engines require normal source-code and measurement review. Included demonstration items are not substitutes for validated instruments or study-specific ethical review.

The builder itself needs no account or backend. Hosting, automatic data return, and sending prompt links are separate so a lab can use institutionally approved services. Without a receiver, participants must download or otherwise return their data; see the [data delivery guide](https://emaforge.keeganwhitacre.com/readme.html#webhook-upload) before running a study.

## Analyze and simulate

Analyze imports EMA Forge JSON or long-format CSV locally in the browser. It provides study-day summaries, participant and item views, response-status-preserving CSV export, rapid-duration review flags, and dedicated ePAT summaries. Observed response files alone cannot establish how many prompts were missed, so completion and delivery metrics stay unavailable unless a roster plus prompt-event log exists.

Use **Simulate study** to generate a deterministic, clearly labeled synthetic dataset from a curated protocol. The simulator follows session order, branching, item missingness, and physiological task envelopes; because it also creates an explicit schedule manifest, Analyze can demonstrate expected-versus-completed metrics. Synthetic exports include a `data_source` column and use a distinct filename. Simulation is for workflow testing, not measurement validation or statistical inference.

## Included measures

- Survey ratings, choices, open text, affect grid, branching, and camera-based PPG heart-rate capture.
- ePAT and heartbeat counting (beta), using a phone camera and flashlight for PPG. Check device compatibility and your research protocol before collecting data.
- Implicit Association Task (experimental; not validated for confirmatory research).

The participant runtime and exported study files are inspectable. Run `npm run check` for syntax checks and protocol tests. See the [methods and limitations](https://emaforge.keeganwhitacre.com/readme.html) for measurement details.

## License and contact

[MIT License](LICENSE). Questions: keeganwhitacre at gmail dot com.
