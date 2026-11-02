"""Build next-step-v1.2.0-s64.zip (S64). Refuses to run unless the v1.1.0 base at tag next-step-v1.1.0-s41 matches the served hashes.
Usage (repo root): python -I widgets/next-step/tests/build-zip.py <out.zip> <base-zip-for-manifest>
The zip has the same layout as v1.1.0: plugin-manifest.json at the top, the page files under app/. Prints every hash (sha256, first 16)."""
import hashlib, subprocess, sys, zipfile, os

SERVED_V110 = {'widget.html': '7c28ef6dd95fe360', 'next-step.js': '326d993391e82044', 'next-step-model.js': '7f2f3971997bf6f8',
               'next-step.css': '5754badc5218b465', 'demo-data.js': 'b8c6d289280deefd'}
APP = ['widget.html', 'next-step.css', 'next-step-model.js', 'demo-data.js', 'deal-stages.js', 'next-step.js']
here = os.path.dirname(os.path.abspath(__file__))
app_dir = os.path.join(here, '..', 'app')

def h(b): return hashlib.sha256(b).hexdigest()[:16]

out, base_zip = sys.argv[1], sys.argv[2]
for f, want in SERVED_V110.items():
    got = h(subprocess.check_output(['git', 'show', 'next-step-v1.1.0-s41:widgets/next-step/app/' + f], cwd=here))
    if got != want:
        sys.exit('REFUSED: base %s is %s, served is %s' % (f, got, want))
print('base v1.1.0 matches the served hashes (5 files)')
with zipfile.ZipFile(base_zip) as z:
    manifest = z.read('plugin-manifest.json')
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('plugin-manifest.json', manifest)
    print('%s  plugin-manifest.json (from %s, unchanged)' % (h(manifest), os.path.basename(base_zip)))
    for f in APP:
        b = open(os.path.join(app_dir, f), 'rb').read()
        if b'\r' in b:
            sys.exit('REFUSED: %s has CR line endings' % f)
        z.writestr('app/' + f, b)
        print('%s  app/%s' % (h(b), f))
print('%s  %s' % (h(open(out, 'rb').read()), os.path.basename(out)))
