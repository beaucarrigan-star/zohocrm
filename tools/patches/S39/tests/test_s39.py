"""S39 Phase 5b tests. Chromium, network blocked (file:// only), demo data.
Usage: python3 -I test_s39.py <scratch dir>   (expects out/x/<S39 build>/app/widget.html and base/<S38 build>/app/widget.html)
BD v6.5 vs its S38 base (v6.4) and vs Beau CS Home v6.13.0 (the boards it must match); Leadership v47.4 vs its S38 base (v47.3).
The meeting voice itself is tested by tests/test_s36.js and tests/test_s37_ui.js run on the Leadership page."""
import asyncio, json, os, sys
from playwright.async_api import async_playwright

S = sys.argv[1]
SHOTS = os.path.join(S, 'shots', 's39'); os.makedirs(SHOTS, exist_ok=True)
BD, BD0 = 'out/x/BD-Home-v6.5-s39-leftovers', 'base/BD-Home-v6.4-s38-phase5'
LD, LD0 = 'out/x/Leadership-Home-v47.4-s39-leftovers', 'base/Leadership-Home-v47.3-s38-phase5'
CS = 'base/BD-CS-Home-v6.13.0-s38-phase5'
BOARDS = ['jpem', 'jpprog', 'sirona', 'tdp', 'deals', 'campaigns', 'vendors']
R = []
def ok(name, cond, info=''): R.append((bool(cond), name, info))

async def open_page(br, path, qs, w=1200, dark=False, storage=None):
    ctx = await br.new_context(viewport={'width': w, 'height': 900}, color_scheme='dark' if dark else 'light')
    pg = await ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    await pg.route('**/*', lambda r: r.continue_() if r.request.url.startswith('file:') else r.abort())
    if storage: await pg.add_init_script('(() => { try { const s = %s; for (const k in s) localStorage.setItem(k, s[k]); } catch (e) {} })()' % json.dumps(storage))
    await pg.goto('file://' + os.path.join(S, path, 'app/widget.html') + ('?' + qs if qs else ''))
    await pg.wait_for_timeout(3500)
    return ctx, pg, errs
async def txt(pg, s): return await pg.evaluate("(s) => { const e = document.querySelector(s); return e ? e.innerText.replace(/\\s+/g, ' ').trim() : null; }", s)

# visible tile labels, in order, without the corner link ("open ›", "devices ›")
LABELS = """(sel) => [...document.querySelectorAll(sel)].filter(e => e.getBoundingClientRect().width).map(e => {
  if (e.classList.contains('hbar')) return (e.getAttribute('aria-label') || '').toLowerCase();
  const l = e.querySelector('.label'); if (!l) return '?'; const c = l.cloneNode(true); c.querySelectorAll('.go, .delta').forEach(x => x.remove());
  return c.textContent.replace(/\\s+/g, ' ').trim().toLowerCase(); })"""
# health cells: what a sighted reader sees (text of visible parts only)
HEALTH = """(hw) => [...document.querySelectorAll('#board tbody td[title*="ustomer health"]')].map(td => {
  const c = td.cloneNode(true); [...td.querySelectorAll('.' + hw)].forEach((s, i) => { if (s.getBoundingClientRect().width <= 1) c.querySelectorAll('.' + hw)[i].textContent = ''; });
  return c.textContent.replace(/\\s+/g, ' ').trim() + (td.querySelector('.dot') && td.querySelector('.dot').getBoundingClientRect().width ? ' [dot]' : ''); })"""
# the S39 Follow-ups rule, computed independently of the page (calendar days from today at noon)
RULE = """() => { const D = window.__bd.D, b = new Date(); b.setHours(12, 0, 0, 0);
  const days = s => s ? Math.round((new Date(String(s).slice(0, 10) + 'T12:00:00') - b) / 864e5) : null;
  return D.contracts.filter(c => { const d = days(c.Final_End_Date); return c.Counterparty_Type === 'Customer' && c.Renewal_Status === 'Not started' && d != null && d >= 0 && d <= 120; }).map(c => 'renew:' + c.id).sort(); }"""
