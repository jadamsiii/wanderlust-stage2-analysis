# Wanderlust Stage 2 Analysis App

## Suggested Apps Script project title

**Wanderlust Stage 2 Analysis App**

## Install the code

1. Create a new standalone Google Apps Script project.
2. Rename the project **Wanderlust Stage 2 Analysis App**.
3. Open the existing `Code.gs` file.
4. Delete its placeholder contents.
5. Copy and paste the complete contents of the included `Code.gs` file.
6. Save the project.

## Add Script Properties

Open **Project Settings → Script Properties** and add:

| Property | Value |
|---|---|
| `OPENAI_API_KEY` | Your Wanderlust OpenAI API key |
| `SUBMISSION_TOKEN` | A new strong shared token for this app |
| `OPENAI_MODEL` | `gpt-5.6` |

Do not put the OpenAI API key directly in `Code.gs`.

## Create the Google Drive archive folder

The archive belongs beneath:

**Properties → Reports → Stage 2 Analysis Archive**

1. Open the existing **Reports** folder in Google Drive.
2. Copy the folder ID from its URL.
3. In Apps Script, select the function `createStage2ArchiveFolder`.
4. Because the Run menu cannot supply a parameter, temporarily add this helper at the bottom of `Code.gs`:

```javascript
function setupStage2Archive() {
  createStage2ArchiveFolder('PASTE_REPORTS_FOLDER_ID_HERE');
}
```

5. Replace the placeholder with the Reports folder ID.
6. Run `setupStage2Archive` once.
7. Approve the requested permissions.
8. Confirm execution completed and the new folder exists.
9. Delete the temporary `setupStage2Archive` helper and save again.

The setup function automatically stores `STAGE2_ARCHIVE_FOLDER_ID` in Script Properties. Verify that the property appears before deploying.

## Deploy the web app

1. Select **Deploy → New deployment**.
2. Choose **Web app**.
3. Description: **Stage 2 Analysis App — Version 1**.
4. Execute as: **Me**.
5. Choose the access setting that matches the other Wanderlust internal Apps Script web apps.
6. Deploy and authorize if prompted.
7. Copy the final URL ending in `/exec`.

Keep the `/exec` URL available. It will be connected to the Stage 2 front end in the next step.

## Do not share in chat

Do not paste the OpenAI API key into ChatGPT. The `/exec` deployment URL and the shared submission token can be connected through the app's secure deployment settings when we proceed.
