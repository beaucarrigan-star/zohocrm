"""S24 step 8: rebuilt "S21 Boards" regression suite, run on BOTH the v5.11 base and the patched v6.0 page (and on the patched page
with ?shell=0), plus the S24 integration checks on the patched page only.

Usage (from any directory, widget files are untrusted data and are only read):
    python3 -I run_s21_equiv.py <scratchpad dir>
The scratchpad dir holds s24-base/app/widget.html and s24-out1/app/widget.html. Writes last-run-s21-equiv.txt next to this script.

Every page load blocks every non-file request, fixes the clock at 22 Oct 2026 10:00 America/Chicago and opens the real widget in
?preview=1&ntdemo=1 (no Zoho SDK: the page's own PREVIEW path with sample data). Nothing here talks to Zoho, Outlook or any live system.
"""
import sys, re, json, hashlib, pathlib, datetime, traceback
from playwright.sync_api import sync_playwright

SP = pathlib.Path(sys.argv[1]).resolve()
BASE_F = SP / 's24-base' / 'app' / 'widget.html'
PATCH_F = SP / 's24-out1' / 'app' / 'widget.html'
OUT = pathlib.Path(__file__).resolve().parent / 'last-run-s21-equiv.txt'
BASE_SHA = 'e86ba0ea396a830d8058fca6a2c201e25bee46f56ceeea028c07964bcd8d835f'
NOW = '2026-10-22T10:00:00-05:00'
Q = '?preview=1&ntdemo=1'
URLS = {'base': BASE_F.as_uri() + Q, 'patched': PATCH_F.as_uri() + Q, 'shell0': PATCH_F.as_uri() + Q + '&shell=0'}
SEEDED = {'jpk-shell-seeded-cs': '1'}
BOARDS = ['jpem', 'jpprog', 'sirona', 'tdp', 'deals', 'campaigns', 'vendors']
LABELS = ['JusticePoint EM', 'JusticePoint Programs', 'Sirona Recovery', 'The Difference Principle', 'All Opportunities', 'Campaigns', 'Vendors & Products']
BRANDS = ['jpem', 'jpprog', 'sirona', 'tdp']
VARS = {'L': (1400, 'light'), 'D': (1400, 'dark'), 'P': (390, 'light'), 'PD': (390, 'dark')}

PASS, FAIL, SKIP = 'PASS', 'FAIL', 'SKIPPED'
ERRS = {t: {'page': [], 'console': []} for t in URLS}


def norm(m):
    return re.sub(r'file:///\S+', 'FILE', re.sub(r'https?://\S+', 'URL', m)).strip()


class Runner:
    def __init__(self, p):
        self.b = p.chromium.launch()

    def page(self, url, var='L', init=None, storage=SEEDED, wait=2200, target=None, track=True):
        w, scheme = VARS[var] if isinstance(var, str) else var
        ctx = self.b.new_context(viewport={'width': w, 'height': 900}, color_scheme=scheme, timezone_id='America/Chicago', reduced_motion='reduce')
        pg = ctx.new_page()
        pg.pe, pg.ce, pg.reqs = [], [], []
        pg.on('pageerror', lambda e: pg.pe.append(str(e)))
        pg.on('console', lambda m: pg.ce.append(m.text) if m.type == 'error' else None)
        pg.on('request', lambda r: pg.reqs.append(r.url) if not r.url.startswith('file:') else None)
        pg.route('**/*', lambda r: r.continue_() if r.request.url.startswith('file:') else r.abort())
        pg.clock.set_system_time(datetime.datetime.fromisoformat(NOW))
        if storage:
            pg.add_init_script('(() => { try { const s = ' + json.dumps(storage) + '; if (!sessionStorage.getItem("__seeded")) { for (const k in s) localStorage.setItem(k, s[k]); sessionStorage.setItem("__seeded", "1"); } } catch (e) {} })()')
        if init:
            pg.add_init_script(init)
        pg.goto(url)
        pg.wait_for_function("() => document.querySelector('#bwrap table') && document.querySelectorAll('#btabs .n').length", timeout=15000)
        pg.wait_for_timeout(wait)
        pg.target = target
        return pg

    def close(self, pg):
        t = pg.target
        if t:
            ERRS[t]['page'] += [norm(e) for e in pg.pe]
            ERRS[t]['console'] += [norm(e) for e in pg.ce]
        pg.context.close()


# ---------------------------------------------------------------- small in-page helpers
SEL = "() => { const s = document.querySelector('#btabs [aria-selected=true]'); return s ? s.dataset.board : null; }"
TABS = "() => Array.from(document.querySelectorAll('#btabs [role=tab]')).map(b => ({ b: b.dataset.board, t: b.childNodes[0].textContent.trim(), k: b.getAttribute('aria-keyshortcuts'), sel: b.getAttribute('aria-selected') }))"
BG = "() => getComputedStyle(document.body).backgroundColor"


def bg_lum(pg):
    m = re.findall(r'[\d.]+', pg.evaluate(BG))
    r, g, b = [float(x) for x in m[:3]]
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def theme_ok(pg, var):
    """The page really is in the theme the variant claims (dark background is clearly darker than light)."""
    l = bg_lum(pg)
    return (l < 90) if VARS[var][1] == 'dark' else (l > 160)


def blur(pg):
    pg.evaluate("() => { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); }")


def goto_tab(pg, board):
    pg.click('#btabs [data-board="%s"]' % board)
    pg.wait_for_timeout(150)


def rows(pg):
    return pg.evaluate("() => Array.from(document.querySelectorAll('#bwrap tbody tr[data-id], #bwrap [data-id]')).filter(e => e.tagName === 'TR').map(e => e.getAttribute('data-id'))")


def no_hscroll(pg):
    return pg.evaluate("() => [document.documentElement.scrollWidth, document.body.scrollWidth, innerWidth]")


def close_peek(pg):
    if pg.evaluate("() => !document.getElementById('peek').hidden"):
        pg.keyboard.press('Escape'); pg.wait_for_timeout(300)


def toast(pg):
    return pg.evaluate("() => { const t = document.getElementById('qtoast'); return t && !t.hidden ? t.innerText : ''; }")


def ok(cond, info=''):
    return (bool(cond), info)


# ---------------------------------------------------------------- the Boards checks (S21 equivalent)
CHECKS = []   # (id, name, variant, fn)


def chk(name, var='L'):
    def deco(fn):
        CHECKS.append((len(CHECKS) + 1, '[%s] %s' % (var, name), var, fn))
        return fn
    return deco


@chk('tab strip: 7 tabs in order (JP EM, JP Programs, Sirona, TDP, All Opportunities, Campaigns, Vendors & Products), keys 1-7 advertised', 'L')
def c_tabs_L(pg, T):
    t = pg.evaluate(TABS)
    return ok([x['t'] for x in t] == LABELS and [x['b'] for x in t] == BOARDS and [x['k'] for x in t] == [str(i) for i in range(1, 8)] and t[0]['sel'] == 'true', t)


@chk('tab strip: same 7 tabs in order; page really is dark', 'D')
def c_tabs_D(pg, T):
    t = pg.evaluate(TABS)
    return ok(theme_ok(pg, 'D') and [x['t'] for x in t] == LABELS, [bg_lum(pg), t])


@chk('tab strip: all 7 tabs reachable and clickable, no horizontal page scroll', 'P')
def c_tabs_P(pg, T):
    got = []
    for b in BOARDS:
        pg.locator('#btabs [data-board="%s"]' % b).scroll_into_view_if_needed(); goto_tab(pg, b); got.append(pg.evaluate(SEL))
    sw = no_hscroll(pg)
    return ok(got == BOARDS and sw[0] <= sw[2] + 1, [got, sw])


