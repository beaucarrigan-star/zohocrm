# S64: Next step v1.2.0, Deals mode (Phase 13a, widget part), 2 Nov 2026

Nothing was uploaded to Zoho. Every Zoho read in this session was read-only (COQL, layouts, fields).

## Inputs that were missing

The brief named three files to read first: CLAUDE.md, docs\COHESION-HANDOFF-2026-11-01.md (section 4 E and the 13a rules) and docs\S64-PHASE13A-OPPORTUNITY-RECORD-2026-11-02.md. None of them is on this machine. Beau was told and chose to go on without them ("Proceed without them").

What that means for this build:

- **The 13a rules and section 4 E were not checked.** The build follows the brief text only.
- **The five TEST deals** were read from Zoho (COQL) instead of the log. They match the brief: EM priced, four with no Amount.
- **The 73 model tests and smoke checks are not on disk.** S41 says they passed but the files are gone (patch_s41_next_step.py too). In their place, a new regression test compares v1.2.0 with the tagged v1.1.0 model, row by row (see Tests).

## Base check

The v1.1.0 tag (next-step-v1.1.0-s41) matches the served hashes. The S41 zip next-step-v1.1.0-s41.zip (c8cb36fee24061fd) has the same five files.

| File | Served | Tag |
|---|---|---|
| widget.html | 7c28ef6dd95fe360 | 7c28ef6dd95fe360 |
| next-step.js | 326d993391e82044 | 326d993391e82044 |
| next-step-model.js | 7f2f3971997bf6f8 | 7f2f3971997bf6f8 |
| next-step.css | 5754badc5218b465 | 5754badc5218b465 |
| demo-data.js | b8c6d289280deefd | b8c6d289280deefd |

Note: core.autocrlf is on in this repo. A plain `git checkout` of the tag rewrote line endings and changed every hash. The base files were written from the raw tag blobs instead. build-zip.py refuses files with CR in them.

## What Deals mode shows

Entity = Deals. Live fields only; the shipped page has no Deals sample data (demo-data.js is unchanged, byte for byte).

1. **Header strip:** Pipeline name, then "N days in stage" from Days_in_Stage. An amber "stale" chip shows at 14 days or more. There is no chip when Stage Group is Won or Lost or Dead.
2. **Stage path:** the deal's pipeline stages in order. The current stage is boxed and bold, with "(current stage)" for screen readers and aria-current="step". A stage not in the pipeline's list shows alone: "Dead not in this pipeline's list". The same happens for Meeting (Face to Face or Zoom) and Closed Lost to Competition.
3. **Gate checklist** (mirrors validation rule 6715134000000750278, as described in the brief):
   - Prospecting or Discovery: "To leave <stage>: Contact ✓/✗ · Amount ✓/✗" and "Next Step ✓/✗ (needed to save here)".
   - Past Discovery and open: "Kept past Discovery: Contact ✓/✗ · Amount ✓/✗".
   - Closed Lost: "Closed Lost: Reason For Loss ✓/✗".
   - Every mark is a word plus a symbol, and the screen-reader text says "filled" or "missing". Colour only repeats it.
4. **Margin line:** "Margin 36.7%" (Deal_Margin, or "not set") and a Margin_Status chip: On target, Below target (amber), Below floor (red), No floor set, No cost yet, No lines. A blank status reads No lines.
5. **Next step:** the earliest open Task linked by What_Id (not Completed; undated tasks go last), shown as its subject plus "Task · due Mon D, YYYY · Owner". If there is no task, the Next_Step field is shown ("From the Next Step field. No open task."). If neither exists, "Set a next step" with Add task as the main button. If the task read fails, the card says "Tasks could not be read."
6. **Buttons:** Edit deal and Add task (task pre-filled "Deal follow-up: <Deal_Name>", linked to the deal). The edit button is dropped when the user cannot edit the deal, as for the other modules.
7. **Card rule:** amber when stale or when any gate item is ✗. Otherwise cobalt.
8. **Off switch:** `?s13=0` on the widget URL turns Deals mode off. The model's MODULES list is unchanged, so with the switch off a deal shows "Next step is not set up for this module", exactly as v1.1.0 does (checked in the browser, HTML identical).

### Assumptions (not in the brief, check these)

