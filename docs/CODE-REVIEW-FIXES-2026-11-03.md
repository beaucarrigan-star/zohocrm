# Code review fixes, 3 Nov 2026 (must-fix items M1 to M13)

Nothing here is committed or deployed. The edits sit in the working tree of `zohocrm-final` (and the matching
copies under `contract-pipeline/`, `collections-pipeline/`, `ship-pipeline/`, `S66-phase11d/`, `Widgets and Themes/`
for the Deluge sources that live outside the repo). Deploy in the order under "Rollout".

## What changed

| Item | Fix | Files |
|---|---|---|
| M1 CI never deployed | Workflow path filters and copy steps now use `catalyst/contract-pipeline` and `catalyst/solicitation-pipeline`. `.gitignore` data rules re-anchored with `**/`. `set-secrets.ps1` targets `beaucarrigan-star/zohocrm`. | `.github/workflows/*.yml`, `.gitignore`, `tools/set-secrets.ps1` |
| M2 runtime files missing | `catalyst.json`, `fn_config/*.json` (empty env maps, no secrets), `claude_prompt.md`, `claude_schema.json` copied into the repo for all four pipelines. | `catalyst/*/` |
| M3 CI turned Claude off | `ci/inject_env.py` carries every `CLAUDE_*`, `CON_CLAUDE*`, `CON_OCR*`, `CON_PDF_SECONDS` value it finds in the environment and refuses to deploy `CON_CLAUDE=shadow/on` without a key. Workflow passes them from one secret (`CLAUDE_API_KEY`) and repository variables. `set-secrets.ps1` uploads them from `.conpipe-claude.env`. | `ci/inject_env.py`, `deploy-contract.yml`, `tools/set-secrets.ps1` |
| M4 refresh token in Notes | Token refresh posts the secrets in the body, raises a message with no URL or body; the failure Note goes through `_safe_error()` which masks `*token=`, `client_secret=`, `client_id=` and Zoho oauth token shapes. | `con_worker/zoho_client.py`, `con_worker/main.py` |
| M5 renewed contracts alerted | Closed = `Contract_Status` Ended / Ending - No Renewal / **Renewed**, or `Renewal_Status` **Renewed** / Not renewing (the live picklists; "Signed" does not exist). | `contract_expiry_alerts.v6.paste.dg` |
| M6 two task schedulers | Before creating a tier-crossing Task, v6 looks for an open Task on the contract whose subject starts "Contract renewal" or "Contract EXPIRED" and skips if one exists. renewal_starter is not in the repo; it keeps working and no longer doubles up as long as its subjects use the same prefix. bulkUpdate results are logged. | same file |
| M7 COQL escaping | `qstr` doubles the quote (`''`) like every other helper. | `bd-home`, `bd-cs-home` |
| M8 hardcoded owners | Every home reads CRM Variable **HOME_ROUTING**; Deluge reads **ALERT_EMAILS**, **ROUTING_FALLBACK_OWNERS**, **VENDOR_PRODUCT_MAP**. Today's values stay in code as the fallback, so nothing changes until the variables exist. | five homes, `ownership_owner_from_rule_v2.dg`, `collections_send/prepare.dg`, `equipment_shipped_daily.dg`, `em_case_reply-live.dg`, `vendor_cost_contract_margin.dg` |
| M9 calendar linking blocked | `writeAllowedIds: '*'` on all four homes with the calendar layer. | `bd-cs-home`, `em-home`, `bd-home`, `leadership-home` |
| M10 collections double send | The request is claimed (`Email_Status = Sending`) before anything goes out; a second Approve stops on Sending/Sent. The sendmail fallback ends as `Sent (unconfirmed)`, never `Sent`; a failed fallback ends as `Send failed`. A failed final update is logged as a warning. | `collections_send.dg` |
| M11 cases capped at 100 | Open cases are paged 200 at a time, up to 1,000, on CS Home and EM Home. | `bd-cs-home`, `em-home` |
| M12 API load | Poll interval 120 s to 600 s on BD Home and CS Home; CS Home also skips the poll while the tab is hidden (BD already did). The rest of M12 (lazy Notes, one shared `getAllUsers`) is not done. | `bd-cs-home`, `bd-home` |
| M13 development URLs | Deluge callers build the URL from CRM Variable **CATALYST_PIPELINE_BASE**; `bulk_ingest.py` reads `CON_API_BASE`. The development host stays the fallback because that is where the functions are deployed today. | `collections_parse_report.dg`, `equipment_shipped_import.dg`, `tools/bulk_ingest.py` |

