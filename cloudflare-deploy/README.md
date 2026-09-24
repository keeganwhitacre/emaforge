# EMA Forge Cloudflare study host

This template deploys a complete EMA Forge study workspace into **your Cloudflare account**. It provisions private R2 storage, serves the participant study, refuses duplicate response overwrites, and provides token-protected installation, monitoring, browser-local analysis, exports, participant rosters, and optional Twilio delivery.

## Deploy

1. In EMA Forge, open **Review & Deploy** and download the prepared Cloudflare study file.
2. Use the **Deploy to Cloudflare** button. Choose a unique Worker and R2 bucket name, then set `ADMIN_TOKEN` to a unique random secret of at least 32 characters. A useful Worker naming pattern is `ema-forge-<short-study-name>`.
3. In Cloudflare, open the new Worker, go to **Settings → Domains & Routes**, and copy the listed `https://…workers.dev` URL. Return to EMA Forge, paste it under **Hosted study URL**, and choose **Open study admin**.
4. Enter the same token at `/admin` and upload the prepared `.html` file.
5. Open the participant URL shown after installation. Run `/check.html`, confirm the synthetic receipt, and inspect the private R2 bucket before enrollment.
6. Complete a participant session, return to `/admin`, and confirm that the Overview and Analyze tabs show the stored session. Download raw NDJSON whenever you need a lossless research archive or external analysis.

If `/admin` reports **Unauthorized**, do not recreate the deployment. In Cloudflare, open **Worker → Settings → Variables and Secrets**, add or replace a runtime **Secret** named exactly `ADMIN_TOKEN`, use a value of at least 32 characters, and deploy the settings change. Then enter that exact value at `/admin`. Never put the token value in `wrangler.jsonc` or commit it to Git.

## Optional Twilio delivery

The study works without Twilio; participant links can always be distributed manually. To enable SMS:

1. Open **Worker → Settings → Variables and Secrets** in Cloudflare.
2. Add encrypted secrets named `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and either `TWILIO_FROM_NUMBER` or `TWILIO_MESSAGING_SERVICE_SID`.
3. In Twilio, set the incoming-message webhook to `https://<your-study-host>/twilio/incoming` using POST. Twilio delivery-status callbacks are attached automatically to outbound messages.
4. Return to `/admin`, open **Participants & delivery**, upload or enter the roster, send a test message, and only then enable scheduled messaging.

The Worker runs every five minutes. It interprets the EMA Forge schedule in each participant's IANA timezone, intersects optional onboarding schedule preferences with protocol weekdays, chooses a stable randomized minute within each window, and deduplicates on participant/day/window. Twilio API acceptance and later handset-delivery callbacks remain separate audit states.

Phone numbers are retained in the private roster object and are not copied into response files or dispatch exports. Use opaque participant IDs, restrict administrative access, and follow the approved consent, security, and retention plan.

## Stored records

- Participant responses: `sessions/`, with a server-controlled `server_receipt`.
- Synthetic connection checks: `setup-tests/`.
- Installed protocol versions: `study/versions/`; the participant app is `study/current.html`.
- Researcher roster and messaging settings: `admin/`.
- Auditable prompt events: `dispatch/`; Twilio SID routing metadata is under `twilio/`.

The Admin Analyze tab calculates descriptive operational summaries inside the browser. It does not send participant data to emaforge.org or another central service, and it does not replace confirmatory analysis in R, Python, or other validated workflows.

The admin token protects installation, roster access, browser analysis, settings, and exports. Keep it in a password manager. For higher-risk studies, also place `/admin*` behind Cloudflare Access, review retention and abuse controls, use opaque participant IDs, and obtain the required institutional/IRB approval. This template does not make a study compliant by itself.
