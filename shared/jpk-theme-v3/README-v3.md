# jpk-theme-v3 (15 Oct 2026)

Graphite + cobalt palette, Civic shape and type, Enterprise layout parts, brand scope switcher. Approved by Beau 15 Oct (see ux/THEME-REDESIGN-PLAN-2026-10-15.md). Replaces jpk-theme.css v2. jpk.js stays v1.1.0.

## Files
| File | What |
|---|---|
| `jpk-theme-v3.css` | Tokens + component overrides + new layout classes. Load after `jpk.css`. |
| `jpk-brand.js` | `JPK.brand(...)` brand scope switcher (rail card + menu, persistence, COQL criteria). Load after `jpk.js`. |
| `assets/tri-brand-logo-320.png.b64` | The logo, base64. Decode to `app/jpk-logo.png`: `base64 -d assets/tri-brand-logo-320.png.b64 > app/jpk-logo.png` |
| `mockups/jpk-theme-v3-demo.html` | Every component in one page (needs jpk.css, jpk-theme-v3.css, jpk-brand.js, jpk-logo.png beside it). |
| `tests/theme-v3.test.js` | 40 checks: token cascade, legacy re-skin, contrast AA in both themes, switcher behaviour, phone layout. `NODE_PATH=$(npm root -g) node tests/theme-v3.test.js` |

## Use it in a widget
```html
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;500;600;700&family=Archivo:wght@500;600;700&display=swap">
<link rel="stylesheet" href="jpk.css">
<link rel="stylesheet" href="jpk-theme-v3.css">
...
<script src="https://live.zwidgets.com/js-sdk/1.2/ZohoEmbededAppSDK.min.js"></script>
<script src="jpk.js"></script>
<script src="jpk-brand.js"></script>
```
Copy `jpk-theme-v3.css`, `jpk-brand.js` and `jpk-logo.png` into `app/`. Remove the old `jpk-theme.css` link.

## What changes with no markup edits
`--teal`, `--teal-soft`, `--on-teal` now alias `--accent`, `--accent-soft`, `--on-accent`, so every v1.1.0 component picks up cobalt. Also: Archivo on h1/h2/h3 and `.rec h1`, 4px/3px radii, `.chip` becomes dot + text (no fill), `.cnt` becomes neutral mono, `.ctabs` selected = ink text + 2px cobalt underline, `.pill`/`.seg` selected = solid ink, `.step.cur` = ink, `.card>h2` = sentence case 13px, `.btn` weight 500 (primary 600), `.next` = white with 3px cobalt left rule, selected table row = `tr[aria-selected="true"]` left rule.

## New tokens
`--accent #2F55A4`, `--accent-ink #284A90`, `--accent-soft #E6ECF8`, `--on-accent #fff`, `--line-strong #B8BEC7`, `--font-head Archivo`, `--r 4px`, `--r-sm 3px`, `--row 40px`. Dark: accent `#7F9FE0`, accent-ink `#9DB6EA`. Status colors are shared and never the accent. Full table in the plan doc.

## New classes
- Shell: `.jpk-shell` (208px rail + main) → `.jpk-rail` (`.logo`, `.grp`, `a[aria-current=page]`, `.cnt`, `.me`) + `.jpk-main`. Rail becomes a horizontal strip under 900px.
- Brand switcher: `.sw` card, `.swmenu` menu, `.smark` monogram (rendered by `JPK.brand`). `.scopehint` row.
- Command bar: `.jpk-cmd` with `.crumb` and `.tools`; `.search` (with inner input), `.ib` icon button.
- Saved views: `.jpk-views` → `.vtabs` + `.dds` with `.dd` filter dropdowns (`.dd.on` when set).
- Tables: `.tw.flush` (no border, for edge-to-edge), `th.cb/td.cb` selection column, `td.num`, `td.name`, `td.sub`, `.var.pos/.neg`, `.tfoot` + `.pager`.
- Status variants: `.chip` (dot + text, default), `.badge` (tinted, Stripe tables), `.loz` (uppercase outline, Atlassian lists).
- Record page: `.rband` (`.crumb`, `.rtitle`, `.ctabs`), `.rgrid`, `.kpis > .kpi`, `.sec > .hd`, `.kv`, `.rl`.
- Timeline: `.jpk-tl` → `.day`, `.ev` (`.ico`, `.ico.b`, `.c`, `.l1`, `p`, `.assocs`).
- Summary row: `.sum > div` (`small`, `b`, `.d.up/.dn`).
- Grouped list (Cases): `.lgrp`, `.lrow` (`.id`, `.ttl`, `.lab`, `.due.soon`), `.stico.open/.prog/.done`, `.fchip`.

## JPK.brand
```js
var scope = JPK.brand({ mount: el, counts: {all:142, jp:96, sr:28, dp:18}, onChange: function (key) { reload(); } });
scope.get(); scope.set('sr'); scope.label(); scope.setCounts({...});
scope.where('Brand')               // Accounts:  "Brand in ('JusticePoint EM','JusticePoint Programs')"  |  "Brand = 'Sirona Recovery'"  |  ''
scope.where('Account_Name.Brand')  // Contacts / Deals / Cases through the lookup
```
Persists in `localStorage['jpk-brand']` (pass `storageKey:null` to disable). Keyboard: Enter/Space opens, arrows move, Esc closes. Open question: whether COQL accepts `Account_Name.Brand` (formula through lookup) in criteria. Test once; if not, add a stamped Brand picklist on Contacts/Deals/Cases (plan doc, data model section).

## Not yet done
records.css / records.html still carry their own palette and the old header; porting them to the shell is the next step (TABS-VISUAL-DESIGN-PLAN-2026-10-14). Vendor billing widgets to adopt `.sum` + `.badge` tables. Home pages to swap jpk-theme.css for v3.
