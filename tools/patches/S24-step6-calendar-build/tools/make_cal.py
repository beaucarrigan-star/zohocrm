"""S24 step 6: test pages with the calendar wired in (NOT the S24 patch; that is step 7's patch_s24_shell.py).
Usage: python3 -I make_cal.py <base widget.html> <build dir>
  -> <build dir>/demo-cal.html             demo.html + jpk-calendar.css/js (calendar script BEFORE jpk-shell.js)
  -> <build dir>/tmp-real/widget-cal.html  the real v5.11 widget + shell + calendar (test copy only)"""
import sys, shutil, hashlib, pathlib
base = pathlib.Path(sys.argv[1]).resolve(); out = pathlib.Path(sys.argv[2]).resolve()
raw = base.read_bytes()
assert hashlib.sha256(raw).hexdigest() == 'e86ba0ea396a830d8058fca6a2c201e25bee46f56ceeea028c07964bcd8d835f', 'base hash mismatch'

demo = (out / 'demo.html').read_text(encoding='utf-8')
a = '<link rel="stylesheet" href="jpk-shell.css">'; b = '<script src="jpk-shell.js"></script>'
assert demo.count(a) == 1 and demo.count(b) == 1
demo = demo.replace(a, a + '\n<link rel="stylesheet" href="jpk-calendar.css">').replace(b, '<script src="jpk-calendar.js"></script>\n' + b)
demo = demo.replace('<!-- S24 step 5 demo:', '<!-- S24 step 6 demo (calendar wired in):', 1)
(out / 'demo-cal.html').write_text(demo, encoding='utf-8')

src = raw.decode('utf-8')
d = out / 'tmp-real'; d.mkdir(exist_ok=True)
for f in ('jpk-shell.css', 'jpk-shell.js', 'jpk-calendar.css', 'jpk-calendar.js'): shutil.copy(out / f, d / f)
cfg = (out / 'tools' / 'cs-config.js').read_text(encoding='utf-8')
ins = ('<link rel="stylesheet" href="jpk-shell.css">\n<link rel="stylesheet" href="jpk-calendar.css">\n<script id="jpk-shell-config">' + cfg +
       '</script>\n<script src="jpk-calendar.js"></script>\n<script src="jpk-shell.js"></script>\n')
i = src.rindex('</body>')
(d / 'widget-cal.html').write_text(src[:i] + ins + src[i:], encoding='utf-8')
print('ok: demo-cal.html, tmp-real/widget-cal.html')
