"""Test-only copy of the v5.11 widget with the shell referenced (NOT the S24 patch; that is step 7's patch_s24_shell.py).
Usage: python3 -I make_real.py <base widget.html> <build dir>  ->  <build dir>/tmp-real/widget-shell.html"""
import sys, re, shutil, hashlib, pathlib
base = pathlib.Path(sys.argv[1]).resolve(); out = pathlib.Path(sys.argv[2]).resolve()
raw = base.read_bytes()
assert hashlib.sha256(raw).hexdigest() == 'e86ba0ea396a830d8058fca6a2c201e25bee46f56ceeea028c07964bcd8d835f'
src = raw.decode('utf-8')
d = out / 'tmp-real'; d.mkdir(exist_ok=True)
for f in ('jpk-shell.css', 'jpk-shell.js'): shutil.copy(out / f, d / f)
cfg = (out / 'tools' / 'cs-config.js').read_text(encoding='utf-8')
ins = '<link rel="stylesheet" href="jpk-shell.css">\n<script id="jpk-shell-config">' + cfg + '</script>\n<script src="jpk-shell.js"></script>\n'
i = src.rindex('</body>'); assert src[i:].strip() in ('</body>\n</html>', '</body></html>', '</body>\n</html>\n') or src[i:].startswith('</body>')
(d / 'widget-shell.html').write_text(src[:i] + ins + src[i:], encoding='utf-8')
shutil.copy(base, d / 'widget-base.html')
print('ok')
