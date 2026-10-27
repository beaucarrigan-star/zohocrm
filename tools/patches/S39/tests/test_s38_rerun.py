"""S38's Phase 5 tests, re-run on the S39 builds (BD v6.5, Leadership v47.4) with the S38 builds as the base page.
Copied from ux/home-tiles/tests/test_s38.py. Changes, and only these:
  - H: the bd and lead entries point at the S39 builds, base = the S38 build, versions v6.5 / v47.4. em and cs are not run:
    S39 does not touch them (their zips are unchanged).
  - the section-text comparison skips #z-fu on BD: S39 changes Follow-ups renewals on purpose; test_s39.py compares the rest of it.
  - theme check runs Leadership and BD only (EM's chooser is replaced by setting the shared key directly).
Usage: python3 -I test_s38_rerun.py <scratch dir>   (expects out/x/<build>/app/widget.html and base/<build>/app/widget.html)"""
import asyncio, json, os, re, sys
from playwright.async_api import async_playwright

S = sys.argv[1]
SHOTS = os.path.join(S, 'shots', 's38-rerun'); os.makedirs(SHOTS, exist_ok=True)
H = {
  'bd':   dict(new='out/x/BD-Home-v6.5-s39-leftovers', base='base/BD-Home-v6.4-s38-phase5', qs='ntdemo=1', ver='BD Home v6.5', frame=True, send=True,
               tabs=['Today', 'Follow-ups', 'Boards', 'Links & Vendors'],
               zones={'today': ['#needs-today', '#jpk-cal'], 'followups': ['#z-fu'], 'boards': ['#z-boards'], 'links': ['#z-ref']},
               skiptext=['#z-fu'],
               what='Your pipeline day: proposals due, deals past close, meetings and touches to log, prospects gone cold, and the brand boards.'),
  'lead': dict(new='out/x/Leadership-Home-v47.4-s39-leftovers', base='base/Leadership-Home-v47.3-s38-phase5', qs='demo=1', ver='Leadership Home v47.4', frame=True, lead=True,
               tabs=['Today', 'Devices'],
               zones={'today': ['#grid', '#s38-needs', '#jpk-cal'], 'devices': ['#devs']},
               skiptext=[],
               what='Six measures, read-only: renewals at risk, renewal rate, customers by health, cases handled in a day, open billing findings, overdue work. Each is marked Reliable or Not yet reliable by the weekly data check.'),
}
R = []
def ok(name, cond, info=''):
    R.append((bool(cond), name, info))

async def open_page(br, path, qs, w=1200, dark=False, init=None, storage=None):
    ctx = await br.new_context(viewport={'width': w, 'height': 900}, color_scheme='dark' if dark else 'light')
    pg = await ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    await pg.route('**/*', lambda r: r.continue_() if r.request.url.startswith('file:') else r.abort())
    if storage:
        await pg.add_init_script('(() => { try { const s = %s; for (const k in s) localStorage.setItem(k, s[k]); } catch (e) {} })()' % json.dumps(storage))
    if init: await pg.add_init_script(init)
    await pg.goto('file://' + os.path.join(S, path, 'app/widget.html') + ('?' + qs if qs else ''))
    await pg.wait_for_timeout(3500)
    return ctx, pg, errs

VIS = "(s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return !!(r.width && r.height) && getComputedStyle(e).visibility !== 'hidden'; }"
async def vis(pg, s): return await pg.evaluate(VIS, s)
async def txt(pg, s): return await pg.evaluate("(s) => { const e = document.querySelector(s); return e ? e.innerText.replace(/\\s+/g, ' ').trim() : null; }", s)