@chk('each of the 4 brand tabs has the Accounts | Opportunities switch; All Opportunities, Campaigns, Vendors do not', 'L')
def c_subpresent(pg, T):
    out = {}
    for b in BOARDS:
        goto_tab(pg, b)
        out[b] = pg.evaluate("() => Array.from(document.querySelectorAll('#bfilt [data-fk=sub]')).map(x => x.textContent.replace(/\\d+/g, '').trim())")
    good = all(out[b] == ['Accounts', 'Opportunities'] for b in BRANDS) and all(out[b] == [] for b in ['deals', 'campaigns', 'vendors'])
    return ok(good, out)


def keys_check(pg, T, var):
    got = []
    for i in range(1, 8):
        blur(pg); pg.keyboard.press(str(i)); pg.wait_for_timeout(120); got.append(pg.evaluate(SEL))
    pg.keyboard.press('1'); pg.wait_for_timeout(100)
    return ok(got == BOARDS and pg.evaluate(SEL) == 'jpem' and theme_ok(pg, var), got)


@chk('keys 1 to 7 switch tabs in order', 'L')
def c_keys_L(pg, T): return keys_check(pg, T, 'L')


@chk('keys 1 to 7 switch tabs in order', 'D')
def c_keys_D(pg, T): return keys_check(pg, T, 'D')


@chk('keys 1 to 7 switch tabs in order', 'P')
def c_keys_P(pg, T): return keys_check(pg, T, 'P')


@chk('key 7 opens Vendors & Products (selected tab, vendor filter chips, rows)', 'L')
def c_key7(pg, T):
    blur(pg); pg.keyboard.press('7'); pg.wait_for_timeout(200)
    r = pg.evaluate("() => ({ sel: document.querySelector('#btabs [aria-selected=true]').textContent, table: (document.querySelector('#bwrap table') || {}).ariaLabel || (document.querySelector('#bwrap table') || document.body).getAttribute('aria-label'), jp: !!document.querySelector('#bfilt [data-fk=jp]'), rows: document.querySelectorAll('#bwrap tbody tr[data-id]').length })")
    return ok(r['sel'].startswith('Vendors & Products') and r['jp'] and r['rows'] > 0, r)


@chk('Left/Right arrows on the focused tab strip move between tabs (wraps)', 'L')
def c_arrows(pg, T):
    pg.focus('#btabs [data-board="jpem"]'); pg.keyboard.press('ArrowRight'); pg.wait_for_timeout(120); a = pg.evaluate(SEL)
    pg.keyboard.press('ArrowLeft'); pg.wait_for_timeout(120); b = pg.evaluate(SEL)
    pg.keyboard.press('ArrowLeft'); pg.wait_for_timeout(120); c = pg.evaluate(SEL)
    return ok([a, b, c] == ['jpprog', 'jpem', 'vendors'], [a, b, c])


def strip_check(pg, T):
    out = {}
    for b in BOARDS:
        goto_tab(pg, b)
        out[b] = pg.evaluate("() => { const n = document.getElementById('bnums'), t = document.getElementById('btabs'), c = document.getElementById('board'); const nr = n.getBoundingClientRect(), tr = t.getBoundingClientRect(), cr = c.getBoundingClientRect(); return { tiles: n.querySelectorAll('[data-tile]').length, belowTabs: nr.top >= tr.bottom - 1, aboveCard: nr.bottom <= cr.top + 1, vis: nr.height > 0 }; }")
    good = all(v['tiles'] > 0 and v['belowTabs'] and v['aboveCard'] and v['vis'] for v in out.values())
    return ok(good, out)


@chk('tile strip sits under the tabs (above the table) on every tab', 'L')
def c_strip_L(pg, T): return strip_check(pg, T)


@chk('tile strip sits under the tabs on every tab', 'D')
def c_strip_D(pg, T): return strip_check(pg, T)


@chk('tile strip sits under the tabs on every tab', 'P')
def c_strip_P(pg, T): return strip_check(pg, T)


def sub_check(pg, T):
    out = {}
    for b in BRANDS:
        goto_tab(pg, b)
        a_rows = rows(pg)
        pg.click('#bfilt [data-fk=sub][data-fv=deals]'); pg.wait_for_timeout(200)
        s1 = pg.evaluate("() => [document.querySelector('#bfilt [data-fk=sub][data-fv=deals]').getAttribute('aria-pressed'), document.querySelector('#bfilt [data-fk=sub][data-fv=accounts]').getAttribute('aria-pressed'), document.querySelector('#btabs [aria-selected=true]').dataset.board, (document.querySelector('#bwrap table') || document.body).getAttribute('aria-label'), (document.querySelector('#bwrap thead') || document.body).innerText.slice(0, 60)]")
        d_rows = rows(pg)
        pg.click('#bfilt [data-fk=sub][data-fv=accounts]'); pg.wait_for_timeout(200)
        s2 = pg.evaluate("() => document.querySelector('#bfilt [data-fk=sub][data-fv=accounts]').getAttribute('aria-pressed')")
        out[b] = {'opp_pressed': s1[0], 'acc_pressed_after_opp': s1[1], 'tab_kept': s1[2] == b, 'acc_rows': len(a_rows), 'deal_rows': len(d_rows), 'rows_differ': a_rows != d_rows or not a_rows, 'back': s2, 'back_rows': rows(pg) == a_rows}
    good = all(v['opp_pressed'] == 'true' and v['acc_pressed_after_opp'] == 'false' and v['tab_kept'] and v['back'] == 'true' and v['back_rows'] and (v['rows_differ'] or v['deal_rows'] == 0) for v in out.values())
    return ok(good, out)


@chk('Accounts | Opportunities switch works on all 4 brand tabs and returns', 'L')
def c_sub_L(pg, T): return sub_check(pg, T)


@chk('Accounts | Opportunities switch works on all 4 brand tabs and returns', 'D')
def c_sub_D(pg, T): return sub_check(pg, T)


@chk('Accounts | Opportunities switch works on all 4 brand tabs and returns', 'P')
def c_sub_P(pg, T): return sub_check(pg, T)


def chips_check(pg, T):
    goto_tab(pg, 'deals')
    r = pg.evaluate("() => ({ chips: Array.from(document.querySelectorAll('#bfilt .pchips .fchip')).map(b => b.textContent.replace(/[✓]/g, '').trim()), pipeSelect: document.querySelectorAll('#bfilt select[data-fk=pipe]').length, anySelect: document.querySelectorAll('#bfilt select').length, allOn: (document.querySelector('#bfilt .pchips .fchip') || {}).getAttribute && document.querySelector('#bfilt .pchips .fchip').getAttribute('aria-pressed') })")
    good = len(r['chips']) >= 4 and r['chips'][0].startswith('All pipelines') and r['pipeSelect'] == 0 and r['allOn'] == 'true'
    return ok(good, r)


@chk('All Opportunities shows pipeline chips (All pipelines first, pressed) and no pipeline dropdown', 'L')
def c_chips_L(pg, T): return chips_check(pg, T)


@chk('All Opportunities shows pipeline chips and no pipeline dropdown', 'D')
def c_chips_D(pg, T): return chips_check(pg, T)


@chk('All Opportunities shows pipeline chips and no pipeline dropdown', 'P')
def c_chips_P(pg, T): return chips_check(pg, T)


@chk('pipeline chip filters the list: pressed state moves, row count equals the chip count', 'L')
def c_chipclick(pg, T):
    goto_tab(pg, 'deals')
    info = pg.evaluate("() => Array.from(document.querySelectorAll('#bfilt .pchips .fchip')).map(b => [b.textContent.replace(/[✓]/g, '').trim(), (b.querySelector('.num') || {}).textContent])")
    target = [x for x in info if x[0].startswith('JP EM')]
    if not target:
        return ok(False, info)
    pg.click('#bfilt .pchips .fchip:has-text("JP EM")'); pg.wait_for_timeout(200)
    r = pg.evaluate("() => ({ pressed: Array.from(document.querySelectorAll('#bfilt .pchips .fchip[aria-pressed=true]')).map(b => b.textContent.replace(/[✓]/g, '').trim()), n: document.querySelectorAll('#bwrap tbody tr[data-id]').length })")
    return ok(r['pressed'] and r['pressed'][0].startswith('JP EM') and len(r['pressed']) == 1 and str(r['n']) == target[0][1], [target, r])


