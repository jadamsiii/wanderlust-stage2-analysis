# Wanderlust Stage 2 Analysis — Cloudflare Build 8

This repository deploys the approved Stage 2 Analysis frontend as a Cloudflare
Worker and keeps the Apps Script submission token on the server. Cloudflare
Access supplies the same email one-time-passcode login used by the other
Wanderlust tools.

## Values required in Cloudflare

- `STAGE2_API_URL` — the existing Google Apps Script `/exec` URL. This is not a secret.
- `STAGE2_SUBMISSION_TOKEN` — the same `SUBMISSION_TOKEN` stored in Apps Script. Encrypt this value.

Do not put either value in source code or commit a populated `.env` file.

## GitHub and Cloudflare deployment

1. Replace the existing repository source with the contents of the Build 8 source package.
2. Commit the change to the production branch connected to Cloudflare.
3. Allow the existing `wanderlust-stage-two-analysis` Worker to build and deploy the commit.
4. Confirm `https://stage2.wanderlust.properties` displays **Build 8**.

## Environment variables

In the Worker, open **Settings > Variables and Secrets**:

1. Add `STAGE2_API_URL` as plain text using the existing Apps Script `/exec` URL.
2. Add `STAGE2_SUBMISSION_TOKEN` as an encrypted secret using the current Apps Script token.
3. No variable changes are required when these values are already present.

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
