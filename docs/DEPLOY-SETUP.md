# Deploying the pipelines from GitHub

Solicitation and contract deploy automatically when you push to GitHub. Billing stays a one-click
script on your PC, because its tests need the real July baseline data.

## One-time setup (about 20 minutes)

1. **Create the repo.** On GitHub, create a PRIVATE repository named `jp-catalyst-pipelines`. Leave it empty.
2. **Build the code-only folder.** Double-click or run `make-repo.ps1` (PowerShell). It copies code only
   to `C:\Users\Beau\jp-catalyst-pipelines`, keeps PDFs, contracts, Word/Excel files and the contract test
   text out, and prints the list of files staged. Check that list. Nothing from `contracts\`, `fixtures\`
   or any `.pdf`, `.docx`, `.xlsx` should appear.
3. **Push it.** In that folder: `git commit -m "Pipelines"`, then add the GitHub remote and `git push -u origin main`.
   The first push will start both deploys, which is a good first test (they redeploy the same code).
   If you would rather test first, add the secrets (step 5) before you push.
4. **Make a Catalyst token.** In PowerShell run `catalyst token:generate`, open the link it shows, enter
   the code, and copy the token. It is shown once.
5. **Add the secrets.** The easy way: run `set-secrets.ps1` (it reads your .env files and fills in every secret below without showing a value; needs `winget install --id GitHub.cli -e` and `gh auth login` once). By hand instead: GitHub repo > Settings > Secrets and variables > Actions > New repository secret:

   | Secret | Where the value comes from |
   |---|---|
   | `CATALYST_TOKEN` | step 4 |
   | `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN` | `%USERPROFILE%\.solpipe.env` |
   | `ZOHO_ACCOUNTS_URL`, `ZOHO_API_DOMAIN` | same file (optional; defaults to the US data centre) |
   | `SOL_PIPELINE_TOKEN` | `PIPELINE_TOKEN=` line in `.solpipe.env` |
   | `CON_PIPELINE_TOKEN` | `CON_PIPELINE_TOKEN=` line in `%USERPROFILE%\.conpipe.env` |

   Use the SAME token values that are in use today. The Zoho button functions already hold them, and a
   different value would make the buttons stop working.
6. Open `deploy-billing.cmd` once to confirm billing still deploys (it asks for the billing Catalyst project id once).

## Day to day
- Change code, run `check-contracts.cmd` (contract changes only), commit, push. GitHub does the rest.
- To redeploy without a code change: GitHub > Actions > pick the workflow > Run workflow.
- Billing: double-click `deploy-billing.cmd`.

## Good to know
- The contract workflow warns that the golden tests did not run in GitHub, because their input is kept out
  of the repo on purpose. `check-contracts.cmd` is that gate, and it is on you to run it.
- Catalyst tokens: if a deploy fails with an authentication error, generate a new token and replace `CATALYST_TOKEN`.
- Rotating Zoho credentials: change the secrets, then run the workflows once.

## Optional: "Deploy" button in Zoho (Administrator only)
`deploy_pipeline.dg` holds a standalone Deluge function that starts either workflow through GitHub.
Its header lists the three setup steps (a GitHub token limited to this one repo, two CRM Variables, the function).
Then add a button (for example on the Administrator home page) that calls it with "solicitation" or "contract",
shown to the Administrator profile only. Nothing in Zoho has been created yet.
