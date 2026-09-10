# Wanderlust Stage 2 Analysis — Build 8

Build 8 adds automatic Google Drive draft checkpoints, elapsed research timing, and plain-language phase indicators while preserving Build 7 PDF and email delivery.

## Components

- `app/`, `components/`, and `worker/`: Cloudflare application source
- `deployment/google-apps-script/Code.gs`: Stage 2 Apps Script backend v1.0.8
- `CLOUDFLARE-DEPLOYMENT.md`: Cloudflare update steps
- `deployment/DEPLOYMENT.md`: Apps Script update and acceptance-test steps

## Production build

Run `npm ci` followed by `npm run build`. The Worker continues to require the existing `STAGE2_API_URL` text variable and `STAGE2_SUBMISSION_TOKEN` secret.