## CRM Variables to create (Setup > Developer Space > CRM Variables, type Single line or Multi line, text)

Create them with the values below (these equal today's hardcoded values, so creating them changes nothing; edit later as needed).

**HOME_ROUTING**
```json
{"admin_id":"6715134000000503001","admin_name":"Beau Carrigan",
 "personal_mailboxes":["bcarrigan@differenceprinciple.org","bcarrigan@justicepoint.org"],
 "team_mailbox":"emsupport@justicepoint.org",
 "mail_people":[{"name":"beau carrigan","boxes":["bcarrigan@justicepoint.org","bcarrigan@differenceprinciple.org"]},
                {"name":"stacey loosen","boxes":["sloosen@justicepoint.org"]},
                {"name":"brittany mueller","boxes":["bmueller@justicepoint.org"]}],
 "leadership_fallback":[{"id":"6715134000000774001","name":"Edward Gordon"},{"id":"6715134000000779001","name":"Nick Sayner"},{"id":"6715134000000781001","name":"Stacey Anick"}],
 "queue_profiles":["Administrator","System Support"]}
```
Any key may be left out; a key of the wrong type is ignored. In a home page console, `JPKR.source` says whether the variable was read and `JPKR.error` why not.

**ALERT_EMAILS**
```json
{"contract_renewals":"bcarrigan@differenceprinciple.org",
 "shipments_digest":"bcarrigan@differenceprinciple.org",
 "collections_from":"bcarrigan@differenceprinciple.org","collections_from_name":"Beau Carrigan",
 "collections_cc":"aradtke@differenceprinciple.org",
 "em_support_from":"emsupport@justicepoint.org"}
```

**ROUTING_FALLBACK_OWNERS** (used only when an Ownership Rule's RR Members is blank)
```json
{"EM Support":["6715134000001952001","6715134000001952003"],"Business Development":["6715134000001216001"],
 "PDEC":["6715134000003334001"],"Leadership":["6715134000000774001","6715134000000779001","6715134000000781001"]}
```

**CATALYST_PIPELINE_BASE**: `https://contract-pipeline-911327312.development.catalystserverless.com`

**VENDOR_PRODUCT_MAP**: optional; `{}` or leave unset. Keys `allied_vendor_id`, `rate_fields`, `vendor_key`, `line_products`, `line_products_any` override the tables in `vendor_cost_contract_margin`.

## Picklist values to add before pasting collections_send

`Collection_Requests.Email_Status` needs two new values: **Sending** and **Sent (unconfirmed)**. The CRM API rejects an
unknown picklist value, so without them the claim update fails and the function stops before sending (nothing goes out,
the log says "could not claim request"). Add the values first.

## Rollout

1. Create the CRM Variables above and the two picklist values.
2. Paste the Deluge functions into the CRM: `contract_expiry_alerts.v6.paste.dg` (replaces v5), `ownership_owner_from_rule_v2.dg` (v2.1),
   `collections_send`, `collections_prepare`, `collections_parse_report`, `equipment_shipped_daily`, `equipment_shipped_import`,
   `em_case_reply-live`, `vendor_cost_contract_margin`. Each still has its `<TOKEN>` placeholder where it had one before.
3. Re-upload the five home widgets (BD + CS Home v5.12, BD Home v4.8, EM Home, Leadership Home, PDEC Home).
4. Commit and push `zohocrm-final`. Run `tools/set-secrets.ps1` once so `CLAUDE_API_KEY` and the `CON_*` variables exist on
   the repo, then let the contract workflow run (`workflow_dispatch` works now; so does a push touching `catalyst/contract-pipeline/**`).

## Not done in this pass

- The `VIEWS` / `EM_VIEWS` custom-view id maps copied into every home (M8, last bullet): still per page. They are view ids, not ownership.
- `weekly_data_check.dg` (`VAR_ID` record id) and `renewal_starter` were not changed; neither is in the repo as a live source.
- M12 beyond the poll interval: Notes are still loaded eagerly and `getAllUsers` is still called by several layers.
- `docs/DEPLOY-SETUP.md` and `tools/make-repo.ps1` still describe the `jp-catalyst-pipelines` layout.
- The `zohocrm-repo/` duplicate tree was not updated; `zohocrm-final/` is the source.
