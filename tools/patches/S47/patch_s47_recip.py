"""S47 (30 Oct 2026): multi-select To picker on the stock alert approval screens.
Stock Alerts tab: base widget-stock-alerts-s42-intro.zip (stock.html 2d1eea4b46e21372, stock.js 656854b6cb1e9aa0, served live 30 Oct).
Beau CS Home: base BD-CS-Home-v6.13.0-s38-phase5.zip (widget.html 9142adacea1569d0, served live 30 Oct).
Refuses any base whose sha256 differs. Usage: python3 patch_s47_recip.py SA_DIR CS_DIR jpk-recip.js
"""
import sys, hashlib, pathlib

h = lambda b: hashlib.sha256(b).hexdigest()[:16]
def die(m): sys.exit('REFUSED: ' + m)
def sub(text, old, new, label):
    n = text.count(old)
    if n != 1: die(f'{label}: expected 1 match, found {n}')
    return text.replace(old, new)

sa, cs, recip = map(pathlib.Path, sys.argv[1:4])
BASE = {sa / 'app/stock.html': '2d1eea4b46e21372', sa / 'app/stock.js': '656854b6cb1e9aa0', cs / 'app/widget.html': '9142adacea1569d0'}
for p, want in BASE.items():
    got = h(p.read_bytes())
    if got != want: die(f'{p} is {got}, expected {want}')
rjs = recip.read_text(encoding='utf-8')

# ---------- Stock Alerts tab ----------
p = sa / 'app/stock.html'; t = p.read_text(encoding='utf-8')
t = sub(t, 'content="Stock Alerts tab (S42: guide line on jpk-intro v1.1.0, 28 Oct 2026)"',
        'content="Stock Alerts tab (S47: To picker jpk-recip v1.0.0, 30 Oct 2026)"', 'stock.html build')
t = sub(t, '<script src="stock.js"></script>', '<script src="jpk-recip.js"></script>\n<script src="stock.js"></script>', 'stock.html script')
p.write_text(t, encoding='utf-8')
(sa / 'app/jpk-recip.js').write_text(rjs, encoding='utf-8')

p = sa / 'app/stock.js'; t = p.read_text(encoding='utf-8')
t = sub(t, """'<label class="eyebrow" for="d-to">To (separate with commas)</label>""",
        """'<label class="eyebrow" for="d-to">To</label>""", 'stock.js label')
t = sub(t, "to.value = M.splitRecipients(rec.Recipient_Emails).join(', '); sub.value = rec.Draft_Subject || ''; bod.value = bodyTxt;",
        "to.value = M.splitRecipients(rec.Recipient_Emails).join(', '); sub.value = rec.Draft_Subject || ''; bod.value = bodyTxt;\n"
        "      if (window.JPKRecip) JPKRecip.mount(to, { load: function () { return pickPeople(rec); } });   /* S47: multi-select To */",
        'stock.js mount')
t = sub(t, "  function draftDrawer(v, rec) {",
        "  /* S47: who the To picker offers - the alert's account contacts and the active CRM users (demo: a short made-up list) */\n"
        "  function pickPeople(rec) {\n"
        "    if (S.demo) return Promise.resolve(M.splitRecipients(rec.Recipient_Emails).map(function (e) { return { email: e, name: '', group: 'At this customer' }; })\n"
        "      .concat([{ email: 'demo.contact@county.example', name: 'Demo Contact', group: 'At this customer' }, { email: 'demo.user@justicepoint.example', name: 'Demo User', group: 'JusticePoint' }]));\n"
        "    var acc = rec && rec.Account && (rec.Account.id || rec.Account);\n"
        "    return JPKRecip.crmPeople(acc, function (q) { return J.crm.coqlAll(q); });\n"
        "  }\n"
        "  function draftDrawer(v, rec) {", 'stock.js helper')
p.write_text(t, encoding='utf-8')

# ---------- Beau CS Home ----------
p = cs / 'app/widget.html'; t = p.read_text(encoding='utf-8')
q_old = "select id, Alert_Type, Draft_Subject, Draft_Body, Recipient_Emails, Detail, Created_Time, Account.Account_Name from EM_Stock_Alerts"
q_new = "select id, Alert_Type, Draft_Subject, Draft_Body, Recipient_Emails, Detail, Created_Time, Account, Account.Account_Name from EM_Stock_Alerts"
if t.count(q_old) != 2: die(f'widget.html stock query: expected 2, found {t.count(q_old)}')
t = t.replace(q_old, q_new)
t = sub(t, """'<label>To (comma separated)<input type="text" data-sm="to" value="'""",
        """'<label>To<input type="text" data-sm="to" value="'""", 'widget.html To label')
# the picker: inline (single-file widget), mounted on every To field the card or the peek panel draws
anchor = "  var smRow = function (id) { return SM.rows.filter(function (r) { return String(r.id) === String(id); })[0]; };"
hook = (anchor + "\n"
        "  /* S47: multi-select To picker (jpk-recip v1.0.0) on every stock email To field, card and peek */\n"
        "  function smPeople(f) {\n"
        "    var li = f.closest('[data-id]'), r = li ? smRow(li.getAttribute('data-id')) : null;\n"
        "    var acc = r ? ((r.Account && (r.Account.id || r.Account)) || r['Account.id']) : null;\n"
        "    if (PREVIEW) return Promise.resolve(smSplit(r && r.Recipient_Emails).map(function (e) { return { email: e, name: '', group: 'At this customer' }; })\n"
        "      .concat([{ email: 'demo.contact@county.example', name: 'Demo Contact', group: 'At this customer' }, { email: 'demo.user@justicepoint.example', name: 'Demo User', group: 'JusticePoint' }]));\n"
        "    return JPKRecip.crmPeople(acc, function (q) { return api.all(q.replace(/ limit \\d+$/, ''), 1); });\n"
        "  }\n"
        "  if (window.JPKRecip) JPKRecip.auto('input[data-sm=\"to\"]', function (f) { return { load: function () { return smPeople(f); } }; });")
t = sub(t, anchor, hook, 'widget.html picker hook')
# load the picker before the main script: put it right before the closing </head>
t = sub(t, '</head>', '<script>\n' + rjs + '\n</script>\n</head>', 'widget.html head')
t = sub(t, '<meta name="jpk-build" content="Beau CS Home v6.13.0 (v6.12.0 S37 + S35 guide blurb line + S38 Send to Leadership, 27 Oct 2026)">',
        '<meta name="jpk-build" content="Beau CS Home v6.13.1 (v6.13.0 + S47 multi-select To on stock emails, 30 Oct 2026)">', 'widget.html build')
p.write_text(t, encoding='utf-8')
print('patched')
