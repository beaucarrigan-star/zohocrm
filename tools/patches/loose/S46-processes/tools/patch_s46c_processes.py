"""S46 part 3 (30 Oct 2026): Processes v3.2.1 = v3.2.0 minus Ended contracts in the Pipeline. Hash-guarded on v3.2.0 (6575fd5d334c4fcd)."""
import hashlib, io, sys, zipfile
BASE, OUT = sys.argv[1], sys.argv[2]
def h(b): return hashlib.sha256(b).hexdigest()[:16]
raw = open(BASE, 'rb').read(); assert h(raw) == '6575fd5d334c4fcd', 'base zip ' + h(raw)
zin = zipfile.ZipFile(io.BytesIO(raw)); files = {i.filename: zin.read(i.filename) for i in zin.infolist()}
for k, v in {'app/processes.html': '8d42633537eb8945', 'app/processes-view.js': 'f22a0f7a38607da0'}.items():
    assert h(files[k]) == v, '%s %s' % (k, h(files[k]))
def rep(name, pairs):
    t = files[name].decode('utf-8')
    for a, b in pairs:
        assert t.count(a) == 1, '%s: expected one "%s"' % (name, a[:70]); t = t.replace(a, b)
    files[name] = t.encode('utf-8')
rep('app/processes-view.js', [
 ("      function finish(rows) { S.rows = rows; if (o.derive) rows.forEach(o.derive);",
  "      function finish(rows) { if (o.keep) rows = rows.filter(o.keep); S.rows = rows; if (o.derive) rows.forEach(o.derive);"),
 ("      return pageAll('select id, ' + o.select + ' from ' + o.entity + ' where id is not null', 'id asc').then(finish,",
  "      return pageAll('select id, ' + o.select + ' from ' + o.entity + ' where ' + (o.where || 'id is not null'), 'id asc').then(finish,"),
 ("    derive: contractDerive, detailExtra: contractLinesHtml,",
  "    derive: contractDerive, detailExtra: contractLinesHtml,\n    where: \"(Contract_Status is null or Contract_Status != 'Ended')\", keep: function (r) { return s(r.Contract_Status) !== 'Ended'; },"),
 ("    sub: 'Where each contract is in review, cleanup and reconciliation. Terms come from Contractbook.',",
  "    sub: 'Where each contract is in review, cleanup and reconciliation. Terms come from Contractbook. Ended contracts are not listed.',"),
])
rep('app/processes.html', [
 ('content="Processes tab v3.2.0 (v3.1.3 + contract dates, devices and pricing per contract, tri-brand logo restored, S46 30 Oct 2026)"',
  'content="Processes tab v3.2.1 (v3.2.0; Pipeline leaves out Ended contracts, S46 30 Oct 2026)"'),
])
with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as zout:
    for i in zin.infolist(): zout.writestr(i.filename, files[i.filename])
print('wrote', OUT, h(open(OUT, 'rb').read()))
for k in ['app/processes.html', 'app/processes-view.js']: print(k, h(files[k]))
