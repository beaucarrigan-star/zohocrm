"""S49 (30 Oct 2026): links from Beau CS Home to the Stock Alerts web tab (WebTab13).
Base: BD-CS-Home-v6.13.2-s48-calendar.zip (widget.html aac120c9f964e73c). Refuses any other base.
Usage: python3 patch_s49_stocklink.py CS_DIR"""
import sys, hashlib, pathlib
h = lambda b: hashlib.sha256(b).hexdigest()[:16]
def die(m): sys.exit('REFUSED: ' + m)
def sub(t, o, n, label):
    c = t.count(o)
    if c != 1: die(f'{label}: expected 1 match, found {c}')
    return t.replace(o, n)
p = pathlib.Path(sys.argv[1]) / 'app/widget.html'
if h(p.read_bytes()) != 'aac120c9f964e73c': die('widget.html is ' + h(p.read_bytes()))
t = p.read_text(encoding='utf-8')
ST = 'https://crm.zoho.com/crm/org882980956/tab/WebTab13'
# 1. the Stock alerts tile: whole tile and its corner link open the Stock Alerts page
t = sub(t, '<a class="kpi" id="k-stock" target="_top" data-view="stockAlerts" title="Opens EM Stock Alerts">',
        f'<a class="kpi" id="k-stock" target="_top" href="{ST}" title="Opens the Stock Alerts page">', 'tile')
t = sub(t, '<span class="label">Stock alerts<span class="go" aria-hidden="true">view ↗</span></span>',
        '<span class="label">Stock alerts<span class="go" aria-hidden="true">Stock Alerts ↗</span></span>', 'tile corner')
t = sub(t, "    if (corner && a.id === 'k-acc') return;",
        "    if (corner && a.id === 'k-acc') return;\n"
        "    if (a.id === 'k-stock') { e.stopPropagation(); return; }    /* S49: the Stock alerts tile is a plain link to the Stock Alerts page (WebTab13) */", 'csTile')
t = sub(t, "      if (a && (a.id === 'k-excess' || a.id === 'k-stock')) g.textContent = 'devices ›';",
        "      if (a && a.id === 'k-excess') g.textContent = 'devices ›';\n"
        "      if (a && a.id === 'k-stock') { g.textContent = 'Stock Alerts ↗'; g.removeAttribute('aria-hidden'); return; }   /* S49: real link, no role=link wrapper */", 'corner text')
# 2. the Stock emails to approve card on the Devices tab
t = sub(t, '<div class="band"><h2>Stock emails to approve</h2><span class="meta" id="sm-meta"></span></div>',
        f'<div class="band"><h2>Stock emails to approve</h2><span class="meta" id="sm-meta"></span><a class="s49-st" target="_top" href="{ST}">Open the Stock Alerts page ↗</a></div>', 'sm card')
t = sub(t, '</head>', '<style>/* S49 */ .s49-st{margin-left:auto;font-size:var(--fs-sm,13px);white-space:nowrap}</style>\n</head>', 'css')
# 3. Quick links
t = sub(t, "    ['EM Stock Alerts', 'module', { m: 'EM_Stock_Alerts' }], ['Accessory board', 'web tab', { href: TAB + 'WebTab6', top: true }],",
        "    ['Stock Alerts page', 'web tab: approve emails, customer replies, history', { href: TAB + 'WebTab13', top: true }],\n"
        "    ['EM Stock Alerts', 'module', { m: 'EM_Stock_Alerts' }], ['Accessory board', 'web tab', { href: TAB + 'WebTab6', top: true }],", 'links')
t = sub(t, 'content="Beau CS Home v6.13.2', 'content="Beau CS Home v6.13.3 (S49 Stock Alerts links) from v6.13.2', 'build')
p.write_text(t, encoding='utf-8'); print('patched')
