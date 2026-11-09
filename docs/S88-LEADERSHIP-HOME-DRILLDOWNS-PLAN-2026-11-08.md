# S88 · Leadership Home: read-only overview, drilldown popouts, snapshots, saved views, per-leader focus · plan · 8 Nov 2026

Beau's ask (8 Nov, 09:14 CT): Leadership Home shows high-level information for leaders to review. Only cases/tasks sent to them have things to actually do. Every piece of every widget is clickable and opens more data in a popout that they can save — **both** a snapshot (PDF / CSV) and a saved view (filters kept, reopens live, can be pinned to the Reports tab).

Decisions (8 Nov, 09:43 CT): "Mark handled by me" also sets Status; Nick (CEO) and Ed (COO + attorney) see the page ordered for their roles (section 2a); aging pill on review tasks at 5 days; Margin by vendor includes Buddi and reads its vendor list from Rate Lines so new vendors appear without code changes.

Mockup (design canvas, three artboards: home page, read-only drilldown, actionable review popout): https://claude.ai/artifact/Hen4nfX1GWmqexy5KQyetB — sample figures only. Also filed in the Cohesion plan project as `claude/S88-LEADERSHIP-HOME-DRILLDOWNS-PLAN-2026-11-08.md`.

This is a plan for whoever builds it (Claude Code, another model, or Beau). It follows the conventions of S65 / S81 / S83: patch against the last served base, one new layer, off switch, Playwright tests, rollback zip, registry row.

---

## 0. Before touching code
1. Open Leadership Home in Chrome and read the footer build. S81 was v47.12 and S83–S87 came after it, so the served version is later. **Patch only the served zip**; the patch script refuses any other base (hash check as in S65/S81). `docs/WIDGET-VERSIONS.md` should agree with the footer; if not, the footer wins and WIDGET-VERSIONS gets corrected in the same commit.
2. Read these logs first (Cohesion plan project, `claude/`): S65 (tiles, LEADERSHIP_TILES variable, nightly refresh), S76 (rates admin / vendor costs), S77 (leadership support tracking), S81 (review popout: payloads, default owners, TEAM_BY_USER), S83 (Reports tab), S87 (sent-to-leadership on case and board). Reuse their blocks; do not rebuild them.
3. Off switch for everything in this plan: `?s88=0` renders the base exactly.

## 1. The rule the page is built on
Three layers, applied to every tile:
- **Tile** — one number or small chart. Read-only. Answers "is this fine?"
- **Popout** — click any number, bar, segment or row and a drilldown opens with the records behind it. Read-only.
- **Act** — only inside *Awaiting your review* (S81 popout) and *Escalated to you* (S77/S87 data). Approve / Reject / Send back / respond. No other element on the page writes to a record.

