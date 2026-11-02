# zohocrm

Code for the JusticePoint Zoho CRM build. Code only: no contracts, customer files, spreadsheets, archives or credentials belong here (see `.gitignore`).

| Folder | What it is |
|---|---|
| `catalyst/` | Catalyst pipelines: contract, solicitation, billing, collections, ship |
| `lead-intake/` | Lead intake service (web form, CSV, email, manual entry into Zoho Accounts/Contacts) |
| `widgets/<name>/` | Every Zoho widget, newest build checked out. Each older build is a commit and a tag (list in `docs/WIDGET-VERSIONS.md`) |
| `widgets/_loose/` | Loose, never-zipped copies (EM Pricing Studio, app) |
| `deluge/` | Deluge functions |
| `tools/` | Deploy and secret-setup scripts |
| `.github/workflows/` | Automatic Catalyst deploys for the solicitation and contract pipelines |
| `docs/` | Setup notes |

Deploy setup: `docs/DEPLOY-SETUP.md`. Secrets live in GitHub Actions secrets and local `.env` files, never in the repo.