ROWS = "(p) => [...document.querySelectorAll('#fu-list [data-fu]')].map(e => e.getAttribute('data-fu')).filter(k => p === '*' || k.indexOf(p) === 0).sort()"
# make the demo contracts customer contracts with a spread of end dates and statuses, then redraw Follow-ups through the page's own filter chips
MUTATE = """() => { const D = window.__bd.D, t = new Date(); t.setHours(12, 0, 0, 0);
  const dd = n => { const x = new Date(t); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
  const set = [['k1', 52, 'Not started', 'Customer'], ['k2', 151, 'Not started', 'Customer'], ['k4', -12, 'Not started', 'Customer'], ['k6', 28, 'Not started', 'Customer'],
               ['k7', 120, 'Not started', 'Customer'], ['k3', 30, 'Outreach', 'Customer'], ['k5', 10, 'Not started', 'Vendor'], ['k8', 0, 'Not started', 'Customer']];
  set.forEach(s => { const c = D.contracts.find(c => c.id === s[0]); if (c) { c.Final_End_Date = dd(s[1]); c.Renewal_Status = s[2]; c.Counterparty_Type = s[3]; c.Contract_Status = 'Active/Complete'; } });
  const ch = document.querySelector('#fu-filter [data-fut="cold"]'); ch.click(); document.querySelector('#fu-filter [data-fut="cold"]').click();
  const all = document.querySelector('#fu-list [data-fuall]'); if (all) all.click(); return D.contracts.map(c => c.id + ':' + c.Counterparty_Type + ':' + c.Renewal_Status + ':' + c.Final_End_Date); }"""

