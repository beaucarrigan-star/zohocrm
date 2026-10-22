"""S24 step 5 shell tests (Playwright, Chromium from /opt/pw-browsers). Usage: python3 -I run_tests.py <build dir>
Every page load blocks all non-file requests. Fixed clock: 22 Oct 2026 10:00 America/Chicago. Prints PASS/FAIL per check and a total."""
import sys, json, pathlib, re, datetime, traceback
from playwright.sync_api import sync_playwright

B = pathlib.Path(sys.argv[1]).resolve()
DEMO = (B / 'demo.html').as_uri()
REAL = (B / 'tmp-real' / 'widget-shell.html').as_uri()
REALBASE = (B / 'tmp-real' / 'widget-base.html').as_uri()
SHOTS = B / 'shots'; SHOTS.mkdir(exist_ok=True)
NOW = '2026-10-22T10:00:00-05:00'
TODAY = '2026-10-22'
results = []

def check(name, ok, info=''):
    results.append((name, bool(ok), info))
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else '  :: ' + str(info)[:400]), flush=True)

ORIGINAL = ['nt-nav', '.mast', 'work-tiles-off', 'needs-today', '.quick-actions', 'agenda-card', 'z-sm', 'z-work', 'z-rel', 'z-num', 'z-boards', 'dev-panel', 'z-ref', '.foot-note']
WIDE_TOP = ['z-sm']; WIDE_MAIN = ['needs-today', 'z-work', 'z-num', 'z-boards', 'dev-panel', 'z-rel']; WIDE_SIDE = ['jpk-cal', 'agenda-card', 'z-ref']
NARROW = ['z-sm', 'jpk-cal', 'needs-today', 'agenda-card', 'z-work', 'z-num', 'z-boards', 'dev-panel', 'z-rel', 'z-ref']
SECTIONS = ['needs-today', 'z-sm', 'z-work', 'z-num', 'z-boards', 'dev-panel', 'z-rel', 'agenda-card', 'z-ref']

JS_CHILDREN = "() => Array.from(document.getElementById('page').children).map(e => e.id || ('.' + e.className.split(' ')[0]))"
JS_ZONE = "(sel) => Array.from(document.querySelector(sel).children).map(e => e.id)"
JS_HASH = """async (ids) => { const out = {}; for (const id of ids) { const el = document.getElementById(id); const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(el.innerHTML)); out[id] = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join(''); } return out; }"""

JS_CONTRAST = """() => {
  const parse = c => { const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const bgOf = el => { for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0.5) return c; } return parse(getComputedStyle(document.body).backgroundColor); };
  const sel = '.jpk-count, .jpk-count b, .jpk-sep, .jpk-qa-btn, .jpk-badge, .jpk-step-l, .jpk-step-c, .jpk-step-n, .jpk-up-k, .jpk-up-rel, .jpk-up-t, .jpk-up-s, .jpk-chip, .jpk-btn, .jpk-day-h, .jpk-ev-time, .jpk-ev-t, .jpk-ev-v, .jpk-cal-empty, .jpk-dc-w, .jpk-dc-d, .jpk-cal-meta, .jpk-ol, .jpk-showweek, .jpk-switch, .jpk-flow-msg';
  const out = [];
  document.querySelectorAll(sel).forEach(el => {
    if (!el.getClientRects().length || getComputedStyle(el).visibility === 'hidden' || !el.textContent.trim()) return;
    const cs = getComputedStyle(el), fg = parse(cs.color), bg = bgOf(el); if (!fg || !bg) return;
    const L1 = lum(fg), L2 = lum(bg), ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const big = parseFloat(cs.fontSize) >= 24 || (parseFloat(cs.fontSize) >= 18.66 && +cs.fontWeight >= 700);
    if (ratio < (big ? 3 : 4.5)) out.push([el.className, el.textContent.trim().slice(0, 20), Math.round(ratio * 100) / 100]);
  });
  return out; }"""

class Run:
    def __init__(self, p):
        self.b = p.chromium.launch()
    def page(self, url, w=1400, h=900, scheme='light', storage=None, init=None, reduced=True, wait=1200):
        ctx = self.b.new_context(viewport={'width': w, 'height': h}, color_scheme=scheme, timezone_id='America/Chicago', reduced_motion='reduce' if reduced else 'no-preference')
        pg = ctx.new_page()
        pg.errors = []; pg.console_errors = []
        pg.on('pageerror', lambda e: pg.errors.append(str(e)))
        pg.on('console', lambda m: pg.console_errors.append(m.text) if m.type == 'error' else None)
        pg.route('**/*', lambda r: r.continue_() if r.request.url.startswith('file:') else r.abort())
        pg.clock.set_system_time(datetime.datetime.fromisoformat(NOW))
        if storage:
            pg.add_init_script('(() => { const s = ' + json.dumps(storage) + '; if (!sessionStorage.getItem("__seeded")) { for (const k in s) localStorage.setItem(k, s[k]); sessionStorage.setItem("__seeded", "1"); } })()')
        if init: pg.add_init_script(init)
        pg.goto(url); pg.wait_for_timeout(wait)
        return pg
    def done(self, pg, name, allow_console=None):
        ce = [c for c in pg.console_errors if not (allow_console and re.search(allow_console, c))]
        check(name + ': zero console errors and page errors', not pg.errors and not ce, {'pageerrors': pg.errors, 'console': ce})
        pg.context.close()

SEEDED = {'jpk-shell-seeded-cs': '1'}

