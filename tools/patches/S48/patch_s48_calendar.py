"""S48 (30 Oct 2026): a cleaner calendar on the four homes. Adds layer jpk-s48 (code/jpk-s48.css + code/jpk-s48.js) just before
</head>, so its key listener runs before the popout's. Month pills: the time on its own line (weekends too), title up to two lines.
Day range popover (S32): clicking its Start or End list no longer resets and closes it.
New meeting form: Date, Starts and Ends open a picker on a click anywhere on them; Ends shows each choice's length; length chips.
Off switch ?s48=0.

Usage: python3 -I patch_s48_calendar.py <home> <base.zip> <code dir> <out.zip>     home = cs | bd | em | lead
Bases are checked by the sha256 (first 16) of the zip and of app/widget.html; anything else is refused. Every other zip entry is
copied byte for byte, in the same order.
"""
import hashlib, io, os, sys, zipfile

DATE = '30 Oct 2026'
BASE = {  # zip, widget.html
    'cs':   ('4f9381d90179e29f', None),   # BD-CS-Home-v6.13.1-s47-recip.zip (S47, carries the S38 frame and S47 stock emails)
    'bd':   ('24ff3254612787e7', None),   # BD-Home-v6.5-s39-leftovers.zip
    'em':   ('9c4c9a0f2beb0ff5', None),   # EM-Home-v39.4-s38-phase5.zip
    'lead': ('d7cb95f84e4a7476', None),   # Leadership-Home-v47.4-s39-leftovers.zip
}
VER = {
    'cs':   [('<meta name="jpk-build" content="Beau CS Home v6.13.1 (v6.13.0 + S47 multi-select To on stock emails, 30 Oct 2026)">',
              '<meta name="jpk-build" content="Beau CS Home v6.13.2 (v6.13.1 S47 + S48 cleaner calendar: times on their own line, click-anywhere date and time pickers, %s)">' % DATE, 1),
             ("build: 'Beau CS Home v6.13.0'", "build: 'Beau CS Home v6.13.2'", 2)],
    'bd':   [('<meta name="jpk-build" content="BD Home v6.5 (v6.4 S38 + S39 boards like CS and Follow-ups renewals not started in 120 days, 27 Oct 2026)">',
              '<meta name="jpk-build" content="BD Home v6.6 (v6.5 S39 + S48 cleaner calendar: times on their own line, click-anywhere date and time pickers, %s)">' % DATE, 1),
             ("build: 'BD Home v6.5'", "build: 'BD Home v6.6'", 1)],
    'em':   [('<meta name="jpk-build" content="EM Home v39.4 (v39.2 S32 calendar + S35 guide blurb line + S38 Phase 5 frame, 27 Oct 2026)">',
              '<meta name="jpk-build" content="EM Home v39.5 (v39.4 S38 + S48 cleaner calendar: times on their own line, click-anywhere date and time pickers, %s)">' % DATE, 1),
             ("build: 'EM Home v39.4'", "build: 'EM Home v39.5'", 1)],
    'lead': [('<meta name="jpk-build" content="Leadership Home v47.4 (v47.3 S38 + S39 meeting voice from BD Home: S36 mic and S37 say the whole meeting, 27 Oct 2026)">',
              '<meta name="jpk-build" content="Leadership Home v47.5 (v47.4 S39 + S48 cleaner calendar: times on their own line, click-anywhere date and time pickers, %s)">' % DATE, 1),
             ("build: 'Leadership Home v47.4'", "build: 'Leadership Home v47.5'", 1)],
}

def die(m): raise SystemExit('S48 %s: %s' % (sys.argv[1] if len(sys.argv) > 1 else '?', m))
def sha(b): return hashlib.sha256(b).hexdigest()
def rep(h, old, new, n):
    c = h.count(old)
    if c != n: die('expected %d match(es), found %d for: %s' % (n, c, old[:140]))
    return h.replace(old, new)

def main():
    if len(sys.argv) != 5 or sys.argv[1] not in BASE: die(__doc__)
    home, zp, code, out = sys.argv[1:]
    raw = open(zp, 'rb').read()
    if sha(raw)[:16] != BASE[home][0]: die('%s is not the expected base (sha256 %s)' % (os.path.basename(zp), sha(raw)[:16]))
    zin = zipfile.ZipFile(io.BytesIO(raw))
    h = zin.read('app/widget.html').decode('utf-8')
    if 'jpk-s48' in h: die('base already carries jpk-s48')
    css = open(os.path.join(code, 'jpk-s48.css'), encoding='utf-8').read()
    js = open(os.path.join(code, 'jpk-s48.js'), encoding='utf-8').read()
    if '</style' in css or '</script' in js or '<!--' in js or '<!--' in css: die('layer files must not contain closing tags or comment openers')
    if h.count('class="jpk-mo-form"') != 1 or h.count('<input name="s" type="time" step="300" required>') != 1: die('New meeting form not found once')
    for old, new, n in VER[home]: h = rep(h, old, new, n)
    # S32 day range popover: closest('[data-s32]') also matched <html data-s32="on">, so a click on the Start or End list counted as
    # "7 AM to 6 PM" (reset) and closed the popover. Only the popover's own buttons count now.
    h = rep(h, "var a = e.target.closest && e.target.closest('[data-s32]'); if (!a) return;",
            "var a = e.target.closest && e.target.closest('[data-s32]'); if (!a || !p.contains(a)) return;   /* S48: <html data-s32> matched too */", 1)
    block = '<!-- jpk-s48:start -->\n<style id="jpk-s48-css">\n' + css + '</style>\n<script id="jpk-s48-js">\n' + js + '</script>\n<!-- jpk-s48:end -->\n'
    h = rep(h, '</head>', block + '</head>', 1)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zo:
        for info in zin.infolist():
            data = h.encode('utf-8') if info.filename == 'app/widget.html' else zin.read(info.filename)
            ni = zipfile.ZipInfo(info.filename, date_time=info.date_time); ni.compress_type = zipfile.ZIP_DEFLATED; ni.external_attr = info.external_attr
            zo.writestr(ni, data)
    open(out, 'wb').write(buf.getvalue())
    print(home, os.path.basename(out), 'zip', sha(buf.getvalue())[:16], 'widget.html', sha(h.encode('utf-8'))[:16])

main()
