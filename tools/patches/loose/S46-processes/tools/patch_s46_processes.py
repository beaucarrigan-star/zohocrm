"""S46 (30 Oct 2026): Processes v3.1.3 = v3.1.2 minus the Contract > Ingest section.
Hash-guarded: refuses any base whose file hashes differ from the live v3.1.2."""
import hashlib, io, sys, zipfile, os
BASE = sys.argv[1]; OUT = sys.argv[2]
BASE_ZIP = 'dc8618078e8c5d0b'
GUARD = {'app/processes.html': 'b99762df632ff58f', 'app/records.js': '973f1775fbbdc4ab', 'app/processes-view.js': '050a13a66d1e07a5'}
def h(b): return hashlib.sha256(b).hexdigest()[:16]
raw = open(BASE, 'rb').read()
assert h(raw) == BASE_ZIP, 'base zip hash %s != %s' % (h(raw), BASE_ZIP)
zin = zipfile.ZipFile(io.BytesIO(raw))
files = {i.filename: zin.read(i.filename) for i in zin.infolist()}
for k, v in GUARD.items():
    assert h(files[k]) == v, '%s hash %s != %s' % (k, h(files[k]), v)
def rep(name, pairs):
    t = files[name].decode('utf-8')
    for a, b in pairs:
        assert t.count(a) == 1, '%s: expected exactly one "%s"' % (name, a[:60])
        t = t.replace(a, b)
    files[name] = t.encode('utf-8')
rep('app/processes.html', [
    ("window.RECORDS_SWITCH=['p_contract','contract_ingest','billing_run'", "window.RECORDS_SWITCH=['p_contract','billing_run'"),
    ('content="Processes tab v3.1.2 (v3.1-s24 + S35 guide line + S41 open on a section, S42 28 Oct 2026)"',
     'content="Processes tab v3.1.3 (v3.1.2 minus Contract > Ingest; contracts come from Contractbook, S46 30 Oct 2026)"'),
    ('data-what="The monthly and as-needed admin jobs Beau runs: contract ingest and review, vendor billing reconcile, solicitation intake and briefing. Admin only."',
     'data-what="The monthly and as-needed admin jobs Beau runs: contract pipeline and review, vendor billing reconcile, solicitation intake and briefing. Admin only."'),
])
rep('app/processes-view.js', [
    ("key: 'p_contract', title: 'Contract ingest', swLabel: 'Pipeline'", "key: 'p_contract', title: 'Contracts', swLabel: 'Pipeline'"),
    ("sub: 'Where each contract is in ingest, cleanup and reconciliation. Upload new packets under Ingest.'",
     "sub: 'Where each contract is in review, cleanup and reconciliation. Terms come from Contractbook.'"),
    ("foot: 'Read only. Reconciliation compares each contract with the billing system. Packets are uploaded under Ingest.'",
     "foot: 'Read only. Reconciliation compares each contract with the billing system.'"),
])
rep('app/records.js', [
    ("/* records.js S42 (28 Oct 2026, Processes v3.1.2):", "/* records.js S46 (30 Oct 2026, Processes v3.1.3: unchanged code; Ingest section removed from RECORDS_SWITCH in processes.html). S42 (28 Oct 2026, Processes v3.1.2):"),
])
with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as zout:
    for i in zin.infolist():
        zout.writestr(i.filename, files[i.filename])
print('wrote', OUT, h(open(OUT,'rb').read()))
for k in ['app/processes.html', 'app/processes-view.js', 'app/records.js']:
    print(k, h(files[k]))