def tests_layout(R):
    for (w, scheme, tag) in [(1400, 'light', 'desktop-light'), (1400, 'dark', 'desktop-dark'), (900, 'light', 'tablet-light'), (900, 'dark', 'tablet-dark'), (390, 'light', 'phone-light'), (390, 'dark', 'phone-dark')]:
        pg = R.page(DEMO + '?theme=' + scheme, w=w, scheme=scheme)
        n = f'[{tag}]'
        check(n + ' theme applied', pg.evaluate("() => document.documentElement.getAttribute('data-theme')") == scheme)
        check(n + ' shell on', pg.evaluate("() => document.documentElement.getAttribute('data-jpk-shell')") == 'on')
        kids = pg.evaluate(JS_CHILDREN)
        exp_head = ['nt-nav', '.mast', 'work-tiles-off', '.quick-actions', 'jpk-head', 'jpk-flow', '.jpk-top', '.jpk-cols']
        check(n + ' frame order: nav, mast, quick-actions, actions row, flow strip, top, columns, footer', kids[:8] == exp_head and kids[-1] == '.foot-note', kids)
        check(n + ' header counts sit in the masthead under the date', pg.evaluate("() => !!document.querySelector('.mast .greet > p.date ~ .jpk-counts')"))
        if w > 1100:
            top, main, side = pg.evaluate(JS_ZONE, '.jpk-top'), pg.evaluate(JS_ZONE, '.jpk-main'), pg.evaluate(JS_ZONE, '.jpk-side')
            check(n + ' top zone = Stock emails', top == WIDE_TOP, top)
            check(n + ' main zone in S21 order (tiles, Queue+Follow-ups, Numbers, Boards, Devices, Relationships)', main == WIDE_MAIN, main)
            check(n + ' side zone = Calendar, Today & Upcoming, Quick links+Vendors', side == WIDE_SIDE, side)
            geo = pg.evaluate("() => { const m = document.querySelector('.jpk-main').getBoundingClientRect(), s = document.querySelector('.jpk-side').getBoundingClientRect(); return { mr: m.right, sl: s.left, sw: s.width, mt: m.top, st: s.top }; }")
            check(n + ' two columns, side to the right and 320 to 400 px wide', geo['sl'] >= geo['mr'] - 1 and 320 <= geo['sw'] <= 401 and abs(geo['mt'] - geo['st']) < 2, geo)
            check(n + ' Queue + Follow-ups side by side only because the main column is >= 900 px', pg.evaluate("() => { const w = document.querySelector('.jpk-main').getBoundingClientRect().width, q = document.getElementById('queue-card').getBoundingClientRect(), f = document.getElementById('z-fu').getBoundingClientRect(); return (w >= 900) === (f.left > q.left + 10); }"))
            check(n + ' Quick links and Vendor contacts stack in the side column', pg.evaluate("() => { const a = document.querySelector('#z-ref > .card').getBoundingClientRect(), b = document.querySelector('#z-ref > .vendors').getBoundingClientRect(); return b.top >= a.bottom - 1; }"))
        else:
            main = pg.evaluate(JS_ZONE, '.jpk-main')
            check(n + ' one column in the narrow order (DOM order)', main == NARROW, main)
            vis = pg.evaluate("(ids) => ids.map(id => [id, document.getElementById(id)]).filter(p => !p[1].hidden).sort((a, b) => a[1].getBoundingClientRect().top - b[1].getBoundingClientRect().top).map(p => p[0])", NARROW)
            check(n + ' visual order = narrow order', vis == [i for i in NARROW if i != 'z-sm'], vis)
            check(n + ' side column empty and not shown', pg.evaluate("() => { const s = document.querySelector('.jpk-side'); return s.children.length === 0 && getComputedStyle(s).display === 'none'; }"))
            sw = pg.evaluate("() => [document.documentElement.scrollWidth, document.body.scrollWidth, innerWidth]")
            check(n + ' no horizontal scroll', sw[0] <= sw[2] and sw[1] <= sw[2], sw)
            up = pg.evaluate("() => { const u = document.querySelector('.jpk-upnext').getBoundingClientRect(), t = document.getElementById('needs-today').getBoundingClientRect(); return [u.bottom, t.top, u.height]; }")
            check(n + ' up-next card above the tiles', up[2] > 0 and up[0] <= up[1], up)
            check(n + ' calendar shows up-next plus "Show week" only', pg.evaluate("() => document.querySelector('.jpk-cal-more').hidden && !document.querySelector('.jpk-showweek').hidden"))
            if w <= 640:
                gut = pg.evaluate("() => [parseFloat(getComputedStyle(document.querySelector('.jpk-qa')).paddingLeft), document.querySelector('.jpk-qa-btn').getBoundingClientRect().left]")
                check(n + ' 16 px gutter', abs(gut[0] - 16) < 0.5 and abs(gut[1] - 16) < 0.5, gut)
                qa = pg.evaluate("() => { const q = document.querySelector('.jpk-qa'); return [getComputedStyle(q).overflowX, getComputedStyle(q).flexWrap, q.scrollWidth > q.clientWidth]; }")
                check(n + ' quick action chips scroll sideways within their row', qa[0] == 'auto' and qa[1] == 'nowrap', qa)
        low = pg.evaluate(JS_CONTRAST)
        check(n + ' AA contrast on counts, chips, flow steps and calendar text (4.5:1, 3:1 for 18px+ bold)', not low, low[:6])
        pg.screenshot(path=str(SHOTS / (tag + '.png')), full_page=True)
        pg.screenshot(path=str(SHOTS / (tag + '-top.png')), full_page=False)
        R.done(pg, n)