async def bd_boards(br):
    print('... bd boards', flush=True)
    cc, cp, ce = await open_page(br, CS, 'ntdemo=1')
    await cp.evaluate("window.JPKS27.setTab('boards')"); await cp.wait_for_timeout(600)
    cs = await cp.evaluate(LABELS, '#numgrid .kpi')
    cs_health = await cp.evaluate(HEALTH, 's33-hw')
    await cc.close()
    for w in (1200, 390):
        for dark in (False, True):
            tag = 'bd %d %s' % (w, 'dark' if dark else 'light')
            ctx, pg, errs = await open_page(br, BD, 'ntdemo=1', w, dark)
            await pg.evaluate("window.JPKS38.setTab('boards')"); await pg.wait_for_timeout(500)
            ok(tag + ': S39 layer on', await pg.evaluate("document.documentElement.getAttribute('data-s39') === 'on' && window.JPKS39.version === '1.0.0'"))
            bd = await pg.evaluate(LABELS, '#nums > .kpi')
            want = [x for x in cs if x != 'stock alerts']
            ok(tag + ': EM board tiles = CS Boards tiles, same order, less Stock alerts (decision B)', bd == want, str((bd, cs)))
            ok(tag + ': EM board shows no more than five tiles', len(bd) <= 5)
            ok(tag + ': health cells read the same as CS (one chip per row, dot kept)', await pg.evaluate(HEALTH, 's39-hw') == cs_health, str(((await pg.evaluate(HEALTH, 's39-hw'))[:3], cs_health[:3])))
            ok(tag + ': colour word kept for screen readers', await pg.evaluate("[...document.querySelectorAll('#board td.s39-hasr .s39-hw')].every(s => s.textContent.trim().length > 0)") and
               await pg.evaluate("document.querySelectorAll('#board td.s39-hasr').length > 0"))
            if w == 1200 and not dark:
                for b in BOARDS:
                    await pg.click('#tab-' + b); await pg.wait_for_timeout(350)
                    n = len(await pg.evaluate(LABELS, '#nums > .kpi'))
                    ok('%s: board %s shows %d tiles (five or fewer), no Show all button' % (tag, b, n), n <= 5 and await pg.evaluate("document.getElementById('s39-more').hidden"))
                    await pg.screenshot(path=os.path.join(SHOTS, 'bd-board-%s.png' % b))
                await pg.click('#tab-jpem'); await pg.wait_for_timeout(350)
                # a board with more than five: the extras go behind "Show all numbers"
                await pg.evaluate("""() => { const n = document.getElementById('nums'); ['x1', 'x2'].forEach(k => { const b = document.createElement('button'); b.className = 'kpi'; b.setAttribute('data-tile', k);
                  b.innerHTML = '<span class="label">Extra ' + k + '</span><span class="value num">1</span>'; n.appendChild(b); }); }""")
                await pg.wait_for_timeout(300)
                ok(tag + ': six tiles (four + two added): "Show all numbers (1 more)" appears', (await txt(pg, '#s39-more')) == 'Show all numbers (1 more)' and not await pg.evaluate("document.getElementById('s39-more').hidden"), await txt(pg, '#s39-more'))
                ok(tag + ': ...and only five tiles show', len(await pg.evaluate(LABELS, '#nums > .kpi')) == 5)
                await pg.screenshot(path=os.path.join(SHOTS, 'bd-board-show-all-closed.png'))
                await pg.click('#s39-more'); await pg.wait_for_timeout(200)
                ok(tag + ': Show all opens every tile; button says Show fewer', len(await pg.evaluate(LABELS, '#nums > .kpi')) == 6 and (await txt(pg, '#s39-more')) == 'Show fewer numbers'
                   and await pg.evaluate("document.getElementById('s39-more').getAttribute('aria-expanded') === 'true'"))
                ok(tag + ': the choice is kept in this browser', await pg.evaluate("localStorage.getItem('jpk-s39-morenums')") == '1')
                await pg.click('#s39-more'); await pg.wait_for_timeout(200)
                ok(tag + ': Show fewer goes back to five', len(await pg.evaluate(LABELS, '#nums > .kpi')) == 5)
                await pg.click('#tab-deals'); await pg.wait_for_timeout(300); await pg.click('#tab-jpem'); await pg.wait_for_timeout(300)
                ok(tag + ': board redraw: button hides again when no extras', await pg.evaluate("document.getElementById('s39-more').hidden"))
            ok(tag + ': no sideways scroll', await pg.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"))
            ok(tag + ': no page errors', not errs, '; '.join(errs[:2]))
            await pg.screenshot(path=os.path.join(SHOTS, 'bd-boards-%d-%s.png' % (w, 'dark' if dark else 'light')), full_page=(w == 390))
            await ctx.close()

async def bd_followups(br):
    print('... bd follow-ups', flush=True)
    ctx, pg, errs = await open_page(br, BD, 'ntdemo=1'); cb, pb, eb = await open_page(br, BD0, 'ntdemo=1')
    for p in (pg, pb): await p.evaluate("window.JPKS38.setTab('followups')"); await p.wait_for_timeout(400)
    # demo data as shipped
    new, old = await pg.evaluate(ROWS, 'renew:'), await pb.evaluate(ROWS, 'renew:')
    ok('bd fu demo: renewal rows follow the 120-day not-started rule', new == await pg.evaluate(RULE), str((new, await pg.evaluate(RULE))))
    ok('bd fu demo: the S38 base listed renewals the new rule leaves out (the change bites)', len(old) > 0 and set(new) != set(old), str(old))
    ITEMS = "() => window.__bd.fuItems().map(x => x.key + '|' + x.title + '|' + x.when).filter(k => k.indexOf('renew:') !== 0).sort()"
    a, b = await pg.evaluate(ITEMS), await pb.evaluate(ITEMS)
    ok('bd fu demo: every other follow-up is unchanged (page item list, not just the first five drawn)', a == b and len(a) > 0, str((a, b))[:300])
    ok('bd fu: Renewal chip says the rule', await pg.evaluate("document.querySelector('#fu-filter [data-fut=\"renew\"]').title") == 'Renewals not started, 120 days or less')
    ok('bd fu: the other chips have no new tooltip', await pg.evaluate("[...document.querySelectorAll('#fu-filter [data-fut]')].filter(b => b.dataset.fut !== 'renew').every(b => !b.title)"))
    # customer contracts at known distances
    await pg.evaluate(MUTATE); await pb.evaluate(MUTATE); await pg.wait_for_timeout(300); await pb.wait_for_timeout(300)
    new, old = await pg.evaluate(ROWS, 'renew:'), await pb.evaluate(ROWS, 'renew:')
    ok('bd fu: lists exactly Customer + Not started + 0..120 days', new == await pg.evaluate(RULE) and new == sorted(['renew:k1', 'renew:k6', 'renew:k7', 'renew:k8']), str(new))
    ok('bd fu: 151 days out is left out (was out before too: 90-day window)', 'renew:k2' not in new)
    ok('bd fu: 12 days past end is left out (S38 listed it as overdue)', 'renew:k4' not in new and 'renew:k4' in old, str(old))
    ok('bd fu: Outreach (renewal under way) is left out (S38 listed it)', 'renew:k3' not in new and 'renew:k3' in old)
    ok('bd fu: vendor contracts are left out', 'renew:k5' not in new)
    ok('bd fu: 91-120 days now listed (S38 stopped at 90)', 'renew:k7' in new and 'renew:k7' not in old)
    await pg.click('#fu-filter [data-fut="renew"]'); await pg.wait_for_timeout(200)
    note = await txt(pg, '#fu-list .stale') or ''
    want = await pg.evaluate("""() => { const D = window.__bd.D, b = new Date(); b.setHours(12, 0, 0, 0); const days = s => s ? Math.round((new Date(String(s).slice(0, 10) + 'T12:00:00') - b) / 864e5) : null;
      return D.contracts.filter(c => { const d = days(c.Final_End_Date); return c.Counterparty_Type !== 'Vendor' && c.Contract_Status !== 'Ended' && !/^(signed|not renewing)$/i.test(c.Renewal_Status || '') && d != null && d < 0; }).length; }""")
    ok('bd fu: note counts the contracts past their end date that are left out', note.startswith('%d contract%s past %s end date %s left out here (not renewals to chase)' % (want, '' if want == 1 else 's', 'its' if want == 1 else 'their', 'is' if want == 1 else 'are')), note)
    await pg.screenshot(path=os.path.join(SHOTS, 'bd-followups-renewals.png'), full_page=True)
    ok('bd fu: no page errors', not errs and not eb, '; '.join((errs + eb)[:2]))
    await ctx.close(); await cb.close()
    # ?s39=0 gives the S38 page back
    ctx, pg, errs = await open_page(br, BD, 'ntdemo=1&s39=0'); cb, pb, eb = await open_page(br, BD0, 'ntdemo=1')
    for p in (pg, pb): await p.evaluate("window.JPKS38.setTab('followups')"); await p.wait_for_timeout(400)
    ok('bd ?s39=0: Follow-ups text identical to the S38 base', await txt(pg, '#z-fu') == await txt(pb, '#z-fu'))
    for p in (pg, pb): await p.evaluate("window.JPKS38.setTab('boards')"); await p.wait_for_timeout(400)
    ok('bd ?s39=0: Boards identical to the S38 base, layer off', await txt(pg, '#z-boards') == await txt(pb, '#z-boards') and not await pg.evaluate("document.documentElement.hasAttribute('data-s39') || !!document.getElementById('s39-more')"))
    ok('bd ?s39=0: no page errors', not errs)
    await ctx.close(); await cb.close()

async def untouched(br):
    print('... untouched tabs', flush=True)
    for name, new, old, qs, tabs in (('bd', BD, BD0, 'ntdemo=1', {'today': ['#needs-today', '#s38-sent'], 'links': ['#z-ref'], 'boards': ['#z-boards']}),
                                     ('lead', LD, LD0, 'demo=1', {'today': ['#s38-needs', '#lead-top', '#grid'], 'devices': ['#devs']})):
        ctx, pg, errs = await open_page(br, new, qs); cb, pb, eb = await open_page(br, old, qs)
        for t, sels in tabs.items():
            for p in (pg, pb): await p.evaluate("(t) => window.JPKS38.setTab(t)", t); await p.wait_for_timeout(400)
            for s in sels:
                a, b = await txt(pg, s), await txt(pb, s)
                ok('%s: tab %s %s text identical to the S38 base' % (name, t, s), a == b and a is not None, '' if a == b else str(a)[:100] + ' | ' + str(b)[:100])
        await ctx.close(); await cb.close()

async def lead(br):
    print('... lead', flush=True)
    for w in (1200, 390):
        for dark in (False, True):
            tag = 'lead %d %s' % (w, 'dark' if dark else 'light')
            ctx, pg, errs = await open_page(br, LD, 'demo=1', w, dark)
            ok(tag + ': New meeting is the main header button', (await txt(pg, '#jpk-head .jpk-qa-primary')) == 'New meeting')
            ok(tag + ': S36 and S37 loaded, same versions as BD', await pg.evaluate("window.JPKS36 && window.JPKS36.version === '1.0.0' && !!window.JPKS37 && !!document.getElementById('jpk-s36') && !!document.getElementById('jpk-s37')"))
            ok(tag + ': footer and build say v47.4', await pg.evaluate("window.JPKShell.config.build === 'Leadership Home v47.4' && document.body.innerText.indexOf('Leadership Home v47.4') >= 0 && document.querySelector('meta[name=jpk-build]').content.startsWith('Leadership Home v47.4 ')"))
            await pg.click('#jpk-head .jpk-qa-primary'); await pg.wait_for_timeout(700)
            ok(tag + ': New meeting (main header button) opens the form with both mics and the Say the whole meeting bar', await pg.evaluate("document.querySelectorAll('form .jpk-mic').length === 2 && !!document.querySelector('form .jpk-vq')"))
            await pg.fill('form .jpk-vq-in', 'Teams meeting with Riley tomorrow at 2 for 45 minutes about renewals'); await pg.click('form .jpk-vq-go'); await pg.wait_for_timeout(1800)
            v = await pg.evaluate("['t','s','e','mv'].map(n => document.querySelector('form [name=\"' + n + '\"]').value)")
            ok(tag + ': typed sentence fills the form', v == ['Renewals – with Riley', '14:00', '14:45', 'Online'], str(v))
            ok(tag + ': nothing saved (form still open)', await pg.evaluate("!!document.querySelector('form .jpk-vq') && document.querySelector('form .jpk-vq').getBoundingClientRect().width > 0"))
            ok(tag + ': no sideways scroll with the form open', await pg.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"))
            ok(tag + ': no page errors', not errs, '; '.join(errs[:2]))
            await pg.screenshot(path=os.path.join(SHOTS, 'lead-meeting-%d-%s.png' % (w, 'dark' if dark else 'light')), full_page=False)
            await ctx.close()
    for q, sel in (('s36=0', '.jpk-mic'), ('s37=0', '.jpk-vq')):
        ctx, pg, errs = await open_page(br, LD, 'demo=1&' + q)
        await pg.click('#jpk-head .jpk-qa-primary'); await pg.wait_for_timeout(700)
        ok('lead ?%s: form opens without it' % q, await pg.evaluate("(s) => !!document.querySelector('form input[name=\"t\"]') && !document.querySelector(s)", sel))
        await ctx.close()

async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch()
        only = sys.argv[2:] or ['boards', 'fu', 'untouched', 'lead']
        if 'boards' in only: await bd_boards(br)
        if 'fu' in only: await bd_followups(br)
        if 'untouched' in only: await untouched(br)
        if 'lead' in only: await lead(br)
        await br.close()
    bad = [r for r in R if not r[0]]
    for r in R:
        if not r[0] or '-v' in sys.argv: print(('PASS ' if r[0] else 'FAIL ') + r[1] + ((' :: ' + r[2]) if r[2] and not r[0] else ''))
    print('S39 %s: %d pass, %d fail' % (' '.join(sys.argv[2:]) or 'all', len(R) - len(bad), len(bad)))

asyncio.run(main())
