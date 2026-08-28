# Wanderlust Stage 2 Analysis — Cloudflare Build 6

This repository deploys the approved Stage 2 Analysis frontend as a Cloudflare
Worker and keeps the Apps Script submission token on the server. Cloudflare
Access supplies the same email one-time-passcode login used by the other
Wanderlust tools.

## Values required in Cloudflare

- `STAGE2_API_URL` — the existing Google Apps Script `/exec` URL. This is not a secret.
- `STAGE2_SUBMISSION_TOKEN` — the same `SUBMISSION_TOKEN` stored in Apps Script. Encrypt this value.

Do not put either value in source code or commit a populated `.env` file.

## GitHub and Cloudflare deployment

1. Create a new private GitHub repository named `wanderlust-stage-two-analysis`.
2. Upload every file and folder from this package to the repository root.
3. In Cloudflare, open **Workers & Pages** and select **Create application**.
4. Select **Get started** beside **Import a repository**.
5. Choose the new GitHub repository.
6. Keep the Worker name exactly `wanderlust-stage-two-analysis`.
7. Use `npm ci` as the build command and `npm run deploy` as the deploy command if Cloudflare asks for them.
8. Save and deploy. Confirm the generated `workers.dev` URL opens Build 6 before adding the custom domain.

## Environment variables

In the Worker, open **Settings > Variables and Secrets**:

1. Add `STAGE2_API_URL` as plain text using the existing Apps Script `/exec` URL.
2. Add `STAGE2_SUBMISSION_TOKEN` as an encrypted secret using the current Apps Script token.
3. Deploy the current version again so the bindings are active.

## Custom domain

In the Worker, open **Settings > Domains & Routes > Add > Custom Domain** and
enter the Stage 2 hostname you want to use, such as `stage2.wanderlust.properties`.
Cloudflare creates the required DNS record when the domain is in the same account.

## Cloudflare Access email-passcode login

1. Open **Zero Trust > Access > Applications**.
2. Add a **Self-hosted** application for the exact Stage 2 hostname.
3. Use the same allowed leadership email addresses and session duration as the other Wanderlust tools.
4. Create an **Allow** policy using the approved email addresses.
5. Confirm **One-time PIN** is enabled under **Settings > Authentication > Login methods**.
6. Test the Stage 2 hostname in a private browser window. It should request an email address and then a one-time code, without showing a ChatGPT login.

## Final cutover

After the private-window test passes, update the Stage 2 card on the Wanderlust
Tools menu to the new custom hostname. Keep the ChatGPT Sites URL only as a
temporary rollback reference until the Cloudflare version is fully verified.