def tests_actions(R):
    pg = R.page(DEMO, storage=SEEDED)
    ids = pg.evaluate("() => Array.from(document.querySelectorAll('.jpk-qa-btn')).map(b => b.getAttribute('data-jpk-action'))")
    check('[actions] Administrator sees Mark renewed, Approve collections email, Billing check, New meeting in order', ids == ['markRenewed', 'approveCollections', 'billingCheck', 'newMeeting'], ids)
    check('[actions] Log lost device is absent from the DOM while its href is empty', pg.evaluate("() => !document.querySelector('[data-jpk-action=logLostDevice]') && !/Log lost device/.test(document.body.innerText)"))
    badges = pg.evaluate("() => Object.fromEntries(Array.from(document.querySelectorAll('.jpk-qa-btn')).map(b => [b.getAttribute('data-jpk-action'), (b.querySelector('.jpk-badge') || {}).textContent || null]))")
    check('[actions] badges: renewals60 tile 3, collections 2, billing 1, none on New meeting', badges == {'markRenewed': '3', 'approveCollections': '2', 'billingCheck': '1', 'newMeeting': None}, badges)
    def click(aid):
        pg.click(f'[data-jpk-action={aid}]'); pg.wait_for_timeout(100); return pg.evaluate('() => JPKShell.lastNav')
    nav = click('markRenewed')
    check('[actions] Mark renewed opens CS - Renewals due 60d (NeedsToday.viewUrl renewals60)', nav['href'] == 'https://crm.zoho.com/crm/org882980956/tab/CustomModule17/custom-view/6715134000009312090/list' and nav['how'] == 'top', nav)
    check('[actions] preview shows a toast instead of navigating', 'Would open' in pg.inner_text('#jpk-shell-toast'))
    nav = click('approveCollections')
    check('[actions] Approve collections email with 2 waiting opens the Collection_Requests list', nav['href'].endswith('/tab/Collection_Requests'), nav)
    nav = click('billingCheck')
    check('[actions] Billing check opens this month\'s Billing Period record', nav['href'].endswith('/tab/Billing_Periods/6715134000012000001') and nav['how'] == 'top', nav)
    pg.evaluate("() => { delete NeedsToday.VIEWS.renewals60; }")
    nav = click('markRenewed')
    check('[actions] Mark renewed falls back to the Contracts tab when the view is missing', nav['href'] == 'https://crm.zoho.com/crm/org882980956/tab/CustomModule17', nav)
    pg.evaluate("() => { const o = window.open; window.__opened = []; window.open = function (u) { window.__opened.push(u); return o.apply(this, arguments); }; }")
    with pg.expect_popup() as pi:
        pg.click('[data-jpk-action=newMeeting]')
    pop = pi.value; u = pg.evaluate('() => window.__opened[0]')
    check('[actions] New meeting opens Outlook compose in a new tab at the next half hour, 30 min', u.startswith('https://outlook.office.com/calendar/deeplink/compose?subject=&startdt=2026-10-22T10%3A30%3A00-05%3A00&enddt=2026-10-22T11%3A00%3A00-05%3A00'), u)
    pop.close()
    check('[actions] New meeting toast', pg.inner_text('#jpk-shell-toast') == 'Put it on the Zoho CRM Calendar in Outlook if you want it to show here.', pg.inner_text('#jpk-shell-toast'))
    pg.evaluate("() => { window.open = () => null; }")
    pg.click('[data-jpk-action=newMeeting]'); pg.wait_for_timeout(100)
    t = pg.evaluate("() => { const t = document.getElementById('jpk-shell-toast'); const a = t.querySelector('a'); return [t.innerText, a && a.href]; }")
    check('[actions] popup blocked: toast with the link to click', 'Open the new meeting in Outlook' in t[0] and (t[1] or '').startswith('https://outlook.office.com/calendar/deeplink/compose'), t)
    # Log lost device appears once the config has an href
    pg.evaluate("() => { JPKShell.unmount(); JPKShell.config.actions.filter(a => a.id === 'logLostDevice')[0].href = 'https://crm.zoho.com/crm/org882980956/tab/WebTab99'; JPKShell.mount(); }")
    pg.wait_for_timeout(700)
    nav = click('logLostDevice')
    check('[actions] Log lost device shows and opens its tab once href is set', nav['href'].endswith('/tab/WebTab99'), nav)
    R.done(pg, '[actions]')

    pg = R.page(DEMO + '?coll=1', storage=SEEDED)
    pg.click('[data-jpk-action=approveCollections]')
    nav = pg.evaluate('() => JPKShell.lastNav')
    check('[actions] exactly one collections email waiting opens that record', nav['href'].endswith('/tab/Collection_Requests/6715134000011000001'), nav)
    R.done(pg, '[actions coll=1]')

    pg = R.page(DEMO + '?agerr=1', storage=SEEDED)
    pg.click('[data-jpk-action=approveCollections]')
    nav = pg.evaluate('() => JPKShell.lastNav')
    check('[actions] collections read failed: opens the module tab, no badge', nav['href'].endswith('/tab/Collection_Requests') and pg.evaluate("() => !document.querySelector('[data-jpk-action=approveCollections] .jpk-badge')"), nav)
    R.done(pg, '[actions agerr=1]')

    pg = R.page(DEMO + '?ag=empty', storage=SEEDED)
    pg.click('[data-jpk-action=billingCheck]')
    nav = pg.evaluate('() => JPKShell.lastNav')
    check('[actions] no billing period this month: Billing check opens the create form', nav['how'] == 'create' and nav['href'].endswith('/tab/Billing_Periods/create'), nav)
    check('[actions] no badge at 0', pg.evaluate("() => !document.querySelector('[data-jpk-action=approveCollections] .jpk-badge') && !document.querySelector('[data-jpk-action=billingCheck] .jpk-badge')"))
    R.done(pg, '[actions ag=empty]')

    pg = R.page(DEMO + '?asuser=1', storage=SEEDED)
    ids = pg.evaluate("() => Array.from(document.querySelectorAll('.jpk-qa-btn')).map(b => b.getAttribute('data-jpk-action'))")
    check('[actions] not an Administrator: Billing check and Mark renewed hidden', ids == ['approveCollections', 'newMeeting'], ids)
    R.done(pg, '[actions asuser=1]')

    pg = R.page(DEMO + '?nouser=1', storage=SEEDED, wait=500)
    early = pg.evaluate("() => Array.from(document.querySelectorAll('.jpk-qa-btn')).map(b => b.getAttribute('data-jpk-action'))")
    pg.wait_for_timeout(6500)
    late = pg.evaluate("() => Array.from(document.querySelectorAll('.jpk-qa-btn')).map(b => b.getAttribute('data-jpk-action'))")
    check('[actions] user never resolves: gated actions stay hidden, ungated show', early == late == ['approveCollections', 'newMeeting'], [early, late])
    R.done(pg, '[actions nouser=1]')

