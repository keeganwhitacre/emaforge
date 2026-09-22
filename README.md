# EMA Forge

Free, open-source builder for web-based ecological momentary assessment (EMA) studies with physiological measurements. Build a survey-only study, a task-only study, or an ordered sequence of both without writing code.

**[Open the builder](https://emaforge.keeganwhitacre.com/builder.html)** · [Read the full guide](https://emaforge.keeganwhitacre.com/readme.html)

## Create a study

1. Enter study details and replace the consent template with approved text.
2. In **Schedule**, set your session times. A new study begins with an ePAT session; add survey questions, PPG heart-rate capture, or other tasks as needed. Reorder steps in each session.
3. Preview the participant flow and resolve blocking issues in **Review & Deploy**.
4. Export the static-hosting bundle and upload it to an HTTPS host such as GitHub Pages. Use the resulting URL to generate participant links in **Review & Deploy**.

The builder needs no account or backend. Hosting and sending prompt links are separate steps. Without a configured webhook, participants must download or otherwise return their data; see the [data delivery guide](https://emaforge.keeganwhitacre.com/readme.html#webhook-upload) before running a study.

## Included measures

- Survey ratings, choices, open text, affect grid, branching, and camera-based PPG heart-rate capture.
- ePAT and heartbeat counting (beta), using a phone camera and flashlight for PPG. Check device compatibility and your research protocol before collecting data.
- Implicit Association Task (experimental; not validated for confirmatory research).

The participant runtime and exported study files are inspectable. Run `npm run check` for syntax checks and protocol tests. See the [methods and limitations](https://emaforge.keeganwhitacre.com/readme.html) for measurement details.

## License and contact

[MIT License](LICENSE). Questions: keeganwhitacre at gmail dot com.
