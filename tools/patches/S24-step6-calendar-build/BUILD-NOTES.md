# S24 step 5: page shell build notes (22 Oct 2026)

Base: BD-CS-Home-v5.11-spare-alert.zip, widget.html sha256 e86ba0ea...835f (checked; unpacked to `s24-base/`, not modified).
Spec: S24-LAYOUT-SPEC-APPROVED.md, sections 1 to 5, 7, 8, with the section 11 decisions.

## What was built

| File | What it is |
|---|---|
| `jpk-shell.js` | The shell. One global `window.JPKShell` (`config, mount, unmount, calendar, counts, flow, version, lastNav`). Interface comment for `jpkCalendar.load(range)` at the top. Demo stub for the calendar. No network calls. |
| `jpk-shell.css` | All rules under `html[data-jpk-shell="on"]` (one exception: the footer switch link, which also shows when the shell is off). Page tokens only. |
| `jpk-shell-config.example.js` | Schema notes plus the CS and BD example configs. |
| `tools/cs-config.js` | The CS config block the patch should inline as `<script id="jpk-shell-config">`. |
| `demo.html` | Standalone demo: the v5.11 section markup and style blocks (rendered once from the real widget in `?preview=1&ntdemo=1` with the network blocked, then frozen), the real `needs-today-js` block, a stand-in script, and the shell. Works offline. |
| `tools/make_demo.py`, `tools/demo-standin.js` | Rebuild the demo. The stand-in publishes `__bd`, `__bdcsUser`, the theme switch (the widget's own `data-theme` on `<html>`) and the collapse toggles. |
| `tools/make_real.py` | Test-only copy of the real widget with the shell referenced (`tmp-real/`). Not the S24 patch. |
| `tests/run_tests.py` | Playwright tests (demo plus the real widget in preview). Last run: `tests/last-run.txt`. |
| `shots/` | Screenshots: desktop, tablet and phone in light and dark, shell off, and the real widget. |

Demo flags: `?theme=dark|light`, `?shell=0|1`, `?caldemo=1|empty|err|later|done|slow`, `?ntdemo=1|err|empty`, `?asuser=1`, `?nouser=1`, `?agerr=1`, `?coll=1`, `?ag=empty|never`, `?sm=0|1`.

## Zone placement (section 11 decisions 1 to 3)

- Main column: Needs you today, Queue + Follow-ups, **Numbers, Boards** (S21 order, decision 1), Devices on leg, Relationships (collapsed on first visit).
- Side column: Calendar, Today & Upcoming, Quick links + Vendor contacts.
- Top: Stock emails to approve (only shown when the page opens it).
- Narrow (1100 px and below): Stock emails, **Up-next above the tiles** (decision 3), Needs you today, Today & Upcoming, Queue + Follow-ups, Numbers, Boards, Devices on leg, Relationships, Quick links + Vendor contacts.
- Queue + Follow-ups, Relationships and Today & Upcoming are where section 1.2 put them. Nothing fought the S21 order, so I kept them there.

## Where the build differs from the spec, and why

1. **Narrow order is applied by moving the elements, not with CSS `order`.** The spec said the DOM order would stay top, main, side. With Up-next above the tiles (decision 3), that would make Tab order differ from what you see on a phone. So below 1101 px the shell moves the sections into one column in the narrow order. It moves them back when the window widens. It still only moves whole elements by id.
2. **There is a hairline between the columns, not a 16 px gap.** The moved sections keep the page's edge-to-edge look, so the columns use the page's own pair style: no gap and one line. To do that, the zone containers carry the kit class `hk-edge` (the kit's opt-in) as well as `jpk-` classes.
3. **Flow step 4, Close out, counts cases** (decision 4): your open cases from `__bd.Q`, or the Mine count if that is missing. Clicking it goes to the Queue, not Boards. A "closed today" figure would need a new read, and the shell makes no reads, so it is not shown. Confirm the wording at step 9.
4. **The "to approve" count uses `#sm-list > li.sm-item`, not `#sm-list > li`.** When nothing is waiting, the page writes one `li.sm-empty`, which would count as a false 1. The count does not depend on whether the Stock emails zone is open.
5. **Today & Upcoming rows get CSS-only overrides in the side column.** From 641 px up, v5.11 gives the date and actions fixed widths, which left no room for the titles in a 400 px column. No markup changes.
6. **Seeding Relationships collapsed is done by clicking the page's own toggle once.** The spec said to write `bd-rel: true` to storage. By the time the shell runs, the page has already read its storage, so writing it would only take effect on the next visit. Clicking the toggle collapses it now and lets the page save its own entry. If the entry already has `bd-rel`, the shell leaves it alone.
7. **BD example:** "New solicitation" has `href: ''` plus `hideWhenMissing`, because the spec's URL was a placeholder.
8. **Billing check badge:** it shows 1 only when the current month's period exists and is not Reconciled. The agenda only reads periods that are not Reconciled, so "no period this month" could mean either reconciled or not yet created. In that case there is no badge, and the button opens the create form.

## Tests (last run: 199 passed, 0 failed)

The tests cover: every zone in the right order (desktop, tablet and phone, light and dark); no horizontal scroll; Up-next above the tiles on narrow screens; each quick action's target, with its fallbacks, profile gating and the hidden Log lost device; New meeting opening a tab, plus the blocked-popup toast; every empty state word for word; the header count failure display (`ntdemo=err`, `agerr`, `caldemo=err`, loading); the flow strip (Enter, Tab and Space, aria-current, ticks that persist for the day and clear the next day, the all-done wording); `?shell=0`, the footer toggle, `?shell=1` and `unmount()`; section innerHTML sha256 unchanged by mounting, by switching between wide and narrow, and by unmounting; the BD config on the same shell; zero console errors and page errors; Tab order following visual order at 1400 and 390 px; and AA contrast for shell text.

The same checks also ran against the **real v5.11 widget** in preview with its own scripts running. Section innerHTML was unchanged by mounting. The collapse toggles and their storage entry, Go to and Collapse all still work. The only console errors were the blocked SDK and font loads, which the base page also has.

## Open issues

- **The `—` in counts and flow steps is the spec's placeholder for "unknown"** (sections 3 and 5). It is an em dash character. It is the only one in the shell's output. If you want it gone everywhere, swap it for another mark: it is two literals in `jpk-shell.js`.
- **The calendar is a stub.** Step 6 must define `window.jpkCalendar` before `jpk-shell.js` loads. In a live page without step 6, the calendar shows "Calendar could not load. Reload the page to try again." and Up-next falls back to Today & Upcoming. The "Link to account" button appears only once `jpkCalendar.link` exists.
- **Sticky side column** only applies when the column is shorter than the frame. In the Zoho iframe, which is sized to its content, it will rarely apply. Not tested inside Zoho.
- **Not tested here:** a live Zoho page, `frame-fit` sizing inside Zoho, and the 31 S21 demo checks (their harness was not part of this job).
- The patch (step 7) should reference the files as `app/jpk-shell.css` and `app/jpk-shell.js`, or inline them, plus the `tools/cs-config.js` block.