def cal_text(pg):
    return pg.evaluate("() => ({ up: document.querySelector('.jpk-upnext').innerText.trim(), list: document.querySelector('.jpk-day-list').innerText.trim(), head: document.querySelector('.jpk-day-h').textContent })")

def tests_empty(R):
    pg = R.page(DEMO + '?caldemo=empty', storage=SEEDED)
    c = cal_text(pg)
    check('[empty] no meetings in 7 days: exact wording plus Open Outlook', c['list'] == 'No meetings synced. Put a meeting on the Zoho CRM Calendar in Outlook to see it here. Open Outlook', c)
    check('[empty] up-next falls back to Today & Upcoming', c['up'].startswith('Next up · from Today & Upcoming'), c)
    check('[empty] header meetings count is 0 (not the fallback)', pg.evaluate("() => document.querySelector('[data-jpk-count=meetings] b').textContent") == '0')
    first = pg.evaluate("() => document.querySelector('#ag-list [data-agk]').getAttribute('data-agk')")
    pg.click('.jpk-upnext [data-jpk-agk]'); pg.wait_for_timeout(100)
    check('[empty] fallback Open clicks the matching Today & Upcoming row', pg.evaluate('() => window.__demoOpened') == first, first)
    R.done(pg, '[empty caldemo=empty]')

    pg = R.page(DEMO + '?caldemo=empty&ag=empty', storage=SEEDED)
    check('[empty] no meetings and no dated work', cal_text(pg)['up'] == 'Nothing scheduled. Your day is open.', cal_text(pg))
    R.done(pg, '[empty no work]')

    pg = R.page(DEMO + '?caldemo=later', storage=SEEDED)
    c = cal_text(pg)
    check('[empty] calendar today list: "No meetings today."', c['list'] == 'No meetings today.' and c['head'] == 'Today', c)
    empty_day = pg.evaluate("() => { const b = Array.from(document.querySelectorAll('.jpk-daychip')).filter(b => !b.querySelector('.jpk-dc-n i'))[1]; b.click(); return b.getAttribute('data-jpk-day'); }")
    pg.wait_for_timeout(50)
    check('[empty] week strip day with nothing: "Nothing on this day."', cal_text(pg)['list'] == 'Nothing on this day.', [empty_day, cal_text(pg)])
    R.done(pg, '[empty caldemo=later]')

    pg = R.page(DEMO + '?caldemo=done', storage=SEEDED)
    check('[empty] meetings today but none later: "No more meetings today."', cal_text(pg)['up'] == 'No more meetings today.', cal_text(pg))
    R.done(pg, '[empty caldemo=done]')

    pg = R.page(DEMO + '?caldemo=err', storage=SEEDED)
    c = cal_text(pg)
    check('[empty] read failed: exact wording', c['list'] == 'Calendar could not load. Reload the page to try again.', c)
    check('[empty] read failed: up-next fallback still runs', c['up'].startswith('Next up · from Today & Upcoming'), c)
    m = pg.evaluate("() => { const a = document.querySelector('[data-jpk-count=meetings]'); return [a.querySelector('b').textContent, a.title]; }")
    check('[counts] calendar failed: meetings shows a dash with title "Calendar could not load", never 0', m == ['—', 'Calendar could not load'], m)
    R.done(pg, '[empty caldemo=err]')

    pg = R.page(DEMO, storage=SEEDED)
    c = cal_text(pg)
    up = pg.evaluate("() => document.querySelector('.jpk-upnext').textContent")
    check('[calendar] up-next card: next meeting, "in 25 min", Join, Open in Zoho, Open in Outlook', up.startswith('Up next in 25minDane County: GPS spare review'.replace('25min', '25 min')) and all(x in c['up'] for x in ['Join', 'Open in Zoho', 'Open in Outlook', 'Dane County', 'Pat Moreno']), c)
    chips = pg.evaluate("() => document.querySelectorAll('.jpk-daychip').length")
    check('[calendar] week strip has 7 day chips, today first', chips == 7 and pg.evaluate("() => document.querySelector('.jpk-daychip').getAttribute('aria-pressed') === 'true' && document.querySelector('.jpk-daychip .jpk-dc-w').textContent === 'Today'"))
    check('[calendar] interface: jpkCalendar.load is the demo stub', pg.evaluate("() => window.jpkCalendar.stub === true && typeof window.jpkCalendar.load === 'function'"))
    pg.click('.jpk-cal .jpk-tg'); pg.wait_for_timeout(50)
    check('[calendar] its own toggle collapses it (not part of Collapse all)', pg.evaluate("() => document.getElementById('jpk-cal-body').hidden && !document.querySelector('.jpk-cal .hl-tg')"))
    R.done(pg, '[calendar]')

