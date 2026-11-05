"""patch_processes_rates.py  (S76 step 3, 5 Nov 2026)
Adds Processes > Rates > "Rates to fill" to the live Processes zip, hash-guarded.

  python -I tools/patch_processes_rates.py <live Processes zip> <out zip>

Refuses unless the two files it edits match Processes v3.4.1 exactly (sha256 prefixes below), so it never patches a zip that
someone changed since. Adds: app/rates-model.js (byte for byte the shared model), app/processes-rates.js, app/rates-demo.js, app/rates.css.
Edits: processes.html (scripts, stylesheet, RECORDS_SWITCH gets 'p_rates', build line -> v3.5.1), records-shell.js (rail icon).
Everything else is copied unchanged.
"""
import hashlib, json, os, sys, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
EXPECT = {'app/processes.html': '34ab1bb9e4c58dff', 'app/records-shell.js': 'd5fc94076288aead'}  # Processes v3.4.1
ADD = {'app/rates-model.js': os.path.join(ROOT, 'rates-model.js'), 'app/processes-rates.js': os.path.join(ROOT, 'app', 'processes-rates.js'),
       'app/rates-demo.js': os.path.join(ROOT, 'app', 'rates-demo.js'), 'app/rates.css': os.path.join(ROOT, 'app', 'rates.css')}

def sha(b): return hashlib.sha256(b).hexdigest()[:16]

def must_replace(text, old, new, what):
    if old not in text: sys.exit('refusing: %s not found' % what)
    return text.replace(old, new, 1)

def main(src, dst):
    zin = zipfile.ZipFile(src)
    names = zin.namelist()
    for n, h in EXPECT.items():
        got = sha(zin.read(n))
        if got != h: sys.exit('refusing: %s is %s, expected %s (Processes v3.4.1)' % (n, got, h))
    html = zin.read('app/processes.html').decode('utf-8')
    html = must_replace(html, "window.RECORDS_SWITCH=['p_contract','p_margins',", "window.RECORDS_SWITCH=['p_contract','p_margins','p_rates',", 'RECORDS_SWITCH')
    html = must_replace(html, '<link rel="stylesheet" href="jpk-s11d.css">', '<link rel="stylesheet" href="jpk-s11d.css">\n<link rel="stylesheet" href="rates.css?v=3.5.1">', 'stylesheet link')
    html = must_replace(html, '<script src="processes-margins.js?v=3.4.1"></script>',
                        '<script src="processes-margins.js?v=3.4.1"></script>\n<script src="rates-model.js?v=1.0.1"></script>\n<script src="rates-demo.js?v=3.5.1"></script>\n<script src="processes-rates.js?v=3.5.1"></script>', 'margins script tag')
    html = must_replace(html, 'content="Processes tab v3.4.1 (', 'content="Processes tab v3.5.1 (S76, 5 Nov 2026: Rates > Rates to fill on rates-model.js 1.0.1, shared with the Leadership tile; 3.5.1: No vendor on rate line flag + Set vendor, styles injected by the script) + v3.4.1 (', 'build line')
    shell = zin.read('app/records-shell.js').decode('utf-8')
    shell = must_replace(shell, "p_margins: '", "p_rates: 'M4 6h16M4 12h16M4 18h10M18 16l2 2 3-4', p_margins: '", 'rail icons')
    zout = zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED)
    for n in names:
        if n.endswith('/'): continue
        if n in ADD: continue
        data = zin.read(n)
        if n == 'app/processes.html': data = html.encode('utf-8')
        elif n == 'app/records-shell.js': data = shell.encode('utf-8')
        zout.writestr(n, data)
    css = open(ADD['app/rates.css'], encoding='utf-8').read()
    for n, p in ADD.items():
        with open(p, 'rb') as f: data = f.read()
        if n == 'app/processes-rates.js':  # inject the styles from the script too: inside Zoho the <link> alone did not apply (5 Nov)
            inj = "(function () { if (document.getElementById('rt-css')) return; var s = document.createElement('style'); s.id = 'rt-css'; s.textContent = " + json.dumps(css) + "; document.head.appendChild(s); })();\n"
            data = inj.encode('utf-8') + data
        zout.writestr(n, data)
    zout.close()
    print('wrote', dst)
    for n in ['app/processes.html', 'app/records-shell.js'] + list(ADD): print(' ', n, sha(zipfile.ZipFile(dst).read(n)))

if __name__ == '__main__':
    if len(sys.argv) != 3: sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
