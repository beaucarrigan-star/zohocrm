# S76 · Rates to fill (5 Nov 2026)

`rates-model.js` is the single pricing model for three places. Each one copies the file in byte for byte:

| Where | Widget folder | Live version |
|---|---|---|
| Processes > Rates > Rates to fill | `widgets/widget-processes` (`app/rates-model.js`, `app/processes-rates.js`) | v3.5.1 |
| Leadership Home "Margin by vendor" tile | `widgets/leadership-home` (`<script id="rates-model">`) | v47.11.1 |
| Beau CS Home "Rates to fill: N" in Needs you today | `widgets/bd-cs-home` (`<script id="rates-model">`, `jpk-s76-rates`) | v6.16.1 |

The model's header lists the matching rules. That covers how a unit's vendor and family are decided, which contract counts as the account's, how vendor costs and purchased units are handled, the order of the Part B statuses, and the "No vendor on rate line" flag.

## Every write to Rate_Lines
`Rate_Lines` is a subform on Contracts, so a contract update **deletes every row it leaves out**. Each write therefore:
1. reads the contract fresh;
2. sends every existing row id, plus the change;
3. reads the contract again, and stops with an error if any row is missing.

Writes run with workflows on, so "Pricing - EM Margin from contract" reruns `em_margin_build`. Customer Margins v1.3.1 and Processes (Margins and Rates) all follow this rule.

## Layout
- `rates-model.js`: the shared model, used in node and in the browser.
- `app/`: the Rates to fill view (`processes-rates.js`), its demo data and its CSS. The CSS is also injected by the patched script.
- `tools/`: hash-guarded patches that build the widget zips from the live base zips. Each refuses an unknown base.
  - `patch_processes_rates.py <Processes v3.4.1 zip> <out zip>`
  - `patch-leadership-tile.js <widget.html> [--check]`
  - `patch-cs-home.js <widget.html> [--check]`

  `--check` confirms that the copied-in model matches `rates-model.js`.
- `tests/`
  - `rates-model.test.js`: the step 2 checks. It needs `tests/fixture-2026-11-04.js` (see below).
  - `rates-writes.test.js`: Add rate, Verify, Set cost, Keep this one and Move to account against a fake Zoho that deletes left-out rows. It needs the fixture.
  - `demo-check.js` and `cs-home-check.js`: Playwright, demo mode, light and dark at 1200 and 390 px. Before running them:
    1. run `npm install` in `tools/`;
    2. serve `out/` on port 8777, with the unzipped builds in `out/demo`, `out/lead` and `out/cs`;
    3. the scripts look for Chromium in `%LOCALAPPDATA%/ms-playwright/chromium-1223`.

## The fixture is not in git
`tests/fixture-2026-11-04.js` is a copy of live Zoho rows: real account names, contract ids and rates. Business data stays out of GitHub, so the file is gitignored. To recreate it, run COQL in Zoho with these filters and keep the REST shape (lookups as `{id, name}`):
- **Daily_Unit_Counts:** `Count_Date = 2026-11-04 and On_Leg > 0`.
- **Rate_Lines:** every Verified Vendor cost line, plus the lines on the Dodge, Rock, Sawyer and Milwaukee contracts.
- **Contracts:** the matching contracts.

The tests look accounts up by name (Dodge Co. Sheriff, Milwaukee County Pretrial Program, Sawyer Co. Pretrial and others).
