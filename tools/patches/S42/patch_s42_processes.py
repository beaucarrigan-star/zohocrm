"""patch_s42_processes.py: Processes v3.1.2 (S42, 28 Oct 2026).
Base: the live Processes v3.1-s24 files in s41-live-bases-2026-10-27.json (pulled from Zoho 27 Oct, S41).
Adds (1) the S35 guide line (jpk-intro.js, byte for byte from Records v3.4, live hash ea85cec2c053f51a) and
(2) the S41 open-on-a-section code (same hunks as Records v3.4 records.js).
Refuses any base whose sha256 is not the one below. Usage: python3 patch_s42_processes.py BASES.json RECORDS_V34.zip MANIFEST_SRC.zip OUT.zip
"""
import sys, json, base64, hashlib, zipfile, io

BASE_JSON_SHA = '5d5ae112ba077826'
WANT = {  # live v3.1-s24 files, sha256 first 16
    'processes.html': '43bb918c13989a53', 'records.css': '5cf6c2fdc4f9d65d', 'jpk-brand.js': '1ed282ee6ac01a53',
    'records-shell.js': '6f0a0ba60bfadf17', 'records-model.js': '18e60a06e3f65366', 'modules.js': '380a32345821050a',
    'layouts.js': 'a13d73e3f1920012', 'relmods.js': '75fad5832c5a8989', 'relations.js': '5671ab869887cb0b',
    'billing-flow-model.js': '2db6cb36251e9d18', 'findings-model.js': 'e32eb53c1fed118a', 'processes-demo.js': '6d3cdef9e4cbc3b9',
    'processes-view.js': '050a13a66d1e07a5', 'processes-intake.js': '9c36462d12f7af31', 'demo-data.js': '09766872729cd276',
    'records.js': '5308e528086b0cde'}
RECORDS_ZIP_SHA = 'cbce00c6d94c703f'   # widget-records-v3.4-s41-sections.zip
INTRO_SHA = 'ea85cec2c053f51a'         # jpk-intro.js v1.1.0 as live on Records
MANIFEST_SHA = '327265a93efc3d36'      # plugin-manifest.json in widget-processes-v3.2-wave3.zip (fonts allowed, as the live page loads them)

h = lambda b: hashlib.sha256(b).hexdigest()[:16]
def die(m): sys.exit('REFUSED: ' + m)

bases_p, rec_p, man_p, out_p = sys.argv[1:5]
raw = open(bases_p, 'rb').read()
if h(raw) != BASE_JSON_SHA: die('base json sha256 %s' % h(raw))
files = {k: base64.b64decode(v) for k, v in json.loads(raw)['processes']['files'].items()}
if set(files) != set(WANT): die('base file list differs')
for k, v in files.items():
    if h(v) != WANT[k]: die('%s sha256 %s' % (k, h(v)))
rb = open(rec_p, 'rb').read()
if h(rb) != RECORDS_ZIP_SHA: die('records zip sha256 %s' % h(rb))
intro = zipfile.ZipFile(io.BytesIO(rb)).read('app/jpk-intro.js')
if h(intro) != INTRO_SHA: die('jpk-intro.js sha256 %s' % h(intro))
mz = zipfile.ZipFile(man_p); manifest = mz.read('plugin-manifest.json')
if h(manifest) != MANIFEST_SHA: die('manifest sha256 %s' % h(manifest))

def sub1(text, old, new, name):
    n = text.count(old)
    if n != 1: die('%s: anchor found %d times: %r' % (name, n, old[:60]))
    return text.replace(old, new)

# ---- processes.html: version meta + S35 guide line (wording = guide v2, Processes row)
html = files['processes.html'].decode('utf-8')
html = sub1(html, '<title>Processes</title>\n',
  '<title>Processes</title>\n<meta name="jpk-build" content="Processes tab v3.1.2 (v3.1-s24 + S35 guide line + S41 open on a section, S42 28 Oct 2026)">\n', 'html meta')