Consequence for the build: the overview tiles get **no** buttons that call updateRecord. If one exists today outside those two tiles (check S65 "Pricing sign-offs" inline Approve / Decline — that moved into S81's popout), remove the inline write or route it into the review popout.

## 2. Page layout (Today tab)
Top row, two tiles with a navy border so they read as "yours to do":
- **Awaiting your review** — S81 as built (drop-down, All / From BD / From CS, popout with Approve / Reject / Send back to BD / Send back to CS). Add: "waiting N days" on each row; amber "aging" pill at **5+ days**.
- **Escalated to you** — cases escalated to leadership (S77 fields: sent-to leader, date sent, days on radar, waiting on customer/vendor). Row click opens the actionable popout (section 5b). Footer line "Resolved this month · avg days on radar" links to the drilldown.

Below, six read-only tiles in a 3-column grid (2 columns at tablet, 1 at 390 px). Default order below; per-leader order in 2a.

| Tile | Headline | Clickable pieces | Drilldown rows |
|---|---|---|---|
| Pipeline | open $ and deal count (from LEADERSHIP_TILES, weighted) | each stage bar; "Sirona (separate stages)"; "Forecast this quarter" | Deals: account, stage, owner, amount, expected margin, age in stage, next step. Sirona rows use Sirona's stage names. |
| Renewals · next 12 months | count and annual value | 0–90 / 91–180 / 181–365 buckets; "renewal deal not yet opened" | Contracts by final end date (after extensions): account, device/vendor, days left, annual value, renewal owner (Beau), renewal deal status. Ed's focus adds a Terms column (section 2a). |
| Margin by vendor | blended % this month | one bar per vendor; "Rates to fill" | Accounts on that vendor: pricing type, units, rate/day, cost/day (S76 vendor costs), margin %, contract end, owner. Rate-missing rows flagged; fixing happens on the S76 rates admin screen, not here. |
| Collections | outstanding $ and account count | aging segments (current, 31–60, 61–90, 90+); "over 60 days"; "collected this month" | By account then by aging (as decided for the S83 Reports tab): account, bucket totals, oldest invoice date, last payment, owner. Reuse S83's collections query. |
| Service | % handled in 1 business day (target 90%) and % resolved in 2 business days (target 90%) | each %; open cases; waiting on customer / vendor; team load | Cases: customer, opened, first touch (who, when), status, waiting-on, days open, assigned. Team load view: per person counts. Reuse S77 queries. |
| Customer health | accounts flagged (of total) | late pay 60+; open escalation; no Program Administrator on file; no touch in 60 days | Accounts: which flags, owner, last touch, Account Roles coverage (S68 stakeholder map). |

**Vendor list is data, not code.** The Margin tile's bars and the drilldown's vendor filter come from the distinct vendor values on Rate Lines (today: Allied GPS, SuperCom, SCRAM Remote Breath, SCRAM CAM, Buddi). A vendor added on the S76 rates admin screen appears on the tile the next nightly run. A vendor with units but no cost shows its bar greyed with "cost missing" and counts toward Rates to fill; it is not dropped.

Header: Home · Reports (S83) · **Saved views** (new, badge = count) · range chips This month / 30 d / 90 d / 12 mo · "Summaries refreshed nightly · <time>" from the LEADERSHIP_TILES stamp.

Range chips change the tile figures where a figure is range-dependent (margin, collections collected, service %) and are passed into every popout as the default range. Pipeline and renewals ignore the range (they are "as of now").

Data: tile headlines come from the nightly `LEADERSHIP_TILES` variable (S63/S65; `deluge/leadership_tiles_nightly.dg`). Extend that nightly Deluge with the new fields rather than running six COQL queries on page load. Popouts query live COQL on open.

### 2a. Per-leader focus (role-based layout)
Same tiles, same numbers, same drilldowns for everyone on the Leadership profile; what differs is order, emphasis and a few extra columns. Nothing is hidden — a tile lower on the page still opens the same popout.

Config lives in one place, CRM variable **`LEADERSHIP_FOCUS`** (JSON, editable from the admin/Processes side like the ownership routing settings; S66 pattern). Keyed by user id, with a `default` entry:

```
{ "default": { "order": ["pipeline","renewals","margin","collections","service","health"] },
  "<Nick user id>": { "label": "CEO",
     "order": ["pipeline","margin","renewals","health","collections","service"],
     "escalations_first": ["billing","account_risk"],
     "extra_columns": {} },
  "<Ed user id>": { "label": "COO / Counsel",
     "order": ["service","renewals","collections","health","pipeline","margin"],
     "escalations_first": ["vendor","device","contract","legal"],
     "extra_columns": { "renewals": ["terms","counterparty","rate_hold"], "escalated": ["contract_ref"] } } }
```

- `order`: tile order in the grid. Unknown keys ignored; missing keys appended in default order.
- `escalations_first`: which escalation categories float to the top of Escalated to you for this leader (categories from the S67 resolution/escalation categories; map the names in one lookup table). Others follow, nothing removed.
- `extra_columns`: added to that leader's drilldown table for the named key. `terms` / `counterparty` / `rate_hold` come from the Contractbook-imported contract fields (S66/S57 contract pipeline); if a field does not exist yet, show the column header with "—" and log it in the build notes rather than failing.
- Users not in the config get `default`. Stacey Anick gets default unless Beau adds her.
- Beau can edit the JSON directly; a small "Leader focus" form on the Processes/admin side (order drag list, category checkboxes) is a follow-on, not part of S88.
- Demo mode: `?focus=ceo` / `?focus=coo` renders the two layouts without being signed in as them (for screenshots and Beau's review).

## 3. The drilldown popout — one component, keyed
Build **one** `s88Drill(key, segment, range)` that renders every read-only popout. Adding a tile later is a new key, not a new popout.

Shell (same for all keys):
1. **Header** — breadcrumb "Leadership Home › <tile>", title "<segment> · <headline figure>", range chips, close (×, Esc, click outside; focus returns to the element that opened it, as S81 does).
2. **Summary strip** — 3–5 stat boxes for the segment (e.g. accounts, units, revenue/day, cost/day, margin with change vs last month).
3. **Filters** — search box, 2–4 chips specific to the key (pricing type, owner, entity, "below 40% only"), sort indicator.
4. **Table** — sticky header, hover rows, record name links open the CRM record in a new tab (read-only here). Paginate at 50; "Showing N of M". Columns = the key's columns + the signed-in leader's `extra_columns` for that key.
5. **Footer — save bar** (section 4).

Key → query map (COQL; each returns the table columns in section 2). Put the map in one object at the top of the layer so an implementer can see every query in one place. Each key declares: `module`, `select`, `where(segment, range)`, `columns`, `summary(rows)`, `filters`, `optional_columns`.

Placement: appended to body like S81 (#s88-drill), centred, max 924 px wide, 90 vh tall, scrolls inside the table. At 390 px it is full-screen with the summary strip stacked.

## 4. Save — two things, both in the footer
### 4a. Save a snapshot
- **CSV**: client-side from the rows currently shown (after filters), all pages, not just page 1. Filename `<tile>-<segment>-<YYYY-MM-DD>-<range>.csv`.
- **PDF**: a print stylesheet for the popout only (`@media print` hides the page behind it, shows header + summary + full table, no footer). Trigger `window.print()`. Same filename convention in the document title so the browser suggests it. No server-side PDF and no email for now (same decision as S83).
- Both are logged: one row in `CRM Changes` (the S68 log module) with type `Leadership snapshot`, key, segment, range, user, time. No record is modified.

### 4b. Save this view
A saved view = key + segment + range + filters + sort + name, owned by a user, optionally pinned and shared.

**Store: new custom module `Leadership_Views`** (not a CRM variable — variables are org-wide and would collide between leaders):
- `Name` (view name), `Owner`, `Tile_Key`, `Segment`, `Range`, `Filters_JSON`, `Sort`, `Pinned_To_Reports` (bool), `Shared_With` (multi-user), `Last_Opened`.
- Leadership profile needs create/edit/delete on this module only for their own records; shared views are read-only to others.

Footer controls: name input (prefilled "<segment> <filters summary>"), **Pin to Reports tab**, **Share with…** (checkbox per other Leadership-profile user, read from profiles at load — not a hard-coded list), **Save view**. Saving an existing view with changed filters prompts "Update 'name' or save as new".

**Saved views tab** (new, beside Home and Reports): list of my views and views shared with me — name, tile, range, pinned?, last opened, by. Click reopens the live popout with the stored filters. Delete and unpin here.

**Reports tab (S83)**: pinned views appear as a "Pinned views" section at the top of the tab, each as a card that opens the live popout. Nothing else on S83 changes.

## 5. The two actionable popouts
### 5a. Awaiting your review — S81, unchanged
Keep S81's payloads, default-owner lookup and tests. Add only: "waiting N days" and the 5-day aging pill on rows; a PDF button in the footer (same print path as 4a) so a leader can take a scenario into a meeting. Approve / Reject / Send back stay exactly as S81.

### 5b. Escalated to you — new actionable popout
Rows: cases where the S77/S87 "sent to leadership" fields name this leader (or "Also sent to" includes them), ordered by the leader's `escalations_first` categories, then days on radar. Detail pane: customer, device/vendor, opened, first touch, waiting-on, days on radar, timeline of notes, the case description, and (Ed) contract reference if present.
Actions (footer), one updateRecord per action, no email, no workflow trigger flag — the S81 pattern:
- **Respond** — adds a Note to the case (author = leader). No status change.
- **Mark handled by me** — Note + clears the sent-to-leadership flag + **sets Status to Resolved** (decision 8 Nov). Resolution category required (S67 picklist) since Resolved triggers the S58 SLA update; the popout shows the category picker before confirming. The case owner is unchanged.
- **Reassign** — to Stacey Loosen / Brittany Mueller / EM Support default owner; confirm step naming the person, note required; Owner changed, flag kept (it is still escalated until handled).
Every action prepends `[<date> · <leader>] Responded|Handled (Resolved)|Reassigned to <name>: <comment>` to Description, as S81 does. Failure keeps the popout open with Zoho's message; nothing changes locally.

## 6. What the nightly job adds (Deluge, `deluge/leadership_tiles_nightly.dg`)
Add to `LEADERSHIP_TILES`: renewals buckets (0–90 / 91–180 / 181–365, and count with no renewal deal), margin by vendor as a list built from distinct Rate Lines vendors (blended + per vendor, units, cost-missing flag, rates-to-fill count from S76), collections aging totals and collected-this-month, service % handled in 1 BD and % resolved in 2 BD, open / waiting counts, team load per person, customer-health flag counts. Keep the existing weighted pipeline and renewal-risk fields; keep the `at` stamp. Variable size: check it stays under the CRM variable limit; if not, split into `LEADERSHIP_TILES` and `LEADERSHIP_TILES_2`.

## 7. Permissions to confirm in Zoho (not testable offline)
- Leadership profile: COQL read on Deals, Contracts, Cases, Accounts, Rate Lines, Account Roles; read `LEADERSHIP_FOCUS`; create on Notes; edit on Cases (Status, resolution category, owner change); create/edit/delete on `Leadership_Views`; create on `CRM Changes`.
- If any is missing the popout shows Zoho's refusal and changes nothing locally (S81 rule).

## 8. Tests (Playwright, network blocked, light/dark, 1280 and 390 px)
- `?s88=0` renders the base exactly (page text identical).
- Every clickable element on every tile opens a popout with the right key and segment (enumerate: ~34 targets, plus one per vendor present).
- Per-leader focus: `?focus=ceo` and `?focus=coo` render the configured orders; Ed's renewals drilldown shows the Terms column; an unknown user gets default; a config with a bad key does not break the page.
- Vendor list: a stubbed `LEADERSHIP_TILES` with six vendors renders six bars; a vendor with cost missing renders greyed and counted in Rates to fill.
- Popout: focus trap, Esc, focus return, no horizontal scroll, table paginates, filters change the row count, range chips re-query.
- CSV: all filtered rows, correct columns (including extra columns), filename. PDF: print stylesheet hides the page, shows all rows.
- Saved view: save → appears in Saved views tab → reopen restores key/segment/range/filters/sort; pin → appears on Reports tab; share → visible to a stubbed second leader, read-only; update-or-save-as-new prompt; share list built from stubbed profiles.
- No updateRecord call from any overview tile or read-only popout (assert the SDK stub is never called with a write outside the two actionable popouts).
- 5b payloads: Respond (Note only), Mark handled (Note + flag clear + Status Resolved + category required), Reassign (Owner + Note, confirm step, note required, flag kept), failure path.
- Demo mode `?demo=1`: labelled sample numbers, writes nothing.

## 9. Delivery
In this repo: patched widget under `widgets/` per the existing layout, tests beside it, a log in `logs/S88-LEADERSHIP-HOME-DRILLDOWNS-<date>.md`, registry row in `registry-rows/`, `docs/WIDGET-VERSIONS.md` bumped. On Beau's machine, folder `JusticePoint\Zoho\S88-drilldowns\`: patched zip `Leadership-Home-v<next>-s88-drilldowns.zip`, `rollback\Leadership-Home-v<served>-ROLLBACK.zip`, `S88-code-and-tests.zip`, `S88-screenshots.zip` (include CEO and COO layouts), sha256/16 table in the log, the initial `LEADERSHIP_FOCUS` JSON with Nick's and Ed's user ids filled in. Upload: Setup > Developer Hub > Widgets > Leadership Home > Edit > upload, Index Page as before, Save, hard refresh; check footer version, click three tiles, save one view, pin it, open Reports, sign in as (or `?focus=`) each leader.

## 10. Build order (each step shippable on its own)
1. Nightly variable additions (vendor list from Rate Lines) + read-only tiles from them (no popouts yet).
2. `LEADERSHIP_FOCUS` variable + per-leader order and `?focus=` demo.
3. `s88Drill` shell + the Margin by vendor key (it exercises summary, filters, rate-missing flags, dynamic vendors). Then the other five keys, with extra columns.
4. Snapshot CSV + PDF + CRM Changes logging.
5. `Leadership_Views` module, save bar, Saved views tab, Reports-tab pinned section.
6. Escalated to you popout (5b) and the S81 additions.
7. Full test pass, zips, log, registry.

## Decided
- Mark handled by me: sets Status Resolved (category required) and clears the leadership flag.
- Per-leader focus via `LEADERSHIP_FOCUS`; Nick = CEO order, Ed = COO/Counsel order with contract-terms columns; others default.
- Review-task aging pill at 5 days.
- Vendors read from Rate Lines; Buddi included; new vendors need no code change.

## Still open
- Nick's and Ed's Zoho user ids for the initial `LEADERSHIP_FOCUS` (pull with getUsers at build time).
- Which Contractbook-imported fields hold terms / counterparty / rate-hold today; if none, Ed's extra columns show "—" until the contract ingest fields land.
