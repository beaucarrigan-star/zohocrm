import sys
path=sys.argv[1]
src=open(path,encoding="utf-8").read()
BAR = r'''  /* Progress bar for "Follow the read": the worker has no progress field, so the stage comes from what the page can see:
     nothing touched yet = waiting; documents re-indexed since the start = reading; rate-line or clause counts changed = saving. */
  function barHtml(R) {
    var st = R.stage == null ? (R.done ? 'done' : 1) : R.stage, pct = 15, tone = 'var(--accent, #4aa3ff)', ind = true, txt;
    var secs = Math.max(0, Math.round(((R.endedAt || Date.now()) - R.start) / 1000)), el = Math.floor(secs / 60) + ':' + (secs % 60 < 10 ? '0' : '') + (secs % 60);
    if (st === 'done') { pct = 100; ind = false; tone = 'var(--good, #3fb97f)'; txt = 'Done in ' + el + ' - ' + esc(R.status || 'ready for review'); }
    else if (st === 'failed') { pct = 100; ind = false; tone = 'var(--bad, #e5484d)'; txt = 'Failed after ' + el + ' - open the contract to see why'; }
    else if (st === 'noop') { pct = 100; ind = false; tone = 'var(--line, #8a8f98)'; txt = 'Nothing new - this packet was already read'; }
    else if (st === 'wait') { pct = 15; ind = false; txt = 'Still waiting after ' + el + ' - the worker may be off'; }
    else if (st === 3) { pct = 85; txt = 'Saving results - ' + el; }
    else if (st === 2) { pct = 50; txt = 'Reading files (' + (R.docs || []).length + ' read so far) - ' + el; }
    else txt = 'Waiting for the worker - ' + el;
    return '<div role="progressbar" aria-label="Ingest progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '" style="height:10px;border-radius:6px;background:var(--s1);border:1px solid var(--line);overflow:hidden;margin:2px 0 8px">' +
      '<div style="height:100%;width:' + pct + '%;background-color:' + tone + ';transition:width .6s' + (ind ? ';background-image:linear-gradient(90deg,rgba(255,255,255,.28),transparent,rgba(255,255,255,.28));background-size:200% 100%;animation:ci-stripe 1.4s linear infinite' : '') + '"></div></div>' +
      '<style>@keyframes ci-stripe{from{background-position:200% 0}to{background-position:-200% 0}}@media (prefers-reduced-motion:reduce){[aria-label="Ingest progress"] div{animation:none!important}}</style>' +
      '<p role="status" style="margin:0 0 10px;font-size:13px;font-weight:600">' + txt + '</p>';
  }
'''
EDITS=[
 ("  function runHtml(R) {", BAR + "  function runHtml(R) {"),
 ("    return '<dl><dt>Status</dt>", "    return barHtml(R) + '<dl><dt>Status</dt>"),
 ("var changed = st && st !== R.before;",
  "var changed = st && st !== R.before, ing = rec.Ingested_On && new Date(rec.Ingested_On).getTime() >= R.start - 5000;"),
 ("(changed || fresh)) { R.done = true;", "(changed || fresh || ing)) { R.done = true;"),
 ("      cDraw(root);\n      if (R.polling && C.run === R) C.timer",
  "      if (R.base == null) R.base = { c: R.clauses, r: R.rates };\n"
  "      if (R.done) { R.stage = /Failed/.test(st) ? 'failed' : 'done'; R.endedAt = R.endedAt || Date.now(); }\n"
  "      else if (!R.polling) R.stage = /already read/i.test(R.note || '') ? 'noop' : 'wait';\n"
  "      else R.stage = R.docs.length ? (R.clauses !== R.base.c || R.rates !== R.base.r ? 3 : 2) : 1;\n"
  "      cDraw(root);\n      if (R.polling && C.run === R) C.timer"),
 # the 10-minute timeout branch draws before the stage code runs
 ("R.polling = false; R.note = 'Still waiting after 10 minutes. The worker may be off. Check back or press Refresh later.'; cDraw(root); return; }",
  "R.polling = false; R.stage = 'wait'; R.note = 'Still waiting after 10 minutes. The worker may be off. Check back or press Refresh later.'; cDraw(root); return; }"),
]
if "function barHtml" in src: print("already applied"); sys.exit(0)
for o,n in EDITS:
    c=src.count(o)
    if c!=1: sys.exit("STOP: %d matches for %r"%(c,o[:70]))
for o,n in EDITS: src=src.replace(o,n)
open(path,"w",encoding="utf-8").write(src); print("applied", len(EDITS))