- **Amount 0 counts as filled.** The gate checks for an empty Amount, as a validation rule does. Waukesha Co Sheriff has Amount 0.
- **The Closed Lost gate applies to Closed Lost only.** Dead and Closed Lost to Competition get no gate line.
- **Open means Stage Group is not Won and not Lost or Dead.** If Stage Group is blank, a stage starting with Closed or Dead counts as closed.
- **Every task status except Completed counts as open**, including Deferred.

## Stage lists: which source

**Both, live first.** The widget calls ZOHO.CRM.META.getLayouts({Entity:'Deals'}) and reads the Pipeline field's Stage maps. If that call fails or carries no maps, it falls back to deal-stages.js, a copy of the S55 table checked against the live layout on 2 Nov 2026. The source used is put on the page as `data-stage-source="live"` or `"map"`.

- **Verified:** the parser reads the real Deals layout (fetched today through the Zoho API, saved as tests\fixtures\deals-layout-pipeline-2026-11-02.json) and gets exactly the deal-stages.js lists. The fallback works in the harness when layouts fail or have no maps.
- **Not verified:** whether the widget SDK's getLayouts (v2 API) returns the Pipeline > Stage maps inside Zoho. Check `data-stage-source` on a deal after upload. If it says "map", the page still shows the right lists, from deal-stages.js.

## Tests

- **Model** (`node widgets/next-step/tests/model.test.js`): **355 passed, 0 failed.**
  - Part 1 runs 68 rows through the new model and the tagged v1.1.0 model and compares compute() and formFor (call, edit, task). The rows are the 47 demo rows, plus empty, view-only and odd-value rows for each module, plus an unknown module. Every output is identical.
  - Part 2 covers Deals:
    - The five TEST deals: EM priced with Amount 16425, margin 36.7% On target, everything ticked. Programs, Sirona, TDP and Standard have Amount ✗ and No lines, and each shows its own pipeline's path.
    - Stale at 206, 13 and 14 days; Closed Won at 206 days (no chip); Closed Lost with and without a reason.
    - Past Discovery, the not-in-list stages, the margin chips, task order, the field fallback, and "Set a next step".
    - View-only, formFor, and the live layout parse.
- **Browser** (tests\harness.html, the real app files with a stand-in ZOHO object; local server only):
  - The 47 demo rows in v1.1.0 and v1.2.0, light and dark (94 pairs): the #ns HTML is identical.
  - The Zoho path for Contracts, Cases and an unsupported module, with and without ?s13=0, plus a deal with ?s13=0: identical to v1.1.0.
  - Deals: the five TEST deals, stale, mid-pipeline with Contact missing and Below floor, Lost, Won, Dead and Meeting.
  - Stage source: live layouts, layouts with no maps (map), and a failed layouts call (map). Also a failed task read.
  - Buttons: Add task and Edit deal open the right Zoho forms.
  - Screens looked at in light and dark at 1200 and 390 px. One layout fix came out of this: at 390 px the Deals text block kept a 320 px flex height and left a gap above the buttons.

## Build

Zip: `C:\Users\Beau\JusticePoint\Zoho\S64-phase13a\next-step-v1.2.0-s64.zip`, **22985bb4384a4868**, 7 files. Built by widgets\next-step\tests\build-zip.py, which refuses to build unless the base matches the served hashes.

| File | sha256 (first 16) | Change |
|---|---|---|
| plugin-manifest.json | 6dc0fddb41c8bb68 | unchanged (taken from the v1.1.0 zip) |
| app/widget.html (page) | a90e1c1d900712f9 | jpk-build label; loads deal-stages.js |
| app/next-step.css | a544d91f8ba0c4d4 | Deals block added at the end |
| app/next-step-model.js | 722b197713f60295 | Deals rules added; VERSION 1.2.0 |
| app/demo-data.js | b8c6d289280deefd | unchanged |
| app/deal-stages.js | fb03aac3dc773a97 | new |
| app/next-step.js | 218b54deedfc1c90 | Deals render and loaders; ?s13=0 |

Rollback: `C:\Users\Beau\JusticePoint\Zoho\S64-phase13a\rollback\next-step-v1.1.0-s41-ROLLBACK.zip` (c8cb36fee24061fd, the S41 v1.1.0 zip, copied unchanged).

Git: commit on main, tag **next-step-v1.2.0**.

## Before it can show on a deal (not done here)

- Upload the zip (Setup > Widgets, id 6715134000009398171; index stays /widget.html).
- Add the Next step related list to the Deals layout(s), or the Deals canvas, as the other modules have it.
- On a TEST deal, check the five sections and `data-stage-source`.
