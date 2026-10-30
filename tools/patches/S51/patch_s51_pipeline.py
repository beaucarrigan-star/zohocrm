#!/usr/bin/env python3
"""patch_s51_pipeline.py (S51, 30 Oct 2026): BD Home v6.6 (S48) -> v6.7 with the jpk-s51 pipeline tools layer.
Hash-guarded: refuses any base zip or widget.html whose sha256 is not S48's. Keeps the base zip. plugin-manifest.json copied byte for byte.
Usage: patch_s51_pipeline.py <base zip> <out dir> [--css jpk-s51.css] [--js jpk-s51.js]"""
import argparse, hashlib, io, os, sys, zipfile

BASE_ZIP = 'c4635d705aa501c1'
BASE_HTML = 'dc7abb91ae5cff47'
OLD_META = '<meta name="jpk-build" content="BD Home v6.6 (v6.5 S39 + S48 cleaner calendar: times on their own line, click-anywhere date and time pickers, 30 Oct 2026)">'
NEW_META = '<meta name="jpk-build" content="BD Home v6.7 (v6.6 S48 + S51 pipeline tools: stage board, quadrant, forecast tile, 30 Oct 2026)">'
OLD_BUILD = "  build: 'BD Home v6.6',"
NEW_BUILD = "  build: 'BD Home v6.7',"
ANCHOR = '<!-- jpk-s39:end -->'
OUT_NAME = 'BD-Home-v6.7-s51-pipeline.zip'

def sha16(b): return hashlib.sha256(b).hexdigest()[:16]

def once(s, old, new, what):
    n = s.count(old)
    if n != 1: sys.exit('refused: %s found %d times, expected 1' % (what, n))
    return s.replace(old, new)

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('base'); ap.add_argument('out'); ap.add_argument('--css', default='jpk-s51.css'); ap.add_argument('--js', default='jpk-s51.js')
    a = ap.parse_args()
    raw = open(a.base, 'rb').read()
    if sha16(raw) != BASE_ZIP: sys.exit('refused: base zip sha256 %s is not S48 (%s)' % (sha16(raw), BASE_ZIP))
    z = zipfile.ZipFile(io.BytesIO(raw))
    names = z.namelist()
    if sorted(n for n in names if not n.endswith('/')) != ['app/widget.html', 'plugin-manifest.json']: sys.exit('refused: unexpected zip contents %r' % names)
    html = z.read('app/widget.html')
    if sha16(html) != BASE_HTML: sys.exit('refused: widget.html sha256 %s is not S48 (%s)' % (sha16(html), BASE_HTML))
    manifest = z.read('plugin-manifest.json')
    css = open(a.css, encoding='utf-8').read().strip(); js = open(a.js, encoding='utf-8').read().strip()
    if '</script' in js or '</style' in css: sys.exit('refused: layer contains a closing tag')
    s = html.decode('utf-8')
    if 'jpk-s51' in s: sys.exit('refused: base already carries jpk-s51')
    s = once(s, OLD_META, NEW_META, 'jpk-build meta')
    s = once(s, OLD_BUILD, NEW_BUILD, 'shell build string')
    block = ('\n<!-- jpk-s51:start -->\n<style id="jpk-s51-css">\n%s\n</style>\n<script id="jpk-s51">\n%s\n</script>\n<!-- jpk-s51:end -->' % (css, js))
    s = once(s, ANCHOR, ANCHOR + block, 'jpk-s39 end anchor')
    left = s.replace(NEW_META, '')
    if 'v6.6' in left: sys.exit('refused: a v6.6 label is left: ' + left[left.index('v6.6') - 80:left.index('v6.6') + 40])
    out = s.encode('utf-8')
    os.makedirs(a.out, exist_ok=True)
    path = os.path.join(a.out, OUT_NAME)
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as o:
        for n in names:   # same entries and order as the base (Zoho accepted that shape)
            if n == 'app/widget.html': o.writestr(n, out)
            elif n == 'plugin-manifest.json': o.writestr(n, manifest)
            else: o.writestr(n, z.read(n))
    print('wrote', path)
    print('zip sha16', sha16(open(path, 'rb').read()))
    print('widget.html sha16', sha16(out), 'bytes', len(out))
    print('css', sha16(css.encode()), 'js', sha16(js.encode()))

if __name__ == '__main__': main()