def counts(pg):
    return pg.evaluate("() => Object.fromEntries(Array.from(document.querySelectorAll('.jpk-count')).map(a => [a.getAttribute('data-jpk-count'), [a.querySelector('b').textContent, a.title || '', !!a.querySelector('.jpk-dot')]]))")

def tests_counts(R):
    pg = R.page(DEMO, storage=SEEDED)
    c = counts(pg)
    check('[counts] figures: 2 meetings, 68 need you, 3 due today, 4 to approve', [c[k][0] for k in ['meetings', 'needs', 'due', 'approve']] == ['2', '68', '3', '4'], c)
    check('[counts] wording "meetings · need you · due today · to approve"', pg.inner_text('.jpk-counts').replace('\n', ' ') == '2 meetings · 68 need you · 3 due today · 4 to approve', pg.inner_text('.jpk-counts'))
    check('[counts] counts live region is polite', pg.evaluate("() => document.querySelector('.jpk-counts').getAttribute('aria-live')") == 'polite')
    pg.click('[data-jpk-count=due]'); pg.wait_for_timeout(200)
    check('[counts] a count links to its zone (due today -> Today & Upcoming)', abs(pg.evaluate("() => document.getElementById('agenda-card').getBoundingClientRect().top")) < 3)
    R.done(pg, '[counts]')

    pg = R.page(DEMO + '?ntdemo=err', storage=SEEDED)
    c = counts(pg)
    check('[counts] ?ntdemo=err: need you counts the 3 good tiles, marks the gap with a dot and title', c['needs'][0] == '65' and c['needs'][2] and c['needs'][1] == '1 tile could not count', c)
    R.done(pg, '[counts ntdemo=err]')
    pg = R.page(DEMO + '?ntdemo=empty', storage=SEEDED)
    check('[counts] ?ntdemo=empty: a real 0', counts(pg)['needs'][:2] == ['0', ''], counts(pg))
    R.done(pg, '[counts ntdemo=empty]')
    pg = R.page(DEMO + '?agerr=1', storage=SEEDED)
    c = counts(pg)
    check('[counts] collections read failed: to approve partial with dot and title naming it', c['approve'][0] == '2' and c['approve'][2] and 'collections' in c['approve'][1], c)
    check('[counts] agenda errors listed on due today', 'Could not read: Collections' in c['due'][1], c)
    R.done(pg, '[counts agerr=1]')
    pg = R.page(DEMO + '?caldemo=slow', storage=SEEDED)
    c = counts(pg)
    check('[counts] while loading: dash, not 0', c['meetings'][0] == '—', c)
    R.done(pg, '[counts loading]')
    pg = R.page(DEMO + '?ag=never', storage=SEEDED, wait=1500)
    c = counts(pg)
    check('[counts] agenda never loads: due today and to approve show a dash', c['due'][0] == '—' and c['approve'][0] == '—', c)
    R.done(pg, '[counts no agenda]')

