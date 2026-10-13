# Wanderlust Stage 2 Analysis — Build 10

Build 10 adds a distinct On Market Status block above Preliminary ARV. It displays the current asking price and source when the subject is actively listed, or “Not Currently Listed For Sale” when it is off market. The list price is reference-only and is explicitly excluded from the ARV calculation. Build 10 preserves Build 9 stable reopen behavior, server-recorded archive timestamps, autosave, timing, PDF, and email delivery.

## Components

- `app/`, `components/`, and `worker/`: Cloudflare application source
- `deployment/google-apps-script/Code.gs`: Stage 2 Apps Script backend v1.0.10
- `CLOUDFLARE-DEPLOYMENT.md`: Cloudflare update steps
- `deployment/DEPLOYMENT.md`: Apps Script update and acceptance-test steps

## Production build

Run `npm ci` followed by `npm run build`. The Worker continues to require the existing `STAGE2_API_URL` text variable and `STAGE2_SUBMISSION_TOKEN` secret.