async def frame_checks(br, k, h):
    print('...', k, flush=True)
    for w in (1200, 390):
        for dark in (False, True):
            tag = '%s %d %s' % (k, w, 'dark' if dark else 'light')
            ctx, pg, errs = await open_page(br, h['new'], h['qs'], w, dark)
            ok(tag + ': no page errors', not errs, '; '.join(errs[:2]))
            ok(tag + ': layer on', await pg.evaluate("document.documentElement.getAttribute('data-s38') === 'on'"))
            ok(tag + ': old masthead / Home bar hidden', not await vis(pg, '#page > header.mast') and not await vis(pg, '#nt-nav') and not await vis(pg, '#page > .navrow'))
            ok(tag + ": Today's flow hidden", not await vis(pg, '#jpk-flow'))
            ok(tag + ': GO TO, Go to, Collapse all hidden', not await vis(pg, '.quick-actions .hl-nav') and not await vis(pg, '.quick-actions .hl-all') and not await vis(pg, '#go-btn'))
            labels = await pg.evaluate("[...document.querySelectorAll('#s38-tabs .s38-tl')].map(e => e.textContent)")
            ok(tag + ': tabs are ' + ', '.join(h['tabs']), labels == h['tabs'], str(labels))
            hi = await pg.evaluate("(() => { const a = document.querySelector('#jpk-head .jpk-hi'), b = document.querySelector('#jpk-head .jpk-qa-primary'), t = document.querySelector('#s38-right'); if (!a || !b || !t) return null; const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(), rt = t.getBoundingClientRect(); return [ra.top, ra.bottom, rb.top, rb.bottom, rt.top, rt.bottom]; })()")
            if w == 1200:
                ok(tag + ': one header row (greeting, primary action, tools)', hi and hi[2] < hi[1] and hi[0] < hi[3] and hi[4] < hi[1] + 30, str(hi))
            ok(tag + ': refresh / tools visible in the header', await pg.evaluate("(() => { const b = document.querySelector('#s38-right button'); if (!b) return false; const r = b.getBoundingClientRect(); return r.width > 20 && r.height > 20; })()"))
            ok(tag + ': greeting uses one first name', bool(re.match(r'^Good (morning|afternoon|evening)(, \S+)?$', (await txt(pg, '#jpk-head .jpk-hi')) or '')), await txt(pg, '#jpk-head .jpk-hi'))
            ok(tag + ': S35 guide line, word for word', (await txt(pg, '#jpk-intro .ji-t')) == h['what'])
            ok(tag + ': version ' + h['ver'] + ' (meta, build, footer)', await pg.evaluate("(v) => document.querySelector('meta[name=jpk-build]').content.startsWith(v + ' ') && window.JPKShell.config.build === v && (document.body.innerText.indexOf(v) >= 0 || getComputedStyle(document.documentElement).getPropertyValue('--jpk-source').indexOf(v) >= 0)", h['ver']))
            ok(tag + ': no sideways scroll', await pg.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), str(await pg.evaluate("[document.documentElement.scrollWidth, innerWidth]")))
            if w == 1200 and not dark:
                for tid, sels in h['zones'].items():
                    await pg.evaluate("(id) => window.JPKS38.setTab(id)", tid)
                    await pg.wait_for_timeout(250)
                    shown = [await vis(pg, s) for s in sels]
                    ok('%s: tab %s shows %s' % (tag, tid, ', '.join(sels)), all(shown), str(shown))
                    others = [s for t2, ss in h['zones'].items() if t2 != tid for s in ss]
                    hid = [not await vis(pg, s) for s in others]
                    ok('%s: tab %s hides the other tabs\' sections' % (tag, tid), all(hid), str(list(zip(others, hid))))
                    if tid != 'today':
                        ok('%s: tab %s gives the work the full width (no empty side column)' % (tag, tid), not await vis(pg, '#page .jpk-side'))
                    await pg.screenshot(path=os.path.join(SHOTS, '%s-tab-%s.png' % (k, tid)), full_page=True)
                await pg.evaluate("window.JPKS38.setTab('today')")
                far = list(h['zones'].items())[-1]
                await pg.evaluate("(s) => document.querySelector(s).scrollIntoView()", far[1][0])
                ok(tag + ': scrolling to a section on another tab opens that tab', (await pg.evaluate("window.JPKS38.getTab()")) == far[0])
                await pg.reload(); await pg.wait_for_timeout(3000)
                ok(tag + ': last tab is kept after reload', (await pg.evaluate("window.JPKS38.getTab()")) == far[0])
                await pg.evaluate("window.JPKS38.setTab('today')")
                items = await pg.evaluate("[...document.querySelectorAll('#s38-more-list button')].map(b => b.textContent)")
                origs = await pg.evaluate("[...document.querySelectorAll('#jpk-head .jpk-qa .jpk-qa-btn:not(.jpk-qa-primary)')].map(b => b.textContent.replace(/\\s+/g,' ').trim())")
                ok(tag + ': More menu lists every other quick action', items == origs and len(items) > 0, str(items))
                ok(tag + ': the other quick actions are not shown in the header', not any([await pg.evaluate("(i) => { const b = document.querySelectorAll('#jpk-head .jpk-qa .jpk-qa-btn:not(.jpk-qa-primary)')[i]; return !!(b && b.getBoundingClientRect().width); }", i) for i in range(len(origs))]))
                await pg.click('#s38-more-btn')
                ok(tag + ': More opens', await vis(pg, '#s38-more-list'))
                await pg.keyboard.press('Escape')
                ok(tag + ': Escape closes More', not await vis(pg, '#s38-more-list'))
                if k == 'bd':
                    await pg.click('#s38-more-btn'); await pg.click('#s38-more-list button[data-s38-label="Log a touch"]'); await pg.wait_for_timeout(500)
                    ok(tag + ': More > Log a touch goes to the Follow-ups tab', (await pg.evaluate("window.JPKS38.getTab()")) == 'followups')
                    await pg.evaluate("window.JPKS38.setTab('boards')"); await pg.wait_for_timeout(300)
                    ok(tag + ': Boards: the "Renewals · 90 days" tile is hidden', await pg.evaluate("(() => { const t = [...document.querySelectorAll('#z-boards [data-tile=\\\"renew\\\"]')]; return t.length > 0 && t.every(e => !e.getBoundingClientRect().width); })()"))
                    ok(tag + ': Boards: other tiles still show', await pg.evaluate("[...document.querySelectorAll('#z-boards [data-tile]')].filter(e => e.getBoundingClientRect().width).length >= 3"))
                    await pg.evaluate("window.JPKS38.setTab('today')")
                if k in ('em', 'bd'):
                    ok(tag + ': Needs you today is one card (border)', await pg.evaluate("getComputedStyle(document.getElementById('needs-today')).borderTopStyle === 'solid'"))
                    ok(tag + ': the stamp under the tiles is hidden', not await vis(pg, '#needs-today .nt-foot') and await pg.evaluate("getComputedStyle(document.getElementById('needs-today'), '::after').content") in ('none', 'normal', ''))
                    await pg.evaluate("(() => { const t = document.querySelector('#needs-today .nt-tile'); t.classList.add('empty'); })()"); await pg.wait_for_timeout(900)
                    ok(tag + ': a tile at zero hides', not await pg.evaluate("document.querySelector('#needs-today .nt-tiles > li').getBoundingClientRect().width"))
                    await pg.evaluate("document.querySelectorAll('#needs-today .nt-tile').forEach(t => t.classList.add('empty'))"); await pg.wait_for_timeout(900)
                    ok(tag + ': all tiles at zero: "Nothing needs you today."', (await txt(pg, '#s38-none')) == 'Nothing needs you today.' and await vis(pg, '#s38-none'))
                if k == 'lead':
                    lbl = await pg.evaluate("[...document.querySelectorAll('#s38-needs .nt-tiles > li')].filter(li => !li.hidden).map(li => li.querySelector('.nt-lbl').textContent + '=' + li.querySelector('.nt-num').textContent)")
                    m = await pg.evaluate("[window.JPKS31.measure('renewalsAtRisk').v, window.JPKS31.measure('findings').v, window.JPKS31.overdue().v]")
                    ok(tag + ': Needs you today has four tiles', len(lbl) == 4, str(lbl))
                    ok(tag + ': tiles match the measures', lbl[1:] == ['Renewals at risk=%s' % m[0], 'Open billing findings=%s' % m[1], 'Overdue work=%s' % m[2]], str((lbl, m)))
                    ok(tag + ': Cases sent to you lists the demo cases with sender', 'from Joe' in (await txt(pg, '#s38-needs [data-s38-tile="sent"]') or ''))
                    ok(tag + ': card sits above the measures', await pg.evaluate("document.getElementById('s38-needs').getBoundingClientRect().bottom <= document.getElementById('grid').getBoundingClientRect().top + 1"))
                    await pg.click('#s38-needs [data-s38-tile="risk"] .nt-tile'); await pg.wait_for_timeout(700)
                    ok(tag + ': a measure tile takes you to its measure', await pg.evaluate("(() => { const r = document.getElementById('h-renewalsAtRisk').getBoundingClientRect(); return r.top >= -5 && r.top < innerHeight; })()"))
            await pg.screenshot(path=os.path.join(SHOTS, '%s-%d-%s.png' % (k, w, 'dark' if dark else 'light')), full_page=(w == 390))
            await ctx.close()

    ctx, pg, errs = await open_page(br, h['new'], h['qs'])
    cb, pb, eb = await open_page(br, h['base'], h['qs'])
    for tid, sels in h['zones'].items():
        await pg.evaluate("(id) => window.JPKS38.setTab(id)", tid); await pb.evaluate("(id) => window.JPKS38.setTab(id)", tid); await pg.wait_for_timeout(300)
        for s in sels:
            if s in ('#s38-needs', '#jpk-cal', '#needs-today') or s in h['skiptext']: continue
            a, b = await txt(pg, s), await txt(pb, s)
            ok('%s: %s has the same text as the S38 base' % (k, s), a == b, '' if a == b else (str(a)[:120] + ' | ' + str(b)[:120]))
    await ctx.close(); await cb.close()

    ctx, pg, errs = await open_page(br, h['new'], h['qs'] + '&s38=0')
    ok(k + ' ?s38=0: layer off, old header, flow and nav back', not await pg.evaluate("document.documentElement.hasAttribute('data-s38')") and await vis(pg, '#jpk-flow') and not await vis(pg, '#s38-tabs'))
    ok(k + ' ?s38=0: no page errors', not errs)
    await ctx.close()
    ctx, pg, errs = await open_page(br, h['new'], h['qs'] + '&s35=0')
    ok(k + ' ?s35=0: no guide line', not await vis(pg, '#jpk-intro'))
    await ctx.close()
    ctx, pg, errs = await open_page(br, h['new'], h['qs'] + ('&shell=0' if k == 'lead' else ''))
    sw = True if k == 'lead' else await pg.evaluate("(() => { const b = [...document.querySelectorAll('button')].find(b => /classic layout/i.test(b.textContent)); if (b) { b.click(); return true; } return false; })()"); ok(k + ' classic layout: switch found', sw); await pg.wait_for_timeout(1500)
    ok(k + ' classic layout: frame layer steps aside', not await pg.evaluate("document.documentElement.hasAttribute('data-s38')") and not await vis(pg, '#s38-tabs'))
    ok(k + ' classic layout: tools back in their own place', await pg.evaluate("(() => { const t = document.getElementById('mast-tools') || document.querySelector('.navrow .tools'); return !!t && !t.closest('#s38-right'); })()"))
    ok(k + ' classic layout: no page errors', not errs, '; '.join(errs[:2]))
    await ctx.close()

    ctx, pg, errs = await open_page(br, h['new'], h['qs'] + '&caldemo=empty')
    await pg.evaluate("(() => { const b = document.querySelector('#jpk-cal .jpk-cal-head button[aria-expanded=\\\"false\\\"], #jpk-cal .jpk-collapse, #jpk-cal-h button'); if (b) b.click(); })()")
    await pg.wait_for_timeout(1500)
    st = await pg.evaluate("[document.getElementById('jpk-cal').hasAttribute('data-s38-empty-day'), (window.JPKShell.state.cal || {}).status, !!document.getElementById('s32-wrap')]")
    ok(k + ' empty day: calendar folds the hour grid', st[0], str(st))
    ok(k + ' empty day: no page errors', not errs)
    await ctx.close()

