# EMA Forge Cloudflare study host

This template deploys a complete EMA Forge hosting and data-return service into **your Cloudflare account**. It provisions a private R2 bucket, serves the participant study, accepts same-origin session submissions, refuses duplicate overwrites, and provides token-protected study installation and NDJSON export.

## Deploy

1. In EMA Forge, open **Review & Deploy** and download the prepared Cloudflare study file.
2. Use the **Deploy to Cloudflare** button. Choose a unique Worker and R2 bucket name, then set `ADMIN_TOKEN` to a unique random secret of at least 32 characters.
3. In Cloudflare, open the new Worker, go to **Settings → Domains & Routes**, and copy the listed `https://…workers.dev` URL. Return to EMA Forge, paste it under **Hosted study URL**, and choose **Open study admin**.
4. Enter the same token at `/admin` and upload the prepared `.html` file.
5. Open the participant URL shown after installation. Run `/check.html`, confirm the synthetic receipt, and inspect the private R2 bucket before enrollment.
6. Complete a participant session, return to `/admin`, select **Download responses**, and import the downloaded `.ndjson` file directly into EMA Forge **Analyze**.

If `/admin` reports **Unauthorized**, do not recreate the deployment. In Cloudflare, open **Worker → Settings → Variables and Secrets**, add or replace a runtime **Secret** named exactly `ADMIN_TOKEN`, use a value of at least 32 characters, and deploy the settings change. Then enter that exact value at `/admin`. Never put the token value in `wrangler.jsonc` or commit it to Git.

Participant responses are written beneath `sessions/` with a server-controlled `server_receipt` confirming when R2 accepted the object. Connection-test records are written beneath `setup-tests/`. Installed protocol versions are retained beneath `study/versions/`; `study/current.html` is the version served to participants.

The admin token protects study installation and browser exports. Keep it in a password manager. For higher-risk studies, also place `/admin*` behind Cloudflare Access, review retention and abuse controls, use opaque participant IDs, and obtain the required institutional/IRB approval. This template does not make a study compliant by itself.
