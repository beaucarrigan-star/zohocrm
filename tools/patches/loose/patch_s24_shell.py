"""S24 step 7: patch the page shell and the calendar into the Beau CS Home widget (v5.11 -> v6.0).

Usage:  python3 -I patch_s24_shell.py <base widget.html> <build dir> <out dir>
Writes: <out dir>/app/widget.html, <out dir>/plugin-manifest.json (copied from the base's folder, unchanged)
        <out dir>/BD-CS-Home-v6.0-s24-shell.zip, <out dir>/PATCH-REPORT.txt

What it does: inserts whole lines just before the final </body>. No existing line is changed.
Hash gate: the base must be v5.11 (sha256 below). After patching, the inserted block is cut out again and the
remainder must hash to the v5.11 sha256, so section code is provably untouched. Running it twice on the same base
gives byte-identical output (idempotent); running it on an already patched file is refused.
"""
import sys, hashlib, pathlib, zipfile, re

BASE_SHA = 'e86ba0ea396a830d8058fca6a2c201e25bee46f56ceeea028c07964bcd8d835f'
BUILD_TAG = 'Beau CS Home v6.0 (v5.11 + S24 page shell and calendar, 22 Oct 2026)'
BEGIN = '<!-- jpk-s24:begin -->\n'
END = '<!-- jpk-s24:end -->\n'


def sha(b):
    return hashlib.sha256(b).hexdigest()


def main():
    base_path = pathlib.Path(sys.argv[1]).resolve()
    build = pathlib.Path(sys.argv[2]).resolve()
    out = pathlib.Path(sys.argv[3]).resolve()
    raw = base_path.read_bytes()
    if b'jpk-s24:begin' in raw:
        sys.exit('REFUSED: the base already carries the S24 patch.')
    if sha(raw) != BASE_SHA:
        sys.exit('REFUSED: base widget.html sha256 is %s, expected the v5.11 hash %s' % (sha(raw), BASE_SHA))
    src = raw.decode('utf-8')

    def rd(rel):
        t = (build / rel).read_text(encoding='utf-8')
        return t if t.endswith('\n') else t + '\n'

    parts = {
        'shell_css': rd('jpk-shell.css'), 'cal_css': rd('jpk-calendar.css'),
        'cfg': rd('tools/cs-config.js'), 'cal_js': rd('jpk-calendar.js'), 'shell_js': rd('jpk-shell.js'),
    }
    for k in ('cfg', 'cal_js', 'shell_js'):
        if re.search(r'</script', parts[k], re.I):
            sys.exit('REFUSED: %s contains a closing script tag and cannot be inlined safely' % k)
    for k in ('shell_css', 'cal_css'):
        if re.search(r'</style', parts[k], re.I):
            sys.exit('REFUSED: %s contains a closing style tag and cannot be inlined safely' % k)

    block = (BEGIN
             + '<meta name="jpk-build" content="%s">\n' % BUILD_TAG
             + '<style id="jpk-shell-css">\n' + parts['shell_css'] + '</style>\n'
             + '<style id="jpk-calendar-css">\n' + parts['cal_css'] + '</style>\n'
             + '<script id="jpk-shell-config">\n' + parts['cfg'] + '</script>\n'
             + '<script id="jpk-calendar-js">\n' + parts['cal_js'] + '</script>\n'
             + '<script id="jpk-shell-js">\n' + parts['shell_js'] + '</script>\n'
             + END)

    i = src.rindex('</body>')
    if i != 0 and src[i - 1] != '\n':
        sys.exit('REFUSED: the final </body> is not at the start of a line')
    patched = src[:i] + block + src[i:]

    # Hash gate: cut the inserted block out and compare with the base.
    a = patched.index(BEGIN); b = patched.index(END) + len(END)
    restored = patched[:a] + patched[b:]
    if sha(restored.encode('utf-8')) != BASE_SHA:
        sys.exit('FAILED: the patched file minus the inserted block does not equal the v5.11 base')

    app = out / 'app'; app.mkdir(parents=True, exist_ok=True)
    wp = app / 'widget.html'
    wp.write_bytes(patched.encode('utf-8'))
    man_src = base_path.parent.parent / 'plugin-manifest.json'
    man = man_src.read_bytes()
    (out / 'plugin-manifest.json').write_bytes(man)

    zp = out / 'BD-CS-Home-v6.0-s24-shell.zip'
    if zp.exists():
        zp.unlink()
    with zipfile.ZipFile(zp, 'w', zipfile.ZIP_DEFLATED) as z:
        for name, data in (('plugin-manifest.json', man), ('app/widget.html', patched.encode('utf-8'))):
            zi = zipfile.ZipInfo(name, date_time=(2026, 10, 22, 12, 0, 0)); zi.compress_type = zipfile.ZIP_DEFLATED
            zi.external_attr = 0o644 << 16
            z.writestr(zi, data)

    rep = [
        'S24 patch report',
        'base widget.html sha256: ' + BASE_SHA + ' (v5.11, matched)',
        'base bytes: %d   patched bytes: %d   inserted bytes: %d' % (len(raw), len(patched.encode("utf-8")), len(block.encode("utf-8"))),
        'patched widget.html sha256: ' + sha(patched.encode('utf-8')),
        'patched minus inserted block == base sha256: YES',
        'manifest: copied unchanged (sha256 %s)' % sha(man),
        'zip: %s  sha256 %s' % (zp.name, sha(zp.read_bytes())),
        'build tag (new meta line; the old data-build line is untouched): ' + BUILD_TAG,
        'load order: config, calendar js, shell js; all after every existing script',
    ]
    (out / 'PATCH-REPORT.txt').write_text('\n'.join(rep) + '\n', encoding='utf-8')
    print('\n'.join(rep))


if __name__ == '__main__':
    main()
