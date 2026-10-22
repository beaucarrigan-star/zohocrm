"""Build demo.html: the v5.11 widget's own section markup (rendered once in ?preview=1&ntdemo=1, network blocked, then frozen)
plus its style blocks, the real needs-today-js block, a small stand-in script and the shell. Usage:
  python3 -I make_demo.py <base widget.html> <build dir>
The base file is only read (opened in a sandboxed headless browser with every non-file request aborted)."""
import sys, re, json, hashlib, pathlib
from playwright.sync_api import sync_playwright

base = pathlib.Path(sys.argv[1]).resolve()
out = pathlib.Path(sys.argv[2]).resolve()
src = base.read_text(encoding='utf-8')
assert hashlib.sha256(base.read_bytes()).hexdigest() == 'e86ba0ea396a830d8058fca6a2c201e25bee46f56ceeea028c07964bcd8d835f', 'base hash mismatch'

m = re.search(r'<script id="needs-today-js">(.*?)</script>', src, re.S)
needs_js = m.group(1)
m = re.search(r'<section id="needs-today"[^>]*></section>', src)
needs_orig = m.group(0)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1400, 'height': 900}, color_scheme='light')
    pg = ctx.new_page()
    pg.route('**/*', lambda r: r.continue_() if r.request.url.startswith('file:') else r.abort())
    pg.goto(base.as_uri() + '?preview=1&ntdemo=1')
    pg.wait_for_timeout(4000)
    data = pg.evaluate("""() => {
      const styles = Array.from(document.querySelectorAll('style')).map(s => s.outerHTML);
      const page = document.getElementById('page').cloneNode(true);
      page.querySelectorAll('script, .hl-bar-ph').forEach(n => n.remove());
      page.querySelectorAll('.hl-pinned, .hl-show, .hl-anchor').forEach(n => n.classList.remove('hl-pinned', 'hl-show', 'hl-anchor'));
      const nt = page.querySelector('#needs-today'); nt.outerHTML = '@@NEEDS@@';
      page.querySelector('#nt-nav').innerHTML = '';
      return { styles, page: page.outerHTML };
    }""")
    b.close()

page_html = data['page'].replace('@@NEEDS@@', needs_orig)
page_html = re.sub(r'<script\b.*?</script>', '', page_html, flags=re.S)
assert not re.search(r'<[^>]+\son[a-z]+="', page_html), 'inline handler found'
standin = (out / 'tools' / 'demo-standin.js').read_text(encoding='utf-8')
config = (out / 'tools' / 'cs-config.js').read_text(encoding='utf-8')

html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<!-- S24 step 5 demo: Beau CS Home v5.11 sections (frozen preview render) + jpk-shell. Not a widget build. -->
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BD + CS Home</title>
{chr(10).join(data['styles'])}
<link rel="stylesheet" href="jpk-shell.css">
</head>
<body>
{page_html}
<script id="demo-standin">{standin}</script>
<script id="needs-today-js">{needs_js}</script>
<script id="jpk-shell-config">{config}</script>
<script src="jpk-shell.js"></script>
</body>
</html>
"""
(out / 'demo.html').write_text(html, encoding='utf-8')
print('demo.html', len(html), 'bytes')