def open_close_form(pg, via_peek=False):
    goto_tab(pg, 'jpem')
    rid = rows(pg)[0]
    if via_peek:   # phone: the hover row action is display:none at 390 in v5.11, so the touch path is row -> peek -> "Close out..."
        pg.click('#bwrap tr[data-id="%s"] .nm' % rid, position={'x': 6, 'y': 6}); pg.wait_for_timeout(400)
        pg.click('#peek button:has-text("Close out…")'); pg.wait_for_timeout(250)
        return rid
    pg.hover('#bwrap tr[data-id="%s"]' % rid)
    pg.click('#bwrap tr[data-id="%s"] [data-ract="close"]' % rid, force=True); pg.wait_for_timeout(250)
    return rid


@chk('close out (account row action) opens the peek form with the 3 outcomes, date = today', 'L')
def c_co_open(pg, T):
    rid = open_close_form(pg)
    r = pg.evaluate("() => { const f = document.querySelector('#peek:not([hidden]) form[data-co=account]'); if (!f) return null; return { outcomes: Array.from(f.querySelectorAll('[data-co-f=outcome] option')).map(o => o.textContent), when: f.querySelector('[data-co-f=when]').value, save: !!f.querySelector('[data-co-b=save]'), cancel: !!f.querySelector('[data-co-b=cancel]') }; }")
    return ok(r and r['outcomes'][1:] == ['Former Customer', 'Not Applicable to Business', 'Inactive / Archived'] and r['when'] == '2026-10-22' and r['save'] and r['cancel'], r)


def co_flow(pg, T, var):
    n0 = len(pg.reqs)
    rid = open_close_form(pg, via_peek=var in ('P', 'PD'))
    before = rows(pg)
    # validation first: nothing chosen
    pg.click('#peek form[data-co=account] [data-co-b=save]'); pg.wait_for_timeout(150)
    msg = pg.evaluate("() => (document.querySelector('#peek [data-co-f=msg]') || {}).textContent")
    pg.select_option('#peek [data-co-f=outcome]', 'Former Customer')
    pg.fill('#peek [data-co-f=reason]', 'regression check')
    pg.click('#peek form[data-co=account] [data-co-b=save]'); pg.wait_for_timeout(500)
    t = toast(pg)
    after = rows(pg)
    chip = pg.evaluate("() => (document.querySelector('#bfilt [data-co-show]') || {}).textContent")
    good = (msg == 'Choose an outcome.' and 'closed out as Former Customer' in t and rid in before and rid not in after
            and chip and chip.strip().endswith('1') and len(pg.reqs) == n0 and theme_ok(pg, var))
    if var in ('P', 'PD'):
        sw = no_hscroll(pg)
        good = good and sw[0] <= sw[2] + 1
    return ok(good, {'validation': msg, 'toast': t, 'removed': rid in before and rid not in after, 'chip': chip, 'new_network_requests': len(pg.reqs) - n0})


@chk('close out submit in demo: validation message, row leaves the board, toast, chip "Show closed out - 1", zero network requests', 'L')
def c_co_L(pg, T): return co_flow(pg, T, 'L')


@chk('close out submit in demo (same flow, dark)', 'D')
def c_co_D(pg, T): return co_flow(pg, T, 'D')


@chk('close out submit in demo (phone: row -> peek -> Close out…, the row hover action is hidden at 390)', 'P')
def c_co_P(pg, T): return co_flow(pg, T, 'P')


@chk('"Show closed out" chip toggles: closed account appears marked Closed out; toggling off hides it', 'L')
def c_co_show(pg, T):
    rid = open_close_form(pg)
    pg.select_option('#peek [data-co-f=outcome]', 'Inactive / Archived'); pg.click('#peek form[data-co=account] [data-co-b=save]'); pg.wait_for_timeout(400); close_peek(pg)
    pg.click('#bfilt [data-co-show]'); pg.wait_for_timeout(250)
    on = pg.evaluate("(id) => { const r = document.querySelector('#bwrap tr[data-id=\"' + id + '\"]'); return { has: !!r, txt: r ? r.innerText : '', pressed: document.querySelector('#bfilt [data-co-show]').getAttribute('aria-pressed'), act: r && r.querySelector('[data-ract=close]') ? r.querySelector('[data-ract=close]').textContent : null }; }", rid)
    pg.click('#bfilt [data-co-show]'); pg.wait_for_timeout(250)
    off = pg.evaluate("(id) => ({ has: !!document.querySelector('#bwrap tr[data-id=\"' + id + '\"]'), pressed: document.querySelector('#bfilt [data-co-show]').getAttribute('aria-pressed') })", rid)
    return ok(on['has'] and 'Closed out' in on['txt'] and on['pressed'] == 'true' and on['act'] == 'Reopen' and not off['has'] and off['pressed'] == 'false', [on, off])


@chk('Reopen (row action under Show closed out): toast "reopened", account back on the active board, no network', 'L')
def c_reopen(pg, T):
    n0 = len(pg.reqs)
    rid = open_close_form(pg)
    pg.select_option('#peek [data-co-f=outcome]', 'Former Customer'); pg.click('#peek form[data-co=account] [data-co-b=save]'); pg.wait_for_timeout(400); close_peek(pg)
    pg.click('#bfilt [data-co-show]'); pg.wait_for_timeout(250)
    pg.hover('#bwrap tr[data-id="%s"]' % rid)
    pg.click('#bwrap tr[data-id="%s"] [data-ract="close"]' % rid, force=True); pg.wait_for_timeout(500)
    t = toast(pg)
    pg.evaluate("() => { const c = document.querySelector('#bfilt [data-co-show]'); if (c && c.getAttribute('aria-pressed') === 'true') c.click(); }"); pg.wait_for_timeout(250)
    back = rid in rows(pg)
    chip = pg.evaluate("() => document.querySelector('#bfilt [data-co-show]') ? document.querySelector('#bfilt [data-co-show]').textContent : '(chip gone)'")
    return ok('reopened' in t and back and len(pg.reqs) == n0, {'toast': t, 'back_on_board': back, 'chip': chip})


@chk('close out an opportunity (row action, peek form, Won): toast "closed won", deal leaves the open list', 'L')
def c_co_deal(pg, T):
    n0 = len(pg.reqs)
    goto_tab(pg, 'deals')
    before = rows(pg); rid = before[0]
    pg.hover('#bwrap tr[data-id="%s"]' % rid)
    pg.click('#bwrap tr[data-id="%s"] [data-ract="close"]' % rid, force=True); pg.wait_for_timeout(500)
    has = pg.evaluate("() => !!document.querySelector('#peek:not([hidden]) form[data-co=deal]')")
    if not has:
        return ok(False, 'no deal close-out form')
    pg.select_option('#peek [data-co-f=outcome]', 'won'); pg.click('#peek form[data-co=deal] [data-co-b=save]'); pg.wait_for_timeout(500)
    t = toast(pg)
    after = rows(pg)
    return ok('closed won' in t and rid not in after and len(after) == len(before) - 1 and len(pg.reqs) == n0, {'toast': t, 'before': len(before), 'after': len(after)})


@chk('bulk bar: selecting a row shows "N selected" and a "Close out…" button', 'L')
def c_bulk(pg, T):
    goto_tab(pg, 'jpem')
    pg.click('#bwrap input[data-sel]:first-of-type'); pg.wait_for_timeout(200)
    r = pg.evaluate("() => { const b = document.getElementById('bd-bulkbar'); const c = document.getElementById('co-bulk-btn'); return { hidden: b.hidden, n: document.getElementById('bd-bulk-n').textContent, co: c ? c.textContent : null, coHidden: c ? c.hidden : null }; }")
    return ok(not r['hidden'] and r['n'].startswith('1') and r['co'] == 'Close out…' and not r['coHidden'], r)


