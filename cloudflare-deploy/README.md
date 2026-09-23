# EMA Forge Cloudflare study host

This template deploys a complete EMA Forge hosting and data-return service into **your Cloudflare account**. It provisions a private R2 bucket, serves the participant study, accepts same-origin session submissions, refuses duplicate overwrites, and provides token-protected study installation and NDJSON export.

## Deploy

1. In EMA Forge, open **Review & Deploy** and download the prepared Cloudflare study file.
2. Use the **Deploy to Cloudflare** button. Choose a unique Worker and R2 bucket name, then set `ADMIN_TOKEN` to a unique random secret of at least 32 characters.
3. Open `https://YOUR-WORKER.workers.dev/admin`, enter the same token, and upload the prepared `.html` file.
4. Open the participant URL shown after installation. Run `/check.html`, confirm the synthetic receipt, and inspect the private R2 bucket before enrollment.

Participant responses are written beneath `sessions/`. Connection-test records are written beneath `setup-tests/`. Installed protocol versions are retained beneath `study/versions/`; `study/current.html` is the version served to participants.

The admin token protects study installation and browser exports. Keep it in a password manager. For higher-risk studies, also place `/admin*` behind Cloudflare Access, review retention and abuse controls, use opaque participant IDs, and obtain the required institutional/IRB approval. This template does not make a study compliant by itself.
