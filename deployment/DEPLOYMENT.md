# Wanderlust Stage 2 Analysis — deployment

## Google Drive

Inside the authoritative Properties folder, use the existing Reports folder. The Apps Script setup function creates:

`Properties / Reports / Stage 2 Analysis Archive`

Build 9 automatically maintains a draft JSON record in Drive while an analysis progresses, reopens a saved ARV without unnecessary research unless configuration changes, and uses actual saved timestamps in the archive. Existing Build 6 through Build 8 JSON records remain readable.

## Google Apps Script

1. Open the existing **Wanderlust Stage 2 Analysis Bridge** project.
2. Replace `Code.gs` with `google-apps-script/Code.gs`.
3. In Project Settings, add Script Properties:
   - `OPENAI_API_KEY`
   - `SUBMISSION_TOKEN`
   - `OPENAI_MODEL` (optional; defaults to `gpt-5.6`)
4. Do not rerun `createStage2ArchiveFolder` when `STAGE2_ARCHIVE_FOLDER_ID` is already configured.
5. Create a new web-app deployment version, executing as the owner.
6. Keep the existing web-app `/exec` URL.
7. Approve the added Drive-sharing and email permissions when Google requests authorization.

## Front end

The existing Cloudflare Worker retains `STAGE2_API_URL` and `STAGE2_SUBMISSION_TOKEN`. No new Cloudflare variables are required.

## Live acceptance tests

1. Run 204 Gold Nugget Loop and verify the mandatory configuration page.
2. Confirm that editing square feet or beds/baths recalculates the ARV page.
3. Verify automatic image retrieval and construction grading.
4. Upload an exterior screenshot and verify the visual grades refresh.
5. Upload one DataScout screenshot and at least one property photo. Verify the originals appear in the dated Drive archive folder.
6. Generate the PDF without email and verify the thumbnail opens the full-resolution Drive image.
7. Generate and email a second test to John only. Verify the PDF attachment and both Drive links.
8. Return to the opening screen and reopen the analysis through **Open Previous Analysis**.