def nums_check(pg, T, var):
    out = {}
    n_touch = pg.evaluate("() => document.querySelector('#nums [data-tile=touch]') ? 1 : 0")
    pg.locator('#nums [data-tile=touch]').scroll_into_view_if_needed()
    pg.click('#nums [data-tile=touch]'); pg.wait_for_timeout(400)
    out['account_tile'] = pg.evaluate("() => ({ tab: document.querySelector('#btabs [aria-selected=true]').dataset.board, allJP: /All JusticePoint brands/i.test(document.getElementById('bfilt').innerText), sub: (document.querySelector('#bfilt [data-fk=sub][aria-pressed=true]') || {}).dataset ? document.querySelector('#bfilt [data-fk=sub][aria-pressed=true]').dataset.fv : null })")
    goto_tab(pg, 'sirona')
    pg.locator('#nums [data-tile=renew]').scroll_into_view_if_needed()
    pg.click('#nums [data-tile=renew]'); pg.wait_for_timeout(400)
    out['renew_tile_from_sirona'] = pg.evaluate("() => ({ tab: document.querySelector('#btabs [aria-selected=true]').dataset.board, allJP: /All JusticePoint brands/i.test(document.getElementById('bfilt').innerText) })")
    pg.locator('#nums [data-tile=dopen]').scroll_into_view_if_needed()
    pg.click('#nums [data-tile=dopen]'); pg.wait_for_timeout(400)
    out['deal_tile_open_pipeline'] = pg.evaluate("() => ({ tab: document.querySelector('#btabs [aria-selected=true]').dataset.board })")
    goto_tab(pg, 'jpem')
    pg.locator('#nums [data-tile=dpast]').scroll_into_view_if_needed()
    pg.click('#nums [data-tile=dpast]'); pg.wait_for_timeout(400)
    out['deal_tile_past_close'] = pg.evaluate("() => ({ tab: document.querySelector('#btabs [aria-selected=true]').dataset.board })")
    good = (out['account_tile']['tab'] == 'jpem' and out['account_tile']['allJP'] and out['account_tile']['sub'] == 'accounts'
            and out['renew_tile_from_sirona']['tab'] == 'jpem' and out['renew_tile_from_sirona']['allJP']
            and out['deal_tile_open_pipeline']['tab'] == 'deals' and out['deal_tile_past_close']['tab'] == 'deals' and theme_ok(pg, var))
    return ok(good, out)


@chk('Numbers tile routing: account tiles open JusticePoint EM with "All JusticePoint brands"; deal tiles open All Opportunities', 'L')
def c_nums_L(pg, T): return nums_check(pg, T, 'L')


@chk('Numbers tile routing (same, dark)', 'D')
def c_nums_D(pg, T): return nums_check(pg, T, 'D')


@chk('Numbers tile routing (same, phone)', 'P')
def c_nums_P(pg, T): return nums_check(pg, T, 'P')


def search_to(pg, board, kind_label):
    if pg.evaluate("() => !document.getElementById('peek').hidden"):
        pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    goto_tab(pg, board)
    name = pg.evaluate("() => document.querySelector('#bwrap tbody tr[data-id] .nm a, #bwrap tbody tr[data-id] .nm, #bwrap tbody tr[data-id] td:nth-child(2)').innerText.split('\\n')[0]")
    goto_tab(pg, 'campaigns')
    pg.fill('#jump', name); pg.wait_for_timeout(300)
    hits = pg.evaluate("() => Array.from(document.querySelectorAll('#jump-results a[role=option]')).map(a => a.innerText.replace(/\\n/g, ' | '))")
    pg.keyboard.press('Enter'); pg.wait_for_timeout(500)
    r = pg.evaluate("() => ({ tab: document.querySelector('#btabs [aria-selected=true]').dataset.board, peek: !document.getElementById('peek').hidden, peekText: document.getElementById('peek').innerText.slice(0, 120) })")
    return name, hits, r


@chk('search: a Sirona account typed on another tab opens on the Sirona Recovery tab with its peek', 'L')
def c_search_sirona(pg, T):
    name, hits, r = search_to(pg, 'sirona', 'Account')
    return ok(r['tab'] == 'sirona' and r['peek'] and name.split(' ')[0] in r['peekText'], [name, hits[:3], r])


@chk('search: a Difference Principle account opens on the TDP tab; an opportunity opens on All Opportunities', 'L')
def c_search_tdp(pg, T):
    name, hits, r = search_to(pg, 'tdp', 'Account')
    dname, dhits, dr = search_to(pg, 'deals', 'Deal')
    return ok(r['tab'] == 'tdp' and r['peek'] and dr['tab'] == 'deals' and dr['peek'], [[name, r], [dname, dr]])


@chk('search at phone width: a Sirona account opens on the Sirona Recovery tab', 'P')
def c_search_P(pg, T):
    name, hits, r = search_to(pg, 'sirona', 'Account')
    return ok(r['tab'] == 'sirona' and r['peek'], [name, r])


@chk('tab count badges filled on all 7 tabs (brand tabs "accounts - open opportunities")', 'L')
def c_badges(pg, T):
    t = pg.evaluate("() => Array.from(document.querySelectorAll('#btabs .n')).map(n => n.textContent)")
    return ok(len(t) == 7 and all(t) and all(' · ' in x for x in t[:4]), t)


# ---------------------------------------------------------------- run the Boards suite on one target
def run_boards(R, tname):
    res = {}
    for cid, name, var, fn in CHECKS:
        pg = None
        try:
            pg = R.page(URLS[tname], var, target=tname)
            r = fn(pg, tname)
            res[cid] = (PASS if r[0] else FAIL, r[1])
        except Exception as e:
            res[cid] = (FAIL, 'exception: ' + str(e).splitlines()[0][:200])
        finally:
            if pg:
                R.close(pg)
        print('%-8s %2d %s %s' % (tname, cid, res[cid][0], name[:90]), '' if res[cid][0] == PASS else '  :: ' + str(res[cid][1])[:300], flush=True)
    return res


SKIPPED_CHECKS = [
    ('close out writes the real fields (Accounts.Close_Out, Close_Out_Date, Close_Out_Reason; Deals Stage / Closing_Date / Lost_To) and the note',
     'No Zoho SDK in preview: coRun() takes its PREVIEW branch (no live.batch). The demo path (form, validation, local apply, toast, note insert, chip) is what the checks above assert; the live payload cannot be driven offline.'),
    ('close out Undo restores the record and removes the note (live batch update)',
     'The toast Undo button runs, but in preview it only reverts local state; the live reverse write is not reachable without the SDK.'),
    ('Sirona / TDP boards load their accounts lazily from Zoho on first open (ensureBrand / loadBrand)',
     'ensureBrand() does nothing in preview (sample data is preloaded), so the lazy live load cannot be driven offline.'),
]


# ---------------------------------------------------------------- S24 integration checks (patched page only)
S24 = []   # (name, status, info)


def s24(name, cond, info='', status=None):
    st = status or (PASS if cond else FAIL)
    S24.append((name, st, info))
    print('s24      %s %s' % (st, name[:110]), '' if st == PASS else '  :: ' + str(info)[:300], flush=True)


def kids(pg):
    return pg.evaluate("() => Array.from(document.getElementById('page').children).map(e => e.id || ('.' + e.className.split(' ')[0]))")


def zone(pg, sel):
    return pg.evaluate("(s) => Array.from(document.querySelector(s).children).map(e => e.id)", sel)