async def send_checks(br, k, h):
    ctx, pg, errs = await open_page(br, h['new'], h['qs'])
    ok(k + ' send: "Send to Leadership…" is in + New', await pg.evaluate("!!document.querySelector('#new-list #s38-send-item')"))
    ok(k + ' send: Sent to Leadership card shows (demo)', await vis(pg, '#s38-sent'))
    ok(k + ' send: card sits right under its Needs card', await pg.evaluate("(() => { const c = document.getElementById('s38-sent'), p = c.previousElementSibling; return !!p && (p.id === 'needs-today' || p.id === 'jpk-nt'); })()"))
    ok(k + ' send: card left edge lines up with the card above', await pg.evaluate("(() => { const c = document.getElementById('s38-sent'), p = c.previousElementSibling; return Math.abs(c.getBoundingClientRect().left - p.getBoundingClientRect().left) < 2; })()"))
    await pg.click('#new-btn'); await pg.wait_for_timeout(200); await pg.click('#s38-send-item'); await pg.wait_for_timeout(400)
    ok(k + ' send: the form opens from + New', await vis(pg, '.s38-dlg'))
    ok(k + ' send: + New menu closed', not await vis(pg, '#new-list'))
    opts = await pg.evaluate("[...document.querySelectorAll('#s38-f-to option')].map(o => o.textContent)")
    ok(k + ' send: leaders listed', opts == ['Pick a leader', 'Edward Gordon', 'Nick Sayner', 'Stacey Anick'], str(opts))
    await pg.click('#s38-f-send')
    ok(k + ' send: no leader -> asks for one, nothing sent', (await txt(pg, '#s38-f-err')) == 'Pick the leader to send it to.' and (await pg.evaluate("window.JPKS38.lastPayload()")) is None)
    await pg.select_option('#s38-f-to', '6715134000000779001')
    ok(k + ' send: button names the leader', (await txt(pg, '#s38-f-send')) == 'Send to Nick')
    await pg.click('#s38-f-send')
    ok(k + ' send: no subject -> asks for one', (await txt(pg, '#s38-f-err')) == 'Say in one line what you need.')
    await pg.fill('#s38-f-subj', 'TEST - approve Polk renewal terms')
    await pg.fill('#s38-f-acct', 'polk'); await pg.wait_for_timeout(700)
    await pg.click('#s38-f-res button[data-id="demo-acct-1"]')
    ok(k + ' send: account picked', (await txt(pg, '#s38-f-picked span')) == 'Polk County Sheriff')
    await pg.fill('#s38-f-due', '2026-11-03'); await pg.select_option('#s38-f-pri', 'High'); await pg.fill('#s38-f-note', 'Need a yes by Tuesday.')
    await pg.click('#s38-f-send'); await pg.wait_for_timeout(800)
    p = await pg.evaluate("window.JPKS38.lastPayload()")
    ok(k + ' send (preview): payload fields', p and p['Handling_Team'] == 'Leadership' and p['Case_Origin'] == 'Web' and p['Status'] == 'New' and p['Owner'] == {'id': '6715134000000779001'}
       and p['Priority'] == 'High' and p['Account_Name'] == {'id': 'demo-acct-1'} and p['Subject'] == 'TEST - approve Polk renewal terms', json.dumps(p))
    ok(k + ' send (preview): Due By is 5 PM local with offset', p and re.match(r'^2026-11-03T17:00:00[+-]\d\d:\d\d$', p['Due_By']), p and p['Due_By'])
    ok(k + ' send (preview): note keeps the details and says who sent it', p and p['Description'].startswith('Need a yes by Tuesday.') and 'Sent to Leadership from' in p['Description'])
    ok(k + ' send (preview): form closes, says nothing was sent', not await vis(pg, '.s38-dlg') and 'Preview: nothing was sent' in (await txt(pg, '#s38-toast') or ''))
    ok(k + ' send (preview): new row on the card', 'TEST - approve Polk renewal terms' in (await txt(pg, '#s38-sent') or ''))
    await pg.click('#s38-sent-new'); await pg.wait_for_timeout(300)
    ok(k + ' send: "+ Send a case" opens the form, cleared', await vis(pg, '.s38-dlg') and (await pg.evaluate("document.getElementById('s38-f-subj').value")) == '')
    await pg.keyboard.press('Escape')
    ok(k + ' send: Escape closes the form', not await vis(pg, '.s38-dlg'))
    ok(k + ' send: no page errors', not errs, '; '.join(errs[:2]))
    await pg.set_viewport_size({'width': 390, 'height': 800}); await pg.wait_for_timeout(600)
    await pg.evaluate("window.JPKS38.openSend()"); await pg.wait_for_timeout(300)
    ok(k + ' send: form fits at 390 px', await pg.evaluate("document.querySelector('.s38-dlg').getBoundingClientRect().right <= innerWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1"))
    await pg.keyboard.press('Escape')
    await ctx.close()

    FAKE = r"""(() => {
      window.__calls = [];
      const users = [{id:'6715134000001216001', full_name:'Joe Steinhaus', profile:{name:'Business Development'}},
        {id:'6715134000000774001', full_name:'Edward Gordon', profile:{name:'Leadership'}}, {id:'6715134000000779001', full_name:'Nick Sayner', profile:{name:'Leadership'}},
        {id:'6715134000000781001', full_name:'Stacey Anick', profile:{name:'Leadership'}}, {id:'6715134000003334001', full_name:'Miranda Wilson', profile:{name:'PDEC'}}];
      window.__fail = false;
      window.ZOHO = { CRM: { API: {
        coql: (a) => { __calls.push(['coql', a.select_query]); if (/from Cases/.test(a.select_query)) return Promise.resolve({ data: [{ id: '111', Subject: 'Live sent case', Status: 'In Progress', Due_By: '2026-11-03T17:00:00-06:00', Owner: { id: '6715134000000774001' } }] });
                                return Promise.resolve({ data: [{ id: '222', Account_Name: 'Polk County Sheriff' }] }); },
        getAllUsers: () => { __calls.push(['users']); return Promise.resolve({ users }); },
        insertRecord: (a) => { __calls.push(['insert', a]); return __fail ? Promise.resolve({ data: [{ code: 'MANDATORY_NOT_FOUND', message: 'required field not found' }] }) : Promise.resolve({ data: [{ code: 'SUCCESS', details: { id: '333' } }] }); }
      }, CONFIG: { getCurrentUser: () => Promise.resolve({ users: [users[0]] }) }, UI: { Record: { open: (o) => { __calls.push(['open', o]); return Promise.resolve(); } } } } };
      window.__bdcsUser = users[0];
    })()"""
    ctx, pg, errs = await open_page(br, h['new'], h['qs'])
    await pg.evaluate(FAKE); await pg.evaluate("window.JPKS38.refresh()"); await pg.wait_for_timeout(1200)
    calls = await pg.evaluate("__calls")
    sq = [c[1] for c in calls if c[0] == 'coql']
    ok(k + ' live: Sent card reads my Leadership cases', any("Handling_Team = 'Leadership'" in s and "Created_By = '6715134000001216001'" in s for s in sq), str(sq))
    ok(k + ' live: Sent card shows the row with the leader\'s name', 'Live sent case' in (await txt(pg, '#s38-sent') or '') and 'to Edward' in (await txt(pg, '#s38-sent') or ''))
    await pg.evaluate("window.JPKS38.openSend()"); await pg.wait_for_timeout(500)
    opts = await pg.evaluate("[...document.querySelectorAll('#s38-f-to option')].map(o => o.textContent)")
    ok(k + ' live: leaders are the Leadership profile users only', opts == ['Pick a leader', 'Edward Gordon', 'Nick Sayner', 'Stacey Anick'], str(opts))
    await pg.select_option('#s38-f-to', '6715134000000781001'); await pg.fill('#s38-f-subj', 'TEST live send'); await pg.fill('#s38-f-due', '2026-11-04')
    await pg.evaluate("window.__fail = true"); await pg.click('#s38-f-send'); await pg.wait_for_timeout(600)
    ok(k + ' live: a failed save says so and keeps the form', await vis(pg, '.s38-dlg') and 'Not sent' in (await txt(pg, '#s38-f-err') or ''))
    await pg.evaluate("window.__fail = false"); await pg.click('#s38-f-send'); await pg.wait_for_timeout(900)
    ins = [c[1] for c in await pg.evaluate("__calls") if c[0] == 'insert']
    ok(k + ' live: one insert per click (2 clicks, 2 inserts)', len(ins) == 2)
    a = ins[-1] if ins else {}
    ok(k + ' live: insertRecord on Cases with workflows', a.get('Entity') == 'Cases' and a.get('Trigger') == ['workflow'], json.dumps(a)[:300])
    d = a.get('APIData', {})
    ok(k + ' live: Owner = leader picked, Handling_Team Leadership, Origin Web', d.get('Owner') == {'id': '6715134000000781001'} and d.get('Handling_Team') == 'Leadership' and d.get('Case_Origin') == 'Web' and d.get('Status') == 'New')
    ok(k + ' live: sender named in the details', 'by Joe Steinhaus' in d.get('Description', ''))
    ok(k + ' live: success toast names the leader, with Open', 'Sent to Stacey Anick' in (await txt(pg, '#s38-toast') or '') and await vis(pg, '#s38-toast a'))
    await pg.click('#s38-toast a'); await pg.wait_for_timeout(200)
    ok(k + ' live: Open opens the new case record', any(c[0] == 'open' and c[1] == {'Entity': 'Cases', 'RecordID': '333'} for c in await pg.evaluate("__calls")))
    ok(k + ' live: no page errors', not errs, '; '.join(errs[:2]))
    await ctx.close()