html = sub1(html, '<script src="records.js"></script>\n',
  '<script src="records.js"></script>\n<script src="jpk-intro.js"\n  data-id="processes"\n'
  '  data-what="The monthly and as-needed admin jobs Beau runs: contract ingest and review, vendor billing reconcile, solicitation intake and briefing. Admin only."\n'
  '  data-fed="Contract packets, vendor invoices, solicitation links and packets"\n'
  '  data-feeds="Contract Documents, Rate Lines, Contract Clauses, Billing Periods and Findings, Solicitations"></script>\n', 'html intro')
files['processes.html'] = html.encode('utf-8')

# ---- records.js: the S41 hunks (identical code to Records v3.4)
js = files['records.js'].decode('utf-8')
js = sub1(js, '/* records.js: shared engine.',
  '/* records.js S42 (28 Oct 2026, Processes v3.1.2): S41 open-on-a-section, as in Records v3.4: opens on the section a Nav bar\n'
  '   or native Back asked for (widgetparams jpk_section), else on the section this person used last on this tab.\n'
  '   records.js: shared engine.', 'js header')
OLD_SW = "  function switchTo(k) { if (!MODS[k] || MODS[k] === cfg) return; cfg = MODS[k]; st.filter = 'all'; st.search = ''; st.token++; showList(); }\n"
NEW_SW = ("  var LASTKEY = 'jpk-records-last:' + TAB;\n"
  "  function remember(k) { try { window.localStorage.setItem(LASTKEY, k); } catch (e) { /* storage blocked: no memory */ } }\n"
  "  function lastSection() { try { return window.localStorage.getItem(LASTKEY); } catch (e) { return null; } }\n"
  "  function wantedSection(d) {\n"
  "    if (!d || typeof d !== 'object') return null;\n"
  "    var c = [d, d.Message, d.message, d.data, d.Data, d.customData];\n"
  "    for (var i = 0; i < c.length; i++) { var x = c[i]; if (typeof x === 'string') { try { x = JSON.parse(x); } catch (e) { continue; } }\n"
  "      if (x && typeof x === 'object' && typeof x.jpk_section === 'string' && x.jpk_section) return x.jpk_section; }\n"
  "    return null;\n"
  "  }\n"
  "  function sectionOk(k) { return !!(k && MODS[k] && (!SW || SW.indexOf(k) >= 0)); }\n"
  "  function switchTo(k) { if (!MODS[k] || MODS[k] === cfg) return; cfg = MODS[k]; remember(k); st.filter = 'all'; st.search = ''; st.token++; showList(); }\n")
js = sub1(js, OLD_SW, NEW_SW, 'js switchTo')
OLD_ST = "  function start(init) {\n    live = !!(init && !init.demo);\n"
NEW_ST = OLD_ST + ("    var eid0 = init && init.EntityId, asked = wantedSection(init), last = lastSection();\n"
  "    if (!eid0) { if (sectionOk(asked)) { cfg = MODS[asked]; remember(asked); } else if (sectionOk(last)) cfg = MODS[last]; }\n")
js = sub1(js, OLD_ST, NEW_ST, 'js start')
files['records.js'] = js.encode('utf-8')
files['jpk-intro.js'] = intro

order = ['processes.html'] + [k for k in WANT if k != 'processes.html'] + ['jpk-intro.js']
buf = io.BytesIO()
with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr(zipfile.ZipInfo('plugin-manifest.json', (2026, 10, 28, 8, 30, 0)), manifest, zipfile.ZIP_DEFLATED)
    for k in order:
        z.writestr(zipfile.ZipInfo('app/' + k, (2026, 10, 28, 8, 30, 0)), files[k], zipfile.ZIP_DEFLATED)
open(out_p, 'wb').write(buf.getvalue())
print('OK', out_p, h(buf.getvalue()))
for k in ('processes.html', 'records.js', 'jpk-intro.js'): print('  app/%s %s' % (k, h(files[k])))