def tests_flow(R):
    pg = R.page(DEMO, storage=SEEDED)
    st = pg.evaluate("() => Array.from(document.querySelectorAll('.jpk-flow-item')).map(li => [li.querySelector('.jpk-step-l').textContent, li.querySelector('.jpk-step-c').textContent, li.querySelector('.jpk-step').getAttribute('aria-current')])")
    check('[flow] four steps with counts; step 1 current', st == [['Alerts', '5', 'step'], ['Needs you today', '68', None], ['Meetings and follow-ups', '2', None], ['Close out', '3', None]], st)
    # keyboard: Enter on step 2 scrolls to the tiles
    pg.focus('[data-jpk-step-go="2"]'); pg.keyboard.press('Enter'); pg.wait_for_timeout(200)
    check('[flow] keyboard: Enter on step 2 scrolls to Needs you today', abs(pg.evaluate("() => document.getElementById('needs-today').getBoundingClientRect().top")) < 3)
    pg.focus('[data-jpk-step-go="4"]'); pg.keyboard.press('Enter'); pg.wait_for_timeout(200)
    check('[flow] step 4 Close out goes to the Queue (cases)', abs(pg.evaluate("() => document.getElementById('z-work').getBoundingClientRect().top")) < 3)
    pg.focus('[data-jpk-step-go="1"]'); pg.keyboard.press('Enter'); pg.wait_for_timeout(200)
    check('[flow] step 1 with Stock emails closed goes to Today & Upcoming', abs(pg.evaluate("() => document.getElementById('agenda-card').getBoundingClientRect().top")) < 3)
    pg.focus('[data-jpk-step-go="3"]'); pg.keyboard.press('Enter'); pg.wait_for_timeout(200)
    a = pg.evaluate("() => document.getElementById('jpk-cal').getBoundingClientRect().top")
    pg.keyboard.press('Enter') if pg.evaluate("() => document.activeElement.getAttribute('data-jpk-step-go')") == '3' else (pg.focus('[data-jpk-step-go="3"]'), pg.keyboard.press('Enter'))
    pg.wait_for_timeout(200)
    b = pg.evaluate("() => document.getElementById('z-fu').getBoundingClientRect().top")
    check('[flow] step 3: first press to the calendar, second to Follow-ups', abs(a) < 3 and abs(b) < 3, [a, b])
    # Tab from step 1 reaches its tick; Space ticks it
    pg.focus('[data-jpk-step-go="1"]'); pg.keyboard.press('Tab')
    check('[flow] Tab from a step reaches its done tick', pg.evaluate("() => document.activeElement.getAttribute('data-jpk-tick')") == '1')
    pg.keyboard.press('Space'); pg.wait_for_timeout(50)
    st = pg.evaluate("() => [document.querySelector('[data-jpk-tick=\"1\"]').getAttribute('aria-pressed'), document.querySelector('[data-jpk-step=\"1\"] .jpk-step-c').textContent, document.querySelector('[data-jpk-step-go=\"2\"]').getAttribute('aria-current'), localStorage.getItem('jpk-flow-cs-" + TODAY + "')]")
    check('[flow] Space ticks step 1: Done, step 2 becomes current, stored for today', st == ['true', 'Done', 'step', '[1]'], st)
    pg.reload(); pg.wait_for_timeout(1200)
    check('[flow] tick persists for the day', pg.evaluate("() => document.querySelector('[data-jpk-tick=\"1\"]').getAttribute('aria-pressed')") == 'true')
    for n in (2, 3, 4): pg.click(f'[data-jpk-tick="{n}"]', force=True)
    pg.wait_for_timeout(50)
    check('[flow] all four done: exact wording', pg.evaluate("() => { const m = document.querySelector('.jpk-flow-msg'); return !m.hidden && m.textContent; }") == 'All four steps clear for today.')
    R.done(pg, '[flow]')

    pg = R.page(DEMO, storage=dict(SEEDED, **{'jpk-flow-cs-2026-10-21': '[1,2,3,4]'}))
    st = pg.evaluate("() => [localStorage.getItem('jpk-flow-cs-2026-10-21'), document.querySelector('[data-jpk-tick=\"1\"]').getAttribute('aria-pressed'), document.querySelector('.jpk-flow-msg').hidden]")
    check('[flow] yesterday\'s ticks are cleared the next day', st == [None, 'false', True], st)
    R.done(pg, '[flow next day]')
    pg = R.page(DEMO + '?sm=1', storage=SEEDED)
    pg.click('[data-jpk-step-go="1"]'); pg.wait_for_timeout(200)
    check('[flow] step 1 with Stock emails open goes to Stock emails (top zone shown)', abs(pg.evaluate("() => document.getElementById('z-sm').getBoundingClientRect().top")) < 3 and pg.evaluate("() => !document.querySelector('.jpk-top').hidden"))
    R.done(pg, '[flow sm=1]')

