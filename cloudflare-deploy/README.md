# EMA Forge Cloudflare study host

This template deploys a complete EMA Forge study workspace into **your Cloudflare account**. It provisions private R2 storage, serves the participant study, refuses duplicate response overwrites, and provides token-protected installation, monitoring, browser-local analysis, exports, participant rosters, and optional Twilio delivery.

## Deploy

1. In EMA Forge, open **Review & Deploy** and download the prepared Cloudflare study file.
2. Use **Create new study host** and choose a unique Worker name. The `STUDY_DATA` R2 binding deliberately has no fixed bucket name: Cloudflare automatically provisions a separate bucket for each new Worker and keeps it linked on subsequent deployments. Cloudflare may show the example `ADMIN_TOKEN` as dots or stars; replace it with your own unique password of at least 32 characters. Twilio is connected later inside Study Admin.
   Confirm the new Worker's `STUDY_DATA` binding points to its own bucket before installing. If Study Admin reports a storage conflict on first sign-in, check the binding and select a new empty bucket; never clear or reuse another study's bucket. Older deployments made from a template with a fixed bucket name may still need a one-time binding correction.
3. The template enables its `workers.dev` route. Copy the address Cloudflare shows after deployment. Return to EMA Forge and paste either `your-study.workers.dev` or the full `https://…` URL under **Hosted study URL**.
4. Choose **Open admin**, enter the same token, and upload the prepared `.html` file. A new deployment opens directly on the install screen.
5. Open `/check.html`. It reports pass/fail in plain language and stores the synthetic check under `setup-tests/`; setup checks do not count as participant sessions. Then complete a real phone session and confirm it appears in Overview and Analyze.
6. Complete a participant session, return to `/admin`, and confirm that the Overview and Analyze tabs show the stored session. Download raw NDJSON whenever you need a lossless research archive or external analysis.

## Update a study or Worker

- **Change questions or schedules for the same study:** Download a fresh prepared HTML file and upload it to the **existing** `/admin` page. The Worker URL and R2 bucket stay the same; previous response files remain in R2. Do not use **Create new study host** again.
- **Use a new EMA Forge Worker feature:** In EMA Forge **Review & Deploy → Update an existing Worker’s code**, download the self-contained Worker update. In Cloudflare **Workers & Pages**, select that Worker, choose **Edit code**, replace its code with the downloaded file, and deploy. Check that its `STUDY_DATA` R2 binding, admin secret, and `workers.dev` URL still match the original deployment. Then install a newly prepared study HTML file if the new feature requires it. Never delete the Worker or bind a different bucket as a routine code update. The raw `worker.mjs` imports `admin-page.mjs` and is not the standalone code-editor download.
- **Run a separate study:** Use **Create new study host** again with a different Worker name. Cloudflare provisions a separate R2 bucket for that Worker using the unnamed `STUDY_DATA` binding. Confirm the new binding before installing. Never attach an existing study's bucket to the new Worker.

The current deployment template has one active study per Worker. This keeps each study's responses, credentials, and access controls apart, but Worker code updates must be applied to each Worker. A shared multi-study host would require separate study-scoped authorization and storage controls; it is not provided by this template.

If `/admin` reports **Unauthorized**, do not recreate the deployment. In Cloudflare, open **Worker → Settings → Variables and Secrets**, add or replace a runtime **Secret** named exactly `ADMIN_TOKEN`, use a value of at least 32 characters, and deploy the settings change. Then enter that exact value at `/admin`. Never put the token value in `wrangler.jsonc` or commit it to Git.

## Optional Twilio delivery

The study works without Twilio; participant links can always be distributed manually. Cloudflare's Deploy button currently treats every listed secret as required, so Twilio is not part of the initial deployment form. To enable SMS:

1. Open **Install study** in `/admin`, enter your Twilio Account SID and Auth Token, plus a sending number or Messaging Service SID, and choose **Connect Twilio**. The values are encrypted in private R2 storage using a key derived from your admin token and are not shown again. Changing that token requires reconnecting Twilio. Cloudflare runtime secrets added directly to the Worker also remain supported.
2. In Twilio, set the incoming-message webhook to `https://<your-study-host>/twilio/incoming` using POST. Twilio delivery-status callbacks are attached automatically to outbound messages.
3. Open **Participants & delivery**, upload or enter the roster, send a test message, and only then enable scheduled messaging. Twilio automatically sends opaque `/j/...` links rather than exposing participant routing parameters in the SMS.

The Worker runs every five minutes. It interprets the EMA Forge schedule in each participant's IANA timezone, intersects optional onboarding schedule preferences with protocol weekdays, chooses a stable randomized minute within each window, and deduplicates on participant/day/window. Twilio API acceptance and later handset-delivery callbacks remain separate audit states.

Phone numbers are retained in the private roster object and are not copied into response files or dispatch exports. Use opaque participant IDs, restrict administrative access, and follow the approved consent, security, and retention plan.

## Participant invite links

The **Participants & delivery** screen can create a study-scoped invite link for a selected participant, study day, and session. These links use an opaque `/j/<token>` path, redirect internally to the required EMA routing parameters, inherit the configured response-window expiry, and can be revoked from Study Admin. They are not a public or general-purpose URL-shortening service.

## Stored records

- Participant responses: `sessions/`, with a server-controlled `server_receipt`.
- Synthetic connection checks: `setup-tests/`.
- Installed protocol versions: `study/versions/`; the participant app is `study/current.html`.
- Researcher roster and messaging settings: `admin/`.
- Auditable prompt events: `dispatch/`; Twilio SID routing metadata is under `twilio/`.
- Opaque participant-link mappings: `links/`. Revoked and expired links no longer redirect into the study.

The Admin Analyze tab calculates descriptive operational summaries inside the browser. It does not send participant data to emaforge.org or another central service, and it does not replace confirmatory analysis in R, Python, or other validated workflows.

The admin token protects installation, roster access, browser analysis, settings, and exports. Keep it in a password manager. For higher-risk studies, also place `/admin*` behind Cloudflare Access, review retention and abuse controls, use opaque participant IDs, and obtain the required institutional/IRB approval. This template does not make a study compliant by itself.