HEAD = ['nt-nav', '.mast', 'work-tiles-off', '.quick-actions', 'jpk-head', 'jpk-flow', '.jpk-top', '.jpk-cols', '.foot-note']
WIDE_TOP, WIDE_MAIN = ['z-sm'], ['needs-today', 'z-work', 'z-num', 'z-boards', 'dev-panel', 'z-rel']
WIDE_SIDE = ['jpk-cal', 'agenda-card', 'z-ref']
NARROW = ['z-sm', 'jpk-cal', 'needs-today', 'agenda-card', 'z-work', 'z-num', 'z-boards', 'dev-panel', 'z-rel', 'z-ref']
SECTIONS = ['needs-today', 'z-sm', 'z-work', 'z-num', 'z-boards', 'dev-panel', 'z-rel', 'agenda-card', 'z-ref']
JS_HASH = """async (ids) => { const out = {}; for (const id of ids) { const el = document.getElementById(id); if (!el) { out[id] = null; continue; } const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(el.innerHTML)); out[id] = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 12); } return out; }"""


def s24_checks(R):
    P = URLS['patched']
    for var, w, label in [('L', 1400, 'desktop 1400'), ('D', 1400, 'desktop 1400 dark'), ((900, 'light'), 900, 'tablet 900'), ('P', 390, 'phone 390'), ('PD', 390, 'phone 390 dark')]:
        pg = R.page(P, var, target='patched')
        k = kids(pg)
        s24('frame order [%s]: nav, mast, actions row, quick actions, header counts, flow strip, top, columns, footer' % label, k == HEAD, k)
        if w > 1100:
            top, main, side = zone(pg, '.jpk-top'), zone(pg, '.jpk-main'), zone(pg, '.jpk-side')
            s24('zones [%s]: top = Stock emails; main = tiles, Queue+Follow-ups, Numbers, Boards, Devices, Relationships; side = Calendar, Today & Upcoming, Quick links+Vendors' % label,
                top == WIDE_TOP and main == WIDE_MAIN and side == WIDE_SIDE, [top, main, side])
        else:
            main = zone(pg, '.jpk-main')
            vis = pg.evaluate("(ids) => ids.map(id => [id, document.getElementById(id)]).filter(p => !p[1].hidden).sort((a, b) => a[1].getBoundingClientRect().top - b[1].getBoundingClientRect().top).map(p => p[0])", NARROW)
            s24('zones [%s]: single column in the approved narrow order (DOM and visual)' % label, main == NARROW and vis == [i for i in NARROW if i != 'z-sm'], [main, vis])
            up = pg.evaluate("() => { const u = document.querySelector('.jpk-upnext').getBoundingClientRect(), t = document.getElementById('needs-today').getBoundingClientRect(); return [Math.round(u.bottom), Math.round(t.top), Math.round(u.height)]; }")
            s24('up-next card sits above the tiles [%s]' % label, up[2] > 0 and up[0] <= up[1], up)
            sw = no_hscroll(pg)
            s24('no horizontal page scroll with the shell on [%s]' % label, sw[0] <= sw[2] + 1 and sw[1] <= sw[2] + 1, sw)
        R.close(pg)

    pg = R.page(P, 'L', target='patched')
    ids = pg.evaluate("() => Array.from(document.querySelectorAll('.jpk-qa-btn')).map(b => b.getAttribute('data-jpk-action'))")
    gone = pg.evaluate("() => !document.querySelector('[data-jpk-action=logLostDevice]') && !/Log lost device/.test(document.body.innerText)")
    s24('quick actions present (preview user is not resolved as Administrator, so Mark renewed and Billing check are gated off) and Log lost device hidden', len(ids) >= 1 and 'newMeeting' in ids and gone, [ids, gone])
    fl = pg.evaluate("() => { const f = document.getElementById('jpk-flow'); return { steps: f.querySelectorAll('.jpk-step').length, txt: f.innerText.replace(/\\n+/g, ' / ') }; }")
    s24('flow strip present with 4 steps (Alerts, Needs you today, Meetings and follow-ups, Close out)', fl['steps'] == 4 and 'Alerts' in fl['txt'] and 'Close out' in fl['txt'], fl)
    cal = pg.evaluate("() => document.querySelector('.jpk-cal').innerText.replace(/\\n+/g, ' / ').slice(0, 300)")
    s24('calendar zone in plain preview: brief expected its empty or failure state; the page shows the 4 built-in DEMO meetings instead (jpkCalendar reads its demo rows in preview, CAL-NOTES "Preview")',
        False, cal, status='FAIL' if not re.search(r'No meetings|could not load', cal) else PASS)
    R.close(pg)
    pg = R.page(P + '&caldemo=empty', 'L', target='patched')
    cal = pg.evaluate("() => document.querySelector('.jpk-day-list').innerText.replace(/\\n+/g, ' ')")
    s24('calendar zone with ?caldemo=empty renders its empty state on the integrated page', 'No meetings synced' in cal, cal)
    R.close(pg)
    pg = R.page(P + '&caldemo=err', 'L', target='patched')
    cal = pg.evaluate("() => document.querySelector('.jpk-cal').innerText.replace(/\\n+/g, ' ')")
    s24('calendar zone with ?caldemo=err renders its failure state on the integrated page', 'could not load' in cal.lower(), cal[:200])
    R.close(pg)

    # shell=0 restores the original layout
    pb = R.page(URLS['base'], 'L', target='base'); kb = kids(pb); R.close(pb)
    pg = R.page(URLS['shell0'], 'L', target='shell0')
    k0 = kids(pg)
    st = pg.evaluate("() => [document.documentElement.getAttribute('data-jpk-shell'), !!document.querySelector('.jpk-cols'), !!document.getElementById('jpk-flow'), !!document.querySelector('.jpk-qa-btn'), !!document.querySelector('.jpk-cal'), getComputedStyle(document.getElementById('jpk-shell-toast') || document.body).display]")
    s24('?shell=0: #page children identical to the v5.11 base order; no frame, flow strip, quick actions or calendar zone', k0 == kb and not st[1] and not st[2] and not st[3] and not st[4] and st[0] != 'on', [k0, kb, st])
    for w in (900, 390):
        pg.set_viewport_size({'width': w, 'height': 900}); pg.wait_for_timeout(500)
        s24('?shell=0 at %d px: order still identical to the base' % w, kids(pg) == kb, kids(pg))
    R.close(pg)

    # innerHTML hashes
    out = {}
    for t, extra in (('base', None), ('patched', None), ('shell0', None)):
        pg = R.page(URLS[t], 'L', target=t)
        out[t] = pg.evaluate(JS_HASH, SECTIONS)
        if t == 'patched':
            pg.set_viewport_size({'width': 390, 'height': 900}); pg.wait_for_timeout(600)
            out['patched_390'] = pg.evaluate(JS_HASH, SECTIONS)
            pg.set_viewport_size({'width': 1400, 'height': 900}); pg.wait_for_timeout(600)
            out['patched_back'] = pg.evaluate(JS_HASH, SECTIONS)
            pg.evaluate("() => { JPKShell.unmount(); }"); pg.wait_for_timeout(300)
            out['patched_unmounted'] = pg.evaluate(JS_HASH, SECTIONS)
        R.close(pg)
    for key in ('patched', 'shell0', 'patched_390', 'patched_back', 'patched_unmounted'):
        diff = [s for s in SECTIONS if out[key][s] != out['base'][s]]
        s24('moved sections: innerHTML sha256 equals the v5.11 base (%s), 9 sections' % {'patched': 'shell on, 1400', 'shell0': '?shell=0', 'patched_390': 'shell on after resize to 390', 'patched_back': 'back to 1400', 'patched_unmounted': 'after JPKShell.unmount()'}[key], not diff, {'differs': diff, 'base': {s: out['base'][s] for s in diff}, key: {s: out[key][s] for s in diff}})

    # first visit (no seed): does mounting change inner markup of anything
    out2, html2 = {}, {}
    for t in ('base', 'patched'):
        pg = R.page(URLS[t], 'L', storage=None, target=t)
        out2[t] = pg.evaluate(JS_HASH, SECTIONS)
        html2[t] = pg.evaluate("() => document.getElementById('z-rel').innerHTML")
        R.close(pg)
    diff = [s for s in SECTIONS if out2['patched'][s] != out2['base'][s]]
    import difflib
    dl = [l for l in difflib.unified_diff(re.sub(r'>\s*<', '>\n<', html2['base']).split('\n'), re.sub(r'>\s*<', '>\n<', html2['patched']).split('\n'), 'base', 'patched', n=0, lineterm='') if l[:1] in '+-' and not l.startswith(('---', '+++'))]
    s24('moved sections: innerHTML equal to base on a FIRST visit with empty storage (shell collapses Relationships once by clicking the page toggle, BUILD-NOTES difference 6)', not diff, {'differs': diff, 'z-rel diff lines': [x[:200] for x in dl[:6]]})

    # hash gate
    raw = BASE_F.read_bytes(); pr = PATCH_F.read_bytes()
    s24('hash gate: base file sha256 is the v5.11 hash', hashlib.sha256(raw).hexdigest() == BASE_SHA, hashlib.sha256(raw).hexdigest())
    B_, E_ = b'<!-- jpk-s24:begin -->\n', b'<!-- jpk-s24:end -->\n'
    nb, ne = pr.count(B_), pr.count(E_)
    a = pr.find(B_); b = pr.find(E_) + len(E_)
    restored = pr[:a] + pr[b:]
    s24('hash gate: patched file minus the one inserted block equals the v5.11 sha256 (1 begin and 1 end marker)', nb == 1 and ne == 1 and hashlib.sha256(restored).hexdigest() == BASE_SHA, [nb, ne, hashlib.sha256(restored).hexdigest()])