def tests_switch_and_integrity(R):
    pg = R.page(DEMO + '?shell=0')
    kids = pg.evaluate(JS_CHILDREN)
    check('[switch] ?shell=0: original v5.11 order', kids == ORIGINAL, kids)
    check('[switch] ?shell=0: no shell attribute, elements or counts', pg.evaluate("() => !document.documentElement.hasAttribute('data-jpk-shell') && !document.querySelector('.jpk-head,.jpk-flow,.jpk-cols,.jpk-counts,#jpk-cal')"))
    check('[switch] ?shell=0: footer link says "Switch to the new layout"', pg.inner_text('.jpk-switch') == 'Switch to the new layout')
    pg.screenshot(path=str(SHOTS / 'desktop-light-shell-off.png'), full_page=True)
    # innerHTML of every moved section unchanged by mounting (seed flag set so no collapse click)
    pg.evaluate("() => localStorage.setItem('jpk-shell-seeded-cs', '1')")
    before = pg.evaluate(JS_HASH, SECTIONS)
    pg.evaluate("() => JPKShell.mount()"); pg.wait_for_timeout(3000)
    after = pg.evaluate(JS_HASH, SECTIONS)
    diff = [k for k in SECTIONS if before[k] != after[k]]
    check('[integrity] mounting changes no moved section\'s innerHTML (sha256 before and 3 s after)', not diff, diff)
    pg.set_viewport_size({'width': 390, 'height': 900}); pg.wait_for_timeout(500)
    after2 = pg.evaluate(JS_HASH, SECTIONS)
    check('[integrity] switching to the narrow layout changes no section innerHTML', before == after2, [k for k in SECTIONS if before[k] != after2[k]])
    pg.set_viewport_size({'width': 1400, 'height': 900}); pg.wait_for_timeout(300)
    pg.evaluate("() => JPKShell.unmount()")
    check('[switch] unmount() puts every section back in the original order', pg.evaluate(JS_CHILDREN) == ORIGINAL, pg.evaluate(JS_CHILDREN))
    check('[integrity] after unmount, innerHTML still identical', pg.evaluate(JS_HASH, SECTIONS) == before)
    R.done(pg, '[switch shell=0]')

    # footer toggle
    pg = R.page(DEMO, storage=SEEDED)
    check('[switch] footer link "Switch to the classic layout"', pg.inner_text('.jpk-switch') == 'Switch to the classic layout')
    with pg.expect_navigation(): pg.click('.jpk-switch')
    pg.wait_for_timeout(800)
    check('[switch] footer link turns the shell off and restores the original order', pg.evaluate(JS_CHILDREN) == ORIGINAL and pg.evaluate("() => localStorage.getItem('jpk-shell-cs')") == 'off')
    with pg.expect_navigation(): pg.click('.jpk-switch')
    pg.wait_for_timeout(800)
    check('[switch] and back on', pg.evaluate("() => document.documentElement.getAttribute('data-jpk-shell')") == 'on' and pg.evaluate("() => localStorage.getItem('jpk-shell-cs')") == 'on')
    pg.evaluate("() => localStorage.setItem('jpk-shell-cs', 'off')")
    pg.goto(DEMO + '?shell=1'); pg.wait_for_timeout(800)
    check('[switch] ?shell=1 wins over the stored off', pg.evaluate("() => document.documentElement.getAttribute('data-jpk-shell')") == 'on')
    R.done(pg, '[switch footer]')

    # first-visit seed: Relationships collapsed through the page's own toggle
    pg = R.page(DEMO)
    st = pg.evaluate("() => [document.getElementById('z-rel').getAttribute('data-collapsed'), JSON.parse(localStorage.getItem('bd-cs-home-layout') || '{}')['bd-rel'], localStorage.getItem('jpk-shell-seeded-cs')]")
    check('[seed] first visit: Relationships collapsed and stored as bd-rel: true', st == ['true', True, '1'], st)
    R.done(pg, '[seed]')
    pg = R.page(DEMO, storage={'bd-cs-home-layout': json.dumps({'bd-rel': False})})
    check('[seed] Beau\'s own choice wins', pg.evaluate("() => document.getElementById('z-rel').getAttribute('data-collapsed')") != 'true')
    R.done(pg, '[seed choice]')

    # BD example config on the same page: mounts, skips the missing ids with warnings, no errors
    ex = (B / 'jpk-shell-config.example.js').read_text()
    pg = R.page(DEMO, storage=SEEDED)
    warns = []
    pg.on('console', lambda m: warns.append(m.text) if m.type == 'warning' else None)
    r = pg.evaluate("(ex) => { eval(ex + '; window.__BD = JPK_SHELL_BD_EXAMPLE;'); JPKShell.unmount(); Object.assign(JPKShell.config, window.__BD, { zones: Object.assign({}, JPKShell.config.zones, window.__BD.zones), calendar: Object.assign({}, JPKShell.config.calendar, window.__BD.calendar) }); JPKShell.mount(); return Array.from(document.querySelector('.jpk-main').children).map(e => e.id); }", ex)
    pg.wait_for_timeout(600)
    ids = pg.evaluate("() => Array.from(document.querySelectorAll('.jpk-qa-btn')).map(b => b.getAttribute('data-jpk-action'))")
    check('[config] BD example mounts on the same shell (main zone, actions)', r == ['needs-today', 'z-fu', 'z-boards', 'z-num'] and ids == ['newOpportunity', 'coldProspects', 'newMeeting'], [r, ids])
    R.done(pg, '[config BD]')
    pg = R.page(DEMO, storage=SEEDED, init="window.addEventListener('DOMContentLoaded', () => { window.JPK_SHELL.bogus = 1; window.JPK_SHELL.zones.main = window.JPK_SHELL.zones.main.concat(['#nope']); }, { once: true, capture: true });")
    R.done(pg, '[config unknown key and missing id: warnings only]')

def tests_keyboard(R):
    for w in (1400, 390):
        pg = R.page(DEMO, w=w, storage=SEEDED)
        n = f'[keyboard {w}]'
        check(n + ' no positive tabindex anywhere', pg.evaluate("() => !Array.from(document.querySelectorAll('[tabindex]')).some(e => e.tabIndex > 0)"))
        # zones: DOM order equals visual reading order (left column top to bottom, then right column)
        r = pg.evaluate("""() => { const items = Array.from(document.querySelectorAll('.jpk-top > *, .jpk-main > *, .jpk-side > *')).filter(e => !e.hidden);
            const dom = items.map(e => e.id); const m = document.querySelector('.jpk-main').getBoundingClientRect();
            const vis = items.slice().sort((a, b) => { const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); const ca = ra.left >= m.right - 1 ? 1 : 0, cb = rb.left >= m.right - 1 ? 1 : 0; return (ca - cb) || (ra.top - rb.top); }).map(e => e.id);
            return [dom, vis]; }""")
        check(n + ' zone DOM order = visual reading order', r[0] == r[1], r)
        # real Tab walk from the search box
        pg.focus('#jump')
        seq = []
        for i in range(60):
            pg.keyboard.press('Tab')
            seq.append(pg.evaluate("""() => { const a = document.activeElement; const z = a.closest('.jpk-zone > *'); return { k: a.getAttribute('data-jpk-action') ? 'qa:' + a.getAttribute('data-jpk-action') : a.getAttribute('data-jpk-step-go') ? 'step:' + a.getAttribute('data-jpk-step-go') : a.getAttribute('data-jpk-tick') ? 'tick:' + a.getAttribute('data-jpk-tick') : a.id || a.className || a.tagName, zone: z ? z.id : null }; }"""))
        keys = [s['k'] for s in seq]
        want = ['qa:markRenewed', 'qa:approveCollections', 'qa:billingCheck', 'qa:newMeeting', 'step:1', 'tick:1', 'step:2', 'tick:2', 'step:3', 'tick:3', 'step:4', 'tick:4']
        got = [k for k in keys if k.startswith(('qa:', 'step:', 'tick:'))]
        check(n + ' Tab reaches every quick action, then every flow step and tick, in order', got == want and keys.index('qa:markRenewed') > keys.index('new-btn'), keys[:30])
        zones_after = [s['zone'] for s in seq[keys.index('tick:4') + 1:] if s['zone']]
        first_zone = zones_after[0] if zones_after else None
        check(n + ' after the flow strip, focus enters ' + ('the tiles' if w > 1100 else 'the calendar (up-next above the tiles)'), first_zone == ('needs-today' if w > 1100 else 'jpk-cal'), zones_after[:5])
        order = []
        for z in zones_after:
            if not order or order[-1] != z: order.append(z)
        exp = r[1]
        check(n + ' focus moves through the zones in visual order', order == [z for z in exp if z in order][:len(order)] and len(order) == len(set(order)), order)
        R.done(pg, n)

