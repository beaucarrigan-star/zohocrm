# Lead intake for Zoho CRM

One service that takes lead info from a web form, a CSV, a forwarded email or a manual entry, checks it against Zoho, and creates the Account and Contact if they don't exist yet.

## What it does with each lead

1. Rejects it if there is no last name, or no organization and no company domain.
2. If the email is already on a Contact, creates nothing (`duplicate`).
3. Looks for an Account by company domain (`Email_Domains`, `Website`), then by exact name. Personal domains such as gmail.com never match.
4. No Account found and an organization name given: creates the Account. Several found: nothing is written (`review`).
5. Creates the Contact under that Account and adds a note with the source.

Statuses returned: `created`, `duplicate`, `review`, `rejected`, `error`.

## Endpoints

All need header `X-Intake-Key`. Add `?dry_run=1` to see what would happen without writing.

| Route | Body |
|---|---|
| `POST /lead` | JSON object (web form or manual entry) |
| `POST /leads/csv` | CSV text, or multipart field `file`; the response gives a status per row |
| `POST /leads/email` | raw email text |

## Settings (environment variables)

`INTAKE_API_KEY`, `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`. Optional: `ZOHO_ACCOUNTS_URL` and `ZOHO_API_URL` (only if your Zoho data center is not US), `DEFAULT_OWNER_ID` (Zoho user id that owns new records). Never commit these; see `.gitignore`.

## Run and test

    pip install -r requirements.txt
    python -m pytest
    python app.py

## Not built yet

- A screen for the `review` and `rejected` leads. For now the API response is the only record.
- Owner routing beyond one default owner.
- Mailbox watching: the email route takes forwarded text but nothing pulls mail on its own.
- Deploying to Catalyst, which needs your Zoho credentials and a one-time OAuth setup.