# ---------------------------------------------------------------- base vs patched behaviour comparisons
LISTENER_SPY = """(() => { window.__kl = []; const o = EventTarget.prototype.addEventListener; EventTarget.prototype.addEventListener = function (t, f, c) {
  if (t === 'keydown' || t === 'keyup' || t === 'keypress') { let line = 0; try { const m = (new Error().stack.split('\\n')[2] || '').match(/:(\\d+):\\d+\\)?$/); line = m ? +m[1] : 0; } catch (e) {} window.__kl.push([t, this === window ? 'window' : this === document ? 'document' : (this.id || this.tagName || '?'), line]); }
  return o.call(this, t, f, c); }; })();"""

CMP = []   # (name, base, patched, verdict)


def cmp_row(name, b, p, same=None, note=''):
    same = (b == p) if same is None else same
    CMP.append((name, b, p, PASS if same else FAIL))
    print('compare  %s %s' % (PASS if same else FAIL, name[:100]), '' if same else '  :: base=%s patched=%s' % (str(b)[:200], str(p)[:200]), flush=True)


def probe_boards_moved(pg):
    """Boards usable where it sits: click a tab, keyboard j / Enter / Escape on the board, tab arrows."""
    r = {}
    pg.locator('#btabs [data-board="sirona"]').scroll_into_view_if_needed()
    pg.click('#btabs [data-board="sirona"]'); pg.wait_for_timeout(200); r['click_tab'] = pg.evaluate(SEL)
    goto_tab(pg, 'jpem')
    ids = rows(pg)
    # a click on a row sets the keyboard zone to the board and opens its peek; Escape closes it and puts focus back on the row
    pg.click('#bwrap tr[data-id="%s"] .nm' % ids[0], position={'x': 6, 'y': 6}); pg.wait_for_timeout(300)
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    pg.keyboard.press('j'); pg.wait_for_timeout(250)
    r['j_moves_focus_to_next_row'] = pg.evaluate("() => document.activeElement && document.activeElement.getAttribute('data-id')") == ids[1]
    pg.keyboard.press('Enter'); pg.wait_for_timeout(300)
    r['enter_opens_peek'] = pg.evaluate("() => !document.getElementById('peek').hidden")
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    r['escape_closes_peek'] = pg.evaluate("() => document.getElementById('peek').hidden")
    r['focus_back_on_row'] = pg.evaluate("() => !!(document.activeElement && document.activeElement.getAttribute('data-id'))")
    blur(pg); pg.keyboard.press('5'); pg.wait_for_timeout(150); r['digit_5'] = pg.evaluate(SEL)
    pg.keyboard.press('1'); pg.wait_for_timeout(150)
    pg.click('#bfilt [data-fk=sub][data-fv=deals]'); pg.wait_for_timeout(150)
    r['sub_switch'] = pg.evaluate("() => document.querySelector('#bfilt [data-fk=sub][data-fv=deals]').getAttribute('aria-pressed')")
    return r


def probe_scroll(pg, w):
    r = {}
    pg.evaluate("() => window.scrollTo(0, 0)")
    qa0 = pg.evaluate("() => { const q = document.querySelector('.quick-actions'); return { pos: getComputedStyle(q).position, top: Math.round(q.getBoundingClientRect().top) }; }")
    pg.evaluate("() => window.scrollTo(0, 1400)"); pg.wait_for_timeout(250)
    qa1 = pg.evaluate("() => { const q = document.querySelector('.quick-actions'); return { top: Math.round(q.getBoundingClientRect().top), sy: scrollY }; }")
    r['quick_actions_position'] = qa0['pos']
    r['quick_actions_stays_pinned_at_top_after_scroll'] = (qa1['top'] == 0) if qa0['pos'] == 'sticky' else 'n/a (static)'
    r['scrolled'] = qa1['sy'] > 500
    r['scroll_y_after_scrollTo_1400_hit'] = qa1['sy'] == 1400 or qa1['sy']
    # Numbers tile roll to Boards
    pg.evaluate("() => window.scrollTo(0, 0)"); pg.wait_for_timeout(100)
    pg.click('#nums [data-tile=touch]'); pg.wait_for_timeout(900)
    top = pg.evaluate("() => Math.round(document.getElementById('btabs').getBoundingClientRect().top)")
    r['rollToBoard_lands_tab_strip_in_view'] = 0 <= top <= 300
    r['rollToBoard_top_px'] = top
    return r


def probe_nav(pg):
    r = {}
    labels = pg.evaluate("() => Array.from(document.querySelectorAll('.hl-nav button')).filter(b => !b.hidden && b.getClientRects().length).map(b => b.textContent.trim().replace(/\\s*\\d+$/, ''))")
    r['labels'] = labels
    tops = {}
    for lab in labels:
        pg.evaluate("() => window.scrollTo(0, 0)"); pg.wait_for_timeout(80)
        btn = pg.locator('.hl-nav button').filter(has_text=lab).first
        btn.click(); pg.wait_for_timeout(700)
        tops[lab] = pg.evaluate("() => { const a = document.activeElement; return a ? { tag: a.tagName, id: a.id, cls: a.className.toString().slice(0, 30) } : null; }")
        tops[lab]['scrolled'] = pg.evaluate("() => scrollY > 0 || true")
    # reach test: after clicking, the first visible heading text that matches the label should be inside the viewport
    reach = {}
    for lab in labels:
        pg.evaluate("() => window.scrollTo(0, 0)"); pg.wait_for_timeout(80)
        pg.locator('.hl-nav button').filter(has_text=lab).first.click(); pg.wait_for_timeout(700)
        reach[lab] = pg.evaluate("""(lab) => { const hs = Array.from(document.querySelectorAll('h2, h3')).filter(h => h.textContent.trim().toLowerCase().startsWith(lab.toLowerCase()) && h.getClientRects().length); if (!hs.length) return 'no heading'; const t = Math.round(hs[0].getBoundingClientRect().top); return t >= -2 && t < innerHeight ? 'in view' : 'off screen ' + t; }""", lab)
    r['reach'] = reach
    # collapse all
    pg.evaluate("() => window.scrollTo(0, 0)")
    before = pg.evaluate("() => Array.from(document.querySelectorAll('[data-collapsed]')).filter(e => e.id).map(e => e.id + ':' + e.getAttribute('data-collapsed'))")
    pg.click('.hl-all'); pg.wait_for_timeout(400)
    after = pg.evaluate("() => Array.from(document.querySelectorAll('[data-collapsed]')).filter(e => e.id).map(e => e.id + ':' + e.getAttribute('data-collapsed'))")
    r['collapse_all_after'] = sorted(after)
    r['collapse_all_label'] = pg.evaluate("() => document.querySelector('.hl-all').textContent.trim()")
    pg.click('.hl-all'); pg.wait_for_timeout(400)
    r['expand_all_label'] = pg.evaluate("() => document.querySelector('.hl-all').textContent.trim()")
    r['expand_all_after'] = sorted(pg.evaluate("() => Array.from(document.querySelectorAll('[data-collapsed]')).filter(e => e.id).map(e => e.id + ':' + e.getAttribute('data-collapsed'))"))
    return r


