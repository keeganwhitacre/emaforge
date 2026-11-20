# EMA Forge

EMA Forge is a free, open-source toolkit for building web-based ecological momentary assessment (EMA) studies. Arrange surveys and optional tasks, preview them, and host the study in your own Cloudflare account. Participants open a link on their phone. Your team manages the study and responses in Study Admin.

[Try a sample check-in](https://emaforge.keeganwhitacre.com/sample.html) · [Open Builder](https://emaforge.keeganwhitacre.com/builder.html) · [Browse the Protocol Library](https://emaforge.keeganwhitacre.com/library.html) · [Open Analyze](https://emaforge.keeganwhitacre.com/dashboard.html)

## Run a study

| What you want to do | Where to start |
| --- | --- |
| Build, host, and test your first study | [Illustrated setup guide](https://emaforge.keeganwhitacre.com/quickstart.html) |
| Move from a successful pilot to real enrollment | [Enrollment checklist](https://emaforge.keeganwhitacre.com/enrollment.html) |
| Update a running study, set up SMS, or use another host | [Hosting and deployment reference](https://emaforge.keeganwhitacre.com/readme.html#hosting) |
| Import results or simulate a dataset | [Analyze guide](https://emaforge.keeganwhitacre.com/readme.html#dashboard) |

1. **Build.** Choose a daily mood check-in, an example protocol, or an empty session. Edit consent, measures, and the schedule, then preview. Drafts are saved in the current browser. Use **Download Backup** to keep an editable copy.
2. **Host and pilot.** In **Review & Deploy**, download the prepared HTML and create a Cloudflare study host. Install the HTML in Study Admin and run a pilot on a phone. The host serves the study and Study Admin, and stores responses in private R2 storage. Pilot responses are excluded from research exports.
3. **Enroll and monitor.** After the enrollment checklist, use **Participants & delivery** to create participant links. Send them manually or connect Twilio for scheduled SMS (beta). Watch responses arrive in Study Admin.

Each Cloudflare study uses its own Worker and R2 bucket. To update an existing study, export again from the same Builder draft and install the new file on the same host. You can update the Worker’s software separately and keep its URL and stored responses. See the [deployment template notes](cloudflare-deploy/README.md).

## Measures and reusable protocols

Mix questions, instruction screens, affect grids, body maps, and tasks in one ordered session. Instructions and tasks create their own screens. Use page breaks to split adjacent questions. Survey questions can use branching and response piping.

- **Protocol Library.** Browse complete study designs, question packs such as K6, and task presets. Each item documents its source, burden, requirements, and validation status. You can create and download your own library JSON or submit it for human review. See the [catalog and contribution notes](library/README.md).
- **Phone-camera tasks.** Camera PPG, ePAT, and heartbeat counting require device testing and study-specific piloting. If the camera fails, participants can retry or continue without measurement. IAT is experimental. See the [measurement methods](https://emaforge.keeganwhitacre.com/readme.html#ppg-capture).
- **Place context.** With participant permission, hosted lookups send coordinates to the study Worker and selected government services. Responses store area-level categories and lookup status. An uploaded GeoJSON can also be matched on the phone. See [sources, privacy details, and available indicators](https://emaforge.keeganwhitacre.com/readme.html#place-context).

## Analyze and simulate

In Study Admin **Analyze**, choose **Download analysis file**. Open it in [detailed Analyze](https://emaforge.keeganwhitacre.com/dashboard.html) to inspect responses against their protocol versions and export long-format CSV. Files are processed in your browser. Raw NDJSON, per-session JSON, and compatible EMA Forge CSV can also be imported.

Twilio dispatch and delivery records are available as a separate export. Use them alongside observed responses to investigate missed prompts. **Simulate study** generates a clearly labeled synthetic dataset with expected prompts, so you can test the analysis workflow before collecting data.

## Cost and study approval

EMA Forge is free. The recommended hosting setup requires GitHub and Cloudflare accounts and R2 billing activation. Check [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [R2 pricing](https://developers.cloudflare.com/r2/pricing/), and [optional Twilio charges](https://www.twilio.com/en-us/pricing/messaging) when estimating your costs.

Review your consent process, hosting and storage, access controls, data retention, and participant device support with your institution before enrollment. See the [enrollment checklist](https://emaforge.keeganwhitacre.com/enrollment.html) and [privacy reference](https://emaforge.keeganwhitacre.com/readme.html#privacy-model).

## Development and citation

Run `npm run check` for syntax, HTML, and protocol checks. See [repository architecture](https://emaforge.keeganwhitacre.com/readme.html#under-the-hood) and [potential improvements](https://emaforge.keeganwhitacre.com/readme.html#roadmap).

[MIT License](LICENSE). To cite EMA Forge, use GitHub’s **Cite this repository** menu or [CITATION.cff](CITATION.cff). Contact Keegan Whitacre at keeganwhitacre at gmail dot com.
