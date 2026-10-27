"""S39 (27 Oct 2026): cohesion plan Phase 5b, leftovers. BD Home v6.4 -> v6.5 and Leadership Home v47.3 -> v47.4.

Usage:
  python3 -I patch_s39_leftovers.py bd   <BD-Home-v6.4-s38-phase5.zip>          <code dir> <out.zip>
  python3 -I patch_s39_leftovers.py lead <Leadership-Home-v47.3-s38-phase5.zip> <BD-Home-v6.4-s38-phase5.zip> <out.zip>

Bases are the S38 zips only, checked by the sha256 of the zip AND of app/widget.html (S38 Builds table); anything else is refused.
  bd:   (1) Boards follow CS Home's S33 item 6: layer jpk-s39 (five tiles + "Show all numbers", one health chip per board row).
        (2) Follow-ups renewals: Customer contracts, Renewal Status "Not started", ending today to 120 days out (CS Home's
            "Renewals not started, 120 days or less" tile and Leadership's Renewals at risk). The note under the list counts the
            contracts past their end date that are left out. No other Follow-ups change. ?s39=0 gives the S38 behaviour back.
  lead: the meeting voice: the jpk-s36 and jpk-s37 blocks copied byte for byte from the BD S38 page (hash-checked),
        placed after jpk-s32 as on BD. Off switches ?s36=0 and ?s37=0 come with them.
Version strings are bumped everywhere the page carries them. Every edit must match the expected number of times or nothing is
written. plugin-manifest.json and every other zip entry are copied byte for byte, in the same order.
"""
import hashlib, io, os, sys, zipfile

DATE = '27 Oct 2026'
ZIP = {'bd': 'bcfa091b569e57ce6c618345f35ca5871856b57779d8844521ead192f18637fa',
       'lead': '9e5847b47ecca93726311c79def60960a2bafbdfd85d3a5e3770214e8b0f0e38'}
PAGE = {'bd': 'a02f650d59af6828', 'lead': '7b5d52f901bc99b4'}          # first 16 of widget.html sha256, S38 Builds table
BLOCK = {'s36': '308833f52387c2b2', 's37': 'f53c043aded53fb2'}        # first 16 of the BD (= CS) S36 / S37 blocks

def die(msg):
    raise SystemExit('S39 %s: %s' % (sys.argv[1] if len(sys.argv) > 1 else '?', msg))

def sha(b): return hashlib.sha256(b).hexdigest()

def rep(h, old, new, count=1):
    n = h.count(old)
    if n != count:
        die('expected %d match(es), found %d for: %s' % (count, n, old[:160]))
    return h.replace(old, new)

def load(path, key):
    raw = open(path, 'rb').read()
    if sha(raw) != ZIP[key]:
        die('%s is not the S38 zip: sha256 %s' % (os.path.basename(path), sha(raw)))
    z = zipfile.ZipFile(io.BytesIO(raw))
    page = z.read('app/widget.html')
    if sha(page)[:16] != PAGE[key]:
        die('app/widget.html is not the S38 page: sha256 %s' % sha(page))
    return z, page.decode('utf-8')

def block(h, m):
    a, end = '<!-- jpk-%s:start -->' % m, '<!-- jpk-%s:end -->\n' % m
    if h.count(a) != 1 or h.count(end) != 1: die('block %s not found once' % m)
    i, j = h.index(a), h.index(end) + len(end)
    b = h[i:j]
    if sha(b.encode('utf-8'))[:16] != BLOCK[m]: die('block %s is not the S36/S37 block' % m)
    return b