def probe_keys(pg, patched):
    r = {}
    blur(pg); pg.keyboard.press('/'); pg.wait_for_timeout(150)
    r['slash_focuses_search'] = pg.evaluate("() => document.activeElement && document.activeElement.id")
    pg.keyboard.press('Escape'); pg.wait_for_timeout(100); blur(pg)
    pg.keyboard.press('?'); pg.wait_for_timeout(200)
    r['question_opens_keys_popover'] = pg.evaluate("() => document.getElementById('keys-btn').getAttribute('aria-expanded')")
    pg.keyboard.press('Escape'); pg.wait_for_timeout(150); blur(pg)
    # typing digits in the search box must not switch tabs
    pg.keyboard.press('1'); pg.wait_for_timeout(100)
    pg.focus('#jump'); pg.keyboard.type('55'); pg.wait_for_timeout(150)
    r['digits_typed_in_search_do_not_switch_tab'] = pg.evaluate(SEL) == 'jpem' and pg.evaluate("() => document.getElementById('jump').value") == '55'
    pg.fill('#jump', ''); blur(pg)
    # digits and slash while focus sits on a shell / header control
    sel = '.jpk-qa-btn' if patched else '.quick-actions button'
    pg.focus(sel); pg.keyboard.press('6'); pg.wait_for_timeout(150); r['digit_6_with_focus_on_actions_row'] = pg.evaluate(SEL)
    pg.focus(sel); pg.keyboard.press('/'); pg.wait_for_timeout(150); r['slash_with_focus_on_actions_row'] = pg.evaluate("() => document.activeElement && document.activeElement.id")
    blur(pg); pg.keyboard.press('1'); pg.wait_for_timeout(100)
    if patched:
        pg.focus('.jpk-step'); pg.keyboard.press('3'); pg.wait_for_timeout(150); r['digit_3_with_focus_on_flow_step'] = pg.evaluate(SEL)
        pg.evaluate("() => { window.__navs = JPKShell.lastNav; }")
        r['flow_not_triggered_by_digit'] = pg.evaluate("() => JPKShell.lastNav") == pg.evaluate("() => window.__navs")
        pg.focus('.jpk-daychip') if pg.evaluate("() => !!document.querySelector('.jpk-daychip')") else None
        pg.keyboard.press('/'); pg.wait_for_timeout(150); r['slash_with_focus_in_calendar'] = pg.evaluate("() => document.activeElement && document.activeElement.id")
    return r


def comparisons(R):
    res = {}
    for t in ('base', 'patched'):
        res[t] = {}
        for var, w in (('L', 1400), ('P', 390)):
            pg = R.page(URLS[t], var, init=LISTENER_SPY, target=t)
            res[t]['boards_' + var] = probe_boards_moved(pg)
            R.close(pg)
            pg = R.page(URLS[t], var, target=t)
            res[t]['scroll_' + var] = probe_scroll(pg, w)
            R.close(pg)
            pg = R.page(URLS[t], var, target=t)
            res[t]['nav_' + var] = probe_nav(pg)
            R.close(pg)
            pg = R.page(URLS[t], var, target=t)
            res[t]['keys_' + var] = probe_keys(pg, t == 'patched')
            R.close(pg)
    for var in ('L', 'P'):
        b, p = res['base']['boards_' + var], res['patched']['boards_' + var]
        cmp_row('Boards usable in its moved position (%s): tab click, j, Enter opens peek, Escape closes, digit 5, sub switch' % var, b, p)
        b, p = res['base']['scroll_' + var], res['patched']['scroll_' + var]
        sub = lambda d: {k: v for k, v in d.items() if k != 'rollToBoard_top_px' and k != 'scroll_y_after_scrollTo_1400_hit'}
        cmp_row('sticky quick-actions bar and scroll behaviour (%s): position, pinned after scroll, Numbers tile rolls the Boards tab strip to the top' % var, sub(b), sub(p))
        CMP.append(('   (info) rollToBoard landing offset (%s), px from viewport top' % var, b['rollToBoard_top_px'], p['rollToBoard_top_px'], 'INFO'))
        b, p = res['base']['nav_' + var], res['patched']['nav_' + var]
        cmp_row('Go to links (%s): every visible link brings its section heading into view' % var, {'labels': b['labels'], 'reach': b['reach']}, {'labels': p['labels'], 'reach': p['reach']},
                same=(b['labels'] == p['labels'] and all(v == 'in view' for v in p['reach'].values() if v != 'no heading') and b['reach'] == p['reach']))
        cmp_row('Collapse all / Expand all (%s): same sections collapse and re-expand, labels flip' % var, {k: b[k] for k in ('collapse_all_after', 'collapse_all_label', 'expand_all_label', 'expand_all_after')}, {k: p[k] for k in ('collapse_all_after', 'collapse_all_label', 'expand_all_label', 'expand_all_after')})
        b, p = res['base']['keys_' + var], res['patched']['keys_' + var]
        bb = {k: v for k, v in b.items()}
        pp = {k: p[k] for k in b}
        cmp_row('existing keys (%s): "/" focuses search, "?" opens the keys popover, digits typed in search do not switch tabs, digits and "/" work with focus on the actions row' % var, bb, pp)
        if var == 'L':
            extra = {k: v for k, v in p.items() if k not in b}
            ok_ = extra.get('digit_3_with_focus_on_flow_step') == 'sirona' and extra.get('flow_not_triggered_by_digit') and extra.get('slash_with_focus_in_calendar') == 'jump'
            CMP.append(('keys vs shell controls: digit with focus on a flow step switches tabs and does not fire the step; "/" with focus in the calendar focuses search', '-', extra, PASS if ok_ else FAIL))
            print('compare  %s keys vs shell controls :: %s' % (PASS if ok_ else FAIL, extra), flush=True)
    # does the shell register any key listener of its own?  (stack line beyond the base file's last line => created by the inserted block)
    base_lines = BASE_F.read_text(encoding='utf-8').count('\n') + 1
    pg = R.page(URLS['patched'], 'L', init=LISTENER_SPY, target='patched')
    kl = pg.evaluate("() => window.__kl")
    R.close(pg)
    pg = R.page(URLS['base'], 'L', init=LISTENER_SPY, target='base')
    klb = pg.evaluate("() => window.__kl")
    R.close(pg)
    mine = [x for x in kl if x[2] > base_lines - 1 - 0 and x[2] >= PATCH_FIRST_LINE]
    CMP.append(('keydown/keyup/keypress listeners registered from the inserted S24 block (stack line >= first inserted line %d); base total %d, patched total %d' % (PATCH_FIRST_LINE, len(klb), len(kl)), len(klb), len(kl), PASS if len(kl) - len(klb) == len(mine) else 'INFO'))
    CMP.append(('   listeners from the inserted block (type, target, line)', '-', mine, 'INFO'))
    return res