async def lead_live(br, h):
    FAKE = r"""(() => { window.__calls = [];
      window.ZOHO = { CRM: { API: {
        coql: (a) => { __calls.push(a.select_query); return Promise.resolve({ data: [
          { id: '901', Subject: 'Approve Polk terms', Status: 'New', Due_By: '2020-01-01T17:00:00-06:00', Created_By: { id: '6715134000001216001' } },
          { id: '902', Subject: 'Pricing sign-off', Status: 'In Progress', Due_By: '2099-01-01T17:00:00-06:00', Created_By: { id: '6715134000000503001' } } ] }); },
        getAllUsers: () => Promise.resolve({ users: [{ id: '6715134000001216001', full_name: 'Joe Steinhaus', profile: { name: 'Business Development' } }, { id: '6715134000000503001', full_name: 'Beau Carrigan', profile: { name: 'Administrator' } }] }) },
        CONFIG: { getCurrentUser: () => Promise.resolve({ users: [{ id: '6715134000000779001', full_name: 'Nick Sayner' }] }) }, UI: { Record: { open: () => Promise.resolve() } } } };
      window.__bdcsUser = { id: '6715134000000779001', full_name: 'Nick Sayner', first_name: 'Nick' }; })()"""
    ctx, pg, errs = await open_page(br, h['new'], h['qs'])
    await pg.evaluate(FAKE); await pg.evaluate("window.JPKS38.refresh()"); await pg.wait_for_timeout(1200)
    q = await pg.evaluate("__calls")
    ok('lead live: reads open Leadership cases owned by me', any("Handling_Team = 'Leadership'" in s and "Owner = '6715134000000779001'" in s and "not in ('Closed', 'Resolved')" in s for s in q), str(q))
    t = await txt(pg, '#s38-needs [data-s38-tile="sent"]') or ''
    ok('lead live: tile shows 2, 1 overdue, senders', t.startswith('Cases sent to you 2') and '1 overdue' in t and 'from Joe' in t and 'from Beau' in t, t)
    ok('lead live: no page errors', not errs)
    await ctx.close()
    ctx, pg, errs = await open_page(br, h['new'], h['qs'] + '&s38demo=none')
    ok('lead: no cases sent -> that tile hides', await pg.evaluate("document.querySelector('#s38-needs [data-s38-tile=\\\"sent\\\"]').hidden"))
    await ctx.close()

async def theme_checks(br):
    for k in ('lead', 'bd'):
        ctx, pg, errs = await open_page(br, H[k]['new'], H[k]['qs'], storage={'jpk-theme-shared': 'dark'})
        ok('theme: %s opens dark from the shared choice' % k, (await pg.evaluate("document.documentElement.getAttribute('data-theme')")) == 'dark')
        if k == 'lead': ok('theme: Leadership button says Dark', (await txt(pg, '#theme')) == 'Dark')
        await ctx.close()

async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch()
        only = sys.argv[2:] or ['bd', 'lead', 'send', 'live', 'theme']
        for k in ('bd', 'lead'):
            if k in only: await frame_checks(br, k, H[k])
        if 'send' in only: await send_checks(br, 'bd', H['bd'])
        if 'live' in only: await lead_live(br, H['lead'])
        if 'theme' in only: await theme_checks(br)
        await br.close()
    bad = [r for r in R if not r[0]]
    for r in R:
        if not r[0]: print('FAIL ' + r[1] + ((' :: ' + r[2]) if r[2] else ''))
    print('S38 rerun %s: %d pass, %d fail' % (' '.join(sys.argv[2:]) or 'all', len(R) - len(bad), len(bad)))

asyncio.run(main())
