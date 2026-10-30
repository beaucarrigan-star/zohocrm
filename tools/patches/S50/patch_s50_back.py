"""S50 (30 Oct 2026): Back button (jpk-back.js v1.0.0) on the tool pages the home pages link to.
Each base is the zip whose files match what Zoho served on 30 Oct 2026 13:40 (index page hash below).
Refuses any base whose index page differs. Usage: python3 patch_s50_back.py BASE_DIR OUT_DIR jpk-back.js"""
import sys, hashlib, pathlib, shutil
h = lambda b: hashlib.sha256(b).hexdigest()[:16]
def die(m): sys.exit('REFUSED: ' + m)
base, out, js = map(pathlib.Path, sys.argv[1:4])
PAGES = {  # key: (index file, served sha16, label for the build meta)
    'accessories': ('ship.html', '29d84ce88b916be7', 'Accessories tab'),
    'stock': ('stock.html', 'f6cd5954acc3bb4d', 'Stock Alerts tab'),
    'processes': ('processes.html', 'cd22876d32fde6e2', 'Processes tab v3.2.1'),
    'records': ('records.html', 'f5d7af1e1a8ba3b4', 'Records tab v3.4'),
    'support': ('support.html', '2e525e21fd8add3a', 'Support tab v3.4'),
    'worktoday': ('work-today.html', '37420da1a7025b3c', 'Your Work Today tab'),
    'lost': ('lost.html', '2d0a4e8a3419356c', 'Lost and Damaged Devices tab v4.2'),
}
code = js.read_text(encoding='utf-8')
for k, (idx, want, label) in PAGES.items():
    src = base / k
    p = src / 'app' / idx
    got = h(p.read_bytes())
    if got != want: die(f'{k}: {idx} is {got}, expected {want}')
    dst = out / k
    if dst.exists(): shutil.rmtree(dst)
    shutil.copytree(src, dst)
    q = dst / 'app' / idx
    t = q.read_text(encoding='utf-8')
    if t.count('</body>') != 1: die(f'{k}: </body> count {t.count("</body>")}')
    t = t.replace('</body>', '<script src="jpk-back.js"></script>\n</body>')
    import re
    m = re.search(r'<meta name="jpk-build" content="([^"]*)">', t)
    if not m: die(f'{k}: no jpk-build meta')
    t = t.replace(m.group(0), '<meta name="jpk-build" content="' + label + ' + S50 Back button (jpk-back v1.0.0, 30 Oct 2026); was: ' + m.group(1).replace('"', "'") + '">')
    q.write_text(t, encoding='utf-8')
    (dst / 'app' / 'jpk-back.js').write_text(code, encoding='utf-8')
    print(k, 'ok', h(q.read_bytes()))