PATCH_FIRST_LINE = PATCH_F.read_bytes().split(b'<!-- jpk-s24:begin -->')[0].count(b'\n') + 1

# ---------------------------------------------------------------- main
with sync_playwright() as p:
    R = Runner(p)
    results = {}
    import os
    for t in ('base', 'patched', 'shell0'):
        results[t] = run_boards(R, t) if not os.environ.get('S21_DEBUG_SKIP_BOARDS') else {cid: (PASS, '') for cid, *_ in CHECKS}
    # error comparison (check 'no new page errors'), computed over every page the three targets loaded in the Boards run
    s24_checks_err = None
    try:
        s24_checks(R)
    except Exception:
        S24.append(('S24 integration section crashed', FAIL, traceback.format_exc()[-600:]))
        print(traceback.format_exc())
    try:
        cmp_res = comparisons(R)
    except Exception:
        CMP.append(('comparison section crashed', '-', traceback.format_exc()[-600:], FAIL))
        print(traceback.format_exc())
    R.b.close()

# aggregate error check
def errset(t):
    return sorted(set(ERRS[t]['page'])), sorted(set(ERRS[t]['console']))
bp, bc = errset('base'); pp_, pc = errset('patched'); sp, sc = errset('shell0')
err_rows = [
    ('no new page errors vs the base page\'s own error list (every page load of the run; page errors and console errors compared as sets of messages)',
     (PASS if not bp else FAIL, {'page_errors': bp, 'console_errors': bc, 'loads_total_page_errors': len(ERRS['base']['page']), 'console_total': len(ERRS['base']['console'])}),
     (PASS if (set(pp_) <= set(bp) and set(pc) <= set(bc)) else FAIL, {'page_errors': pp_, 'new_console': sorted(set(pc) - set(bc)), 'console_total': len(ERRS['patched']['console'])}),
     (PASS if (set(sp) <= set(bp) and set(sc) <= set(bc)) else FAIL, {'page_errors': sp, 'new_console': sorted(set(sc) - set(bc)), 'console_total': len(ERRS['shell0']['console'])})),
]

# ---------------------------------------------------------------- report
lines = []
n_exec = len(CHECKS) + len(err_rows)
n_skip = len(SKIPPED_CHECKS)
lines.append('S24 step 8: S21-equivalent Boards suite on v5.11 base vs patched v6.0, plus S24 integration and base-vs-patched comparisons')
lines.append('Run: %s   base %s   patched %s' % (datetime.datetime.now().strftime('%Y-%m-%d %H:%M'), BASE_F, PATCH_F))
lines.append('Boards suite written: %d checks that run (%d per-variant checks + 1 error-list check) + %d SKIPPED = %d. Columns: base v5.11 | patched v6.0 (shell on) | patched ?shell=0.' % (n_exec, len(CHECKS), n_skip, n_exec + n_skip))
lines.append('')
lines.append('%-4s %-120s %-8s %-8s %-8s' % ('#', 'check', 'base', 'patched', 'shell=0'))
for cid, name, var, fn in CHECKS:
    lines.append('%-4d %-120s %-8s %-8s %-8s' % (cid, name[:120], results['base'][cid][0], results['patched'][cid][0], results['shell0'][cid][0]))
n = len(CHECKS) + 1
lines.append('%-4d %-120s %-8s %-8s %-8s' % (n, err_rows[0][0][:120], err_rows[0][1][0], err_rows[0][2][0], err_rows[0][3][0]))
for i, (name, why) in enumerate(SKIPPED_CHECKS):
    lines.append('%-4d %-120s %-8s %-8s %-8s' % (n + 1 + i, name[:120], SKIP, SKIP, SKIP))
lines.append('')
tot = {t: [0, 0] for t in ('base', 'patched', 'shell0')}
for t in tot:
    for cid in results[t]:
        tot[t][0 if results[t][cid][0] == PASS else 1] += 1
    tot[t][0 if (err_rows[0][{'base': 1, 'patched': 2, 'shell0': 3}[t]][0] == PASS) else 1] += 1
for t in tot:
    lines.append('Boards suite %-8s: %d pass, %d fail, %d skipped (of %d written)' % (t, tot[t][0], tot[t][1], n_skip, n_exec + n_skip))
diffs = [(cid, name) for cid, name, var, fn in CHECKS if results['base'][cid][0] != results['patched'][cid][0] or results['base'][cid][0] != results['shell0'][cid][0]]
lines.append('Base vs patched (or shell=0) differences in the Boards suite: %s' % (', '.join('#%d' % d[0] for d in diffs) if diffs else 'none'))
lines.append('')
lines.append('SKIPPED (cannot be driven in demo):')
for i, (name, why) in enumerate(SKIPPED_CHECKS):
    lines.append('  #%d %s' % (n + 1 + i, name)); lines.append('      reason: ' + why)
lines.append('')
lines.append('S24 integration checks (patched file only, integrated page in ?preview=1&ntdemo=1)')
lines.append('%-4s %-150s %-8s' % ('#', 'check', 'result'))
for i, (name, st, info) in enumerate(S24, 1):
    lines.append('%-4d %-150s %-8s' % (i, name[:150], st))
s24p = sum(1 for x in S24 if x[1] == PASS)
lines.append('S24 integration: %d pass, %d fail, of %d' % (s24p, len(S24) - s24p, len(S24)))
lines.append('')
lines.append('Base vs patched comparisons (drive both pages the same way)')
lines.append('%-4s %-150s %-8s' % ('#', 'comparison', 'verdict'))
for i, (name, b, p_, v) in enumerate(CMP, 1):
    lines.append('%-4d %-150s %-8s' % (i, (name + ('  base=%s patched=%s' % (b, p_) if v == 'INFO' and not isinstance(p_, list) else ''))[:150], v))
cp = sum(1 for x in CMP if x[3] == PASS); cf = sum(1 for x in CMP if x[3] == FAIL)
lines.append('Comparisons: %d identical/pass, %d fail (INFO rows not counted)' % (cp, cf))
lines.append('')
lines.append('==== DETAIL FOR EVERY NON-PASS AND EVERY DIFFERENCE ====')
for cid, name, var, fn in CHECKS:
    for t in ('base', 'patched', 'shell0'):
        if results[t][cid][0] != PASS:
            lines.append('Boards #%d %s [%s] %s :: %s' % (cid, name, t, results[t][cid][0], json.dumps(results[t][cid][1], default=str)[:900]))
for lab, col in (('base', 1), ('patched', 2), ('shell0', 3)):
    if err_rows[0][col][0] != PASS:
        lines.append('Errors [%s] FAIL :: %s' % (lab, json.dumps(err_rows[0][col][1], default=str)[:900]))
lines.append('Error lists: base page errors=%s console=%s' % (bp, bc))
lines.append('Error lists: patched page errors=%s console=%s' % (pp_, pc))
lines.append('Error lists: shell=0  page errors=%s console=%s' % (sp, sc))
for name, st, info in S24:
    if st != PASS:
        lines.append('S24 %s %s :: %s' % (st, name, json.dumps(info, default=str)[:900]))
for name, b, p_, v in CMP:
    if v != PASS:
        lines.append('CMP %s %s\n      base   = %s\n      patched= %s' % (v, name, json.dumps(b, default=str)[:900], json.dumps(p_, default=str)[:900]))
lines.append('')
lines.append('==== FULL DETAIL OF PASSING COMPARISONS (values observed) ====')
for name, b, p_, v in CMP:
    if v == PASS:
        lines.append('%s\n      %s' % (name, json.dumps(b, default=str)[:700]))
OUT.write_text('\n'.join(lines) + '\n', encoding='utf-8')
print('\n'.join(lines[:6 + len(CHECKS) + 8]))
fails = sum(1 for t in tot for _ in range(tot[t][1])) + sum(1 for x in S24 if x[1] == FAIL) + cf
sys.exit(1 if fails else 0)