def bd(h, code):
    css = open(os.path.join(code, 'jpk-s39.css'), encoding='utf-8').read()
    js = open(os.path.join(code, 'jpk-s39.js'), encoding='utf-8').read()
    if '</style' in css or '</script' in js or '<!--' in js or '<!--' in css: die('layer files must not contain closing tags or comment openers')
    if 'jpk-s39' in h: die('base already carries jpk-s39')
    # versions
    h = rep(h, '<meta name="jpk-build" content="BD Home v6.4 (v6.3 S37 + S35 guide blurb line + S38 Phase 5 frame and Send to Leadership, 27 Oct 2026)">',
            '<meta name="jpk-build" content="BD Home v6.5 (v6.4 S38 + S39 boards like CS and Follow-ups renewals not started in 120 days, %s)">' % DATE)
    h = rep(h, "build: 'BD Home v6.4'", "build: 'BD Home v6.5'")
    if 'BD Home v6.4' in h: die('a v6.4 label is left in the page')
    # Follow-ups: the one renewal window
    h = rep(h, "  var staleRenewal = function (c) {",
            "  /* S39 (27 Oct 2026): Follow-ups use the one renewal window, the rule of CS Home's \"Renewals not started, 120 days or less\" tile and\n"
            "     Leadership's Renewals at risk: Customer contracts, Renewal Status Not started, ending today to 120 days out. ?s39=0 gives the old window. */\n"
            "  var S39_FU = !/[?&]s39=0\\b/.test(location.search);\n"
            "  var renewsNotStarted120 = function (c) { var d = daysFrom(c.Final_End_Date); return c.Counterparty_Type === 'Customer' && c.Renewal_Status === 'Not started' && d != null && d >= 0 && d <= 120; };\n"
            "  var pastEndLeftOut = function (c) { var d = daysFrom(c.Final_End_Date); return c.Counterparty_Type !== 'Vendor' && c.Contract_Status !== 'Ended' && renewalOpen(c) && d != null && d < 0; };\n"
            "  var staleRenewal = function (c) {")
    h = rep(h, "      if (c.Counterparty_Type === 'Vendor' || c.Contract_Status === 'Ended' || !renewalOpen(c)) return;\n"
               "      var n = daysFrom(c.Final_End_Date); if (n == null || n > 90 || n < -STALE_DAYS) return;\n",
            "      if (S39_FU) { if (!renewsNotStarted120(c)) return; }\n"
            "      else if (c.Counterparty_Type === 'Vendor' || c.Contract_Status === 'Ended' || !renewalOpen(c)) return;\n"
            "      var n = daysFrom(c.Final_End_Date); if (!S39_FU && (n == null || n > 90 || n < -STALE_DAYS)) return;\n")
    h = rep(h, "var stale = loading ? 0 : D.contracts.filter(staleRenewal).length",
            "var stale = loading ? 0 : D.contracts.filter(S39_FU ? pastEndLeftOut : staleRenewal).length")
    old_note = ("'<p class=\"fine stale\">' + stale + ' older contract' + (stale === 1 ? '' : 's') + ' ended more than ' + STALE_DAYS + ' days ago and ' + (stale === 1 ? 'is' : 'are') + ' left out here (never closed out, not renewals to chase)'")
    h = rep(h, old_note,
            "'<p class=\"fine stale\">' + (S39_FU ? stale + ' contract' + (stale === 1 ? '' : 's') + ' past ' + (stale === 1 ? 'its' : 'their') + ' end date ' + (stale === 1 ? 'is' : 'are') + ' left out here (not renewals to chase)' : "
            + old_note[len("'<p class=\"fine stale\">' + "):] + ")")
    h = rep(h, "data-fut=\"' + t[0] + '\" aria-pressed=",
            "data-fut=\"' + t[0] + '\"' + (S39_FU && t[0] === 'renew' ? ' title=\"Renewals not started, 120 days or less\"' : '') + ' aria-pressed=")
    # layer
    b39 = ('<!-- jpk-s39:start -->\n<style id="jpk-s39-css">\n' + css + '\n</style>\n<script id="jpk-s39">\n' + js + '\n</script>\n<!-- jpk-s39:end -->\n')
    h = rep(h, '<!-- jpk-s38:end -->\n</body>', '<!-- jpk-s38:end -->\n' + b39 + '</body>')
    return h

def lead(h, bdzip):
    if 'jpk-s36' in h or 'jpk-s37' in h: die('base already carries S36 / S37')
    _, bdh = load(bdzip, 'bd')
    b36, b37 = block(bdh, 's36'), block(bdh, 's37')
    h = rep(h, '<meta name="jpk-build" content="Leadership Home v47.3 (v47.1 S32 calendar + S35 guide blurb line + S38 Phase 5 frame and Needs you today, 27 Oct 2026)">',
            '<meta name="jpk-build" content="Leadership Home v47.4 (v47.3 S38 + S39 meeting voice from BD Home: S36 mic and S37 say the whole meeting, %s)">' % DATE)
    h = rep(h, "build: 'Leadership Home v47.3'", "build: 'Leadership Home v47.4'")
    h = rep(h, "var BUILD = 'Leadership Home v47.3 · 27 Oct 2026';", "var BUILD = 'Leadership Home v47.4 · %s';" % DATE)
    if 'Leadership Home v47.3' in h: die('a v47.3 label is left in the page')
    h = rep(h, '<!-- jpk-s32:end -->\n<!-- jpk-s35:start -->', '<!-- jpk-s32:end -->\n' + b36 + b37 + '<!-- jpk-s35:start -->')
    return h

def main():
    if len(sys.argv) != 5 or sys.argv[1] not in ZIP:
        die('usage: patch_s39_leftovers.py <bd|lead> <base.zip> <code dir | BD S38 zip> <out.zip>')
    key, base, extra, out = sys.argv[1:]
    zin, h = load(base, key)
    h = bd(h, extra) if key == 'bd' else lead(h, extra)
    newpage = h.encode('utf-8')
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zo:
        for info in zin.infolist():
            if info.filename == 'app/widget.html':
                zo.writestr(info, newpage, zipfile.ZIP_DEFLATED)
            else:
                zo.writestr(info, zin.read(info.filename), info.compress_type)
    open(out, 'wb').write(buf.getvalue())
    print('target     ', key)
    print('base zip   ', ZIP[key][:16])
    print('page sha256', sha(newpage))
    print('out zip    ', out, len(buf.getvalue()), 'bytes, sha256', sha(buf.getvalue()))

if __name__ == '__main__':
    main()