def tests_real(R):
    """The real v5.11 widget in ?preview=1 (scripts live, network blocked) with the shell referenced (test copy only)."""
    base = R.page(REALBASE + '?preview=1&ntdemo=1', wait=3500)
    base_order = base.evaluate(JS_CHILDREN)
    base_errs = list(base.console_errors)
    R.done(base, '[real base v5.11]', allow_console=r'Failed to load resource')
    pg = R.page(REAL + '?preview=1&ntdemo=1&shell=0', wait=3500)
    check('[real] ?shell=0: order identical to v5.11', pg.evaluate(JS_CHILDREN) == base_order, [pg.evaluate(JS_CHILDREN), base_order])
    pg.evaluate("() => localStorage.setItem('jpk-shell-seeded-cs', '1')")
    r = pg.evaluate("async (ids) => { const h = " + JS_HASH + "; const a = await h(ids); JPKShell.mount(); const b = await h(ids); return [a, b]; }", SECTIONS)
    check('[real] mount changes no moved section innerHTML (live page scripts running)', r[0] == r[1], [k for k in SECTIONS if r[0][k] != r[1][k]])
    R.done(pg, '[real shell=0 + mount]', allow_console=r'Failed to load resource')
    for w, scheme in [(1400, 'light'), (1400, 'dark'), (390, 'light')]:
        pg = R.page(REAL + '?preview=1&ntdemo=1', w=w, scheme=scheme, storage=SEEDED, wait=3500)
        n = f'[real {w} {scheme}]'
        if w > 1100:
            ok = pg.evaluate(JS_ZONE, '.jpk-main') == WIDE_MAIN and pg.evaluate(JS_ZONE, '.jpk-side') == WIDE_SIDE
        else:
            ok = pg.evaluate(JS_ZONE, '.jpk-main') == NARROW
            sw = pg.evaluate("() => [document.documentElement.scrollWidth, innerWidth]")
            check(n + ' no horizontal scroll', sw[0] <= sw[1], sw)
        check(n + ' zones in order', ok, [pg.evaluate(JS_ZONE, '.jpk-main'), pg.evaluate(JS_ZONE, '.jpk-side')])
        if w > 1100 and scheme == 'light':
            pg.click('#queue-card .hl-tg'); pg.wait_for_timeout(200)
            st = pg.evaluate("() => [document.getElementById('queue-card').getAttribute('data-collapsed'), JSON.parse(localStorage.getItem('bd-cs-home-layout') || '{}').queue]")
            check(n + ' page collapse toggle still works and writes bd-cs-home-layout', st == ['true', True], st)
            pg.click('.hl-nav button:text-is("Boards")'); pg.wait_for_timeout(300)
            t = pg.evaluate("() => document.querySelector('#z-boards > .band').getBoundingClientRect().top")
            check(n + ' Go to Boards still scrolls to Boards (v5.11 lands it 64 px down, under the toolbar)', 0 <= t <= 80, t)
            pg.click('.hl-all'); pg.wait_for_timeout(200)
            check(n + ' Collapse all ignores the calendar toggle', pg.evaluate("() => document.querySelector('.jpk-cal .jpk-tg').getAttribute('aria-expanded')") == 'true')
            check(n + ' header counts show figures', all(v not in (None,) for v in pg.evaluate("() => Object.values(JPKShell.counts)")), pg.evaluate("() => JPKShell.counts"))
        pg.screenshot(path=str(SHOTS / f'real-widget-{w}-{scheme}.png'), full_page=False)
        R.done(pg, n, allow_console=r'Failed to load resource')
    check('[real] the base v5.11 page has only the blocked-network console errors (baseline)', all('Failed to load resource' in e for e in base_errs), base_errs)

with sync_playwright() as p:
    R = Run(p)
    for t in (tests_layout, tests_actions, tests_empty, tests_counts, tests_flow, tests_switch_and_integrity, tests_keyboard, tests_real):
        try: t(R)
        except Exception as e: check(t.__name__ + ' crashed', False, traceback.format_exc())
    R.b.close()

passed = sum(1 for r in results if r[1]); failed = len(results) - passed
print(f'\n{passed} passed, {failed} failed, {len(results)} checks')
(B / 'tests' / 'last-run.txt').write_text('\n'.join(('PASS ' if r[1] else 'FAIL ') + r[0] + ('' if r[1] else '  :: ' + str(r[2])[:400]) for r in results) + f'\n\n{passed} passed, {failed} failed\n')
sys.exit(1 if failed else 0)
