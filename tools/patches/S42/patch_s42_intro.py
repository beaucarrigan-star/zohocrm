"""patch_s42_intro.py: S42 (28 Oct 2026), the Phase 3b (S35) guide line on the remaining tool widgets.
- Stock Alerts, Accessories, Order area: live pages (s42-live-bases-2026-10-28.json, read from Zoho 28 Oct) carry
  jpk-intro v1.0.0 (38a4e3d535ad0c5f). Swap that one file for v1.1.0 (ea85cec2c053f51a, byte for byte from Records v3.4).
- Account Roles, Billing Findings, Briefing Steps, Case Strip: same swap, on the 16 Oct rollout zips (not readable live:
  the record canvases do not show these related lists; Developer Hub shows them last changed 16 Oct).
- Your Work Today: live page has no strip; add jpk-intro v1.1.0 with the guide v2 wording.
Each html also gets a jpk-build meta so the served page names its version. Refuses any base whose sha256 differs.
Usage: python3 patch_s42_intro.py LIVE.json ROLLOUT_DIR RECORDS_V34.zip OUT_DIR
"""
import sys, json, base64, hashlib, zipfile, io, os

h = lambda b: hashlib.sha256(b).hexdigest()[:16]
def die(m): sys.exit('REFUSED: ' + m)
LIVE_JSON = '3bb70c688226d2e3'
RECORDS_ZIP = 'cbce00c6d94c703f'
V100, V110 = '38a4e3d535ad0c5f', 'ea85cec2c053f51a'
DT = (2026, 10, 28, 10, 30, 0)
LIVE = {  # key: (index, html sha16, label)
    'stock-alerts': ('stock.html', 'a1547f550a815b02', 'Stock Alerts tab'),
    'accessories': ('ship.html', 'bb4ce762ae3401a1', 'Accessories tab (Accessory board)'),
    'order-area': ('order.html', '56dabaa2119cfd50', 'Order area'),
    'your-work-today': ('work-today.html', 'd600d14fc42be2c4', 'Your Work Today tab'),
}
ROLL = {  # zip name: (zip sha16, index, label)
    'account-roles-widget-v3-waveE.zip': (None, 'account-roles.html', 'Account Roles panel'),
    'billing-findings-widget-v3-waveB3.zip': (None, 'findings.html', 'Billing Findings board'),
    'briefing-steps-widget-v3-waveF.zip': (None, 'briefing-steps.html', 'Briefing Steps'),
    'case-strip-widget-v3-waveD.zip': (None, 'case-strip.html', 'Case Strip'),
}
ROLL_SHA = {'account-roles-widget-v3-waveE.zip': '1d1a4212286bd351', 'billing-findings-widget-v3-waveB3.zip': '7b1add0ac7b4f6ff',
            'briefing-steps-widget-v3-waveF.zip': '4866b374e0938c44', 'case-strip-widget-v3-waveD.zip': '99435207536d3edc'}
YWT_TAG = ('<script src="jpk-intro.js"\n  data-id="your-work-today"\n'
  '  data-what="One list of everything with your name on it that is due or overdue, across cases, tasks, findings and renewals. Replaces the weekly digest email."\n'
  '  data-fed="Cases, Tasks, Billing Findings, Contracts"\n'
  '  data-feeds="Nothing (opens the record)"></script>\n')

def sub1(t, old, new, what):
    if t.count(old) != 1: die('%s: anchor found %d times' % (what, t.count(old)))
    return t.replace(old, new)

def meta(html, label, what):
    t = html.decode('utf-8')
    if 'name="jpk-build"' in t: die(what + ': already has a jpk-build meta')
    i = t.find('</title>')
    if i < 0 or t.count('</title>') != 1: die(what + ': no single </title>')
    m = '<meta name="jpk-build" content="%s (S42: guide line on jpk-intro v1.1.0, 28 Oct 2026)">' % label
    return (t[:i + 8] + '\n' + m + t[i + 8:]).encode('utf-8')

def write(out, name, manifest, files):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr(zipfile.ZipInfo('plugin-manifest.json', DT), manifest, zipfile.ZIP_DEFLATED)
        for k in sorted(files):
            z.writestr(zipfile.ZipInfo('app/' + k, DT), files[k], zipfile.ZIP_DEFLATED)
    open(os.path.join(out, name), 'wb').write(buf.getvalue())
    return h(buf.getvalue())

def main():
    live_p, roll_d, rec_p, out = sys.argv[1:5]
    raw = open(live_p, 'rb').read()
    if h(raw) != LIVE_JSON: die('live json sha256 %s' % h(raw))
    rb = open(rec_p, 'rb').read()
    if h(rb) != RECORDS_ZIP: die('records zip sha256 %s' % h(rb))
    intro = zipfile.ZipFile(io.BytesIO(rb)).read('app/jpk-intro.js')
    if h(intro) != V110: die('jpk-intro v1.1.0 sha256')
    os.makedirs(out, exist_ok=True)
    report = []
    W = json.loads(raw)['widgets']
    for k, (idx, hs, label) in LIVE.items():
        w = W[k]; files = {}
        for f, v in w['files'].items():
            b = base64.b64decode(v['b64'])
            if h(b) != v['sha16']: die('%s/%s corrupt' % (k, f))
            files[f] = b
        if h(files[idx]) != hs: die('%s %s sha256 %s' % (k, idx, h(files[idx])))
        if w['missing']: die('%s: files missing from the live read' % k)
        man = base64.b64decode(w['manifest']['b64'])
        if k == 'your-work-today':
            if 'jpk-intro.js' in files: die('ywt already has jpk-intro')
            t = files[idx].decode('utf-8')
            t = sub1(t, '</script></body></html>', '</script>\n' + YWT_TAG + '</body></html>', 'ywt body end')
            files[idx] = t.encode('utf-8')
        else:
            if h(files['jpk-intro.js']) != V100: die('%s jpk-intro is not v1.0.0' % k)
        files['jpk-intro.js'] = intro
        files[idx] = meta(files[idx], label, k)
        name = 'widget-%s-s42-intro.zip' % k
        report.append((name, write(out, name, man, files), 'app/' + idx, h(files[idx]), 'live ' + hs))
    for zn, (_, idx, label) in ROLL.items():
        zb = open(os.path.join(roll_d, zn), 'rb').read()
        if h(zb) != ROLL_SHA[zn]: die('%s sha256 %s' % (zn, h(zb)))
        zf = zipfile.ZipFile(io.BytesIO(zb)); files = {}; man = None
        for n in zf.namelist():
            if n.endswith('/'): continue
            if n == 'plugin-manifest.json': man = zf.read(n)
            elif n.startswith('app/'): files[n[4:]] = zf.read(n)
            else: die('%s: unexpected path %s' % (zn, n))
        if h(files['jpk-intro.js']) != V100: die('%s jpk-intro is not v1.0.0' % zn)
        files['jpk-intro.js'] = intro
        files[idx] = meta(files[idx], label, zn)
        name = zn.replace('.zip', '-s42-intro.zip')
        report.append((name, write(out, name, man, files), 'app/' + idx, h(files[idx]), 'zip ' + h(zb)))
    for r in report: print('OK', *r)

if __name__ == '__main__':
    main()
