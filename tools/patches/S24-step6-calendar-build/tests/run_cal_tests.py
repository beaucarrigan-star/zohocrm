"""S24 step 6 calendar tests (Playwright, Chromium). Usage: python3 -I run_cal_tests.py <build dir>
Pages: demo-cal.html (demo.html + jpk-calendar) with tests/mock-zoho.js standing in for the Zoho SDK, and tmp-real/widget-cal.html
(the real v5.11 widget + shell + calendar) in ?preview=1. Every non-file request is aborted: no live calls, no network.
Clock: 22 Oct 2026 10:00 America/Chicago unless a test says otherwise. Prints PASS/FAIL per check and writes tests/last-run-cal.txt."""
import sys, json, pathlib, re, datetime, traceback
from playwright.sync_api import sync_playwright

B = pathlib.Path(sys.argv[1]).resolve()
DEMO = (B / 'demo-cal.html').as_uri()
REAL = (B / 'tmp-real' / 'widget-cal.html').as_uri()
MOCK_JS = str(B / 'tests' / 'mock-zoho.js')
SHOTS = B / 'shots'; SHOTS.mkdir(exist_ok=True)
NOW = '2026-10-22T10:00:00-05:00'
ME, OTHER = '6715134000000503001', '6715134000000999999'
TEST_ID, PAT, LEE, DANE, POLK = '6715134000009801001', '6715134000002592199', '6715134000002592200', '6715134000000700002', '6715134000000700007'
PASSCODE, MEETING_ID = 'Xy9Kq2', '245 813 667 019'
results = []

def check(name, ok, info=''):
    results.append((name, bool(ok), info))
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else '  :: ' + str(info)[:500]), flush=True)

TEAMS_URL = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_TESTabc%40thread.v2/0?context=%7b%22Tid%22%3a%22t1%22%7d'
DESC = ('________________________________________________________________________________\nMicrosoft Teams meeting\n'
        'Join on your computer, mobile app or room device\nClick here to join the meeting<' + TEAMS_URL + '>\n'
        'Meeting ID: ' + MEETING_ID + '\nPasscode: ' + PASSCODE + '\n'
        'Download Teams<https://www.microsoft.com/en-us/microsoft-teams/download-app> | Join on the web<https://www.microsoft.com/microsoft-teams/join-a-meeting>\n'
        'Learn More<https://aka.ms/JoinTeamsMeeting> | Meeting options<https://teams.microsoft.com/meetingOptions/?organizerId=abc&tenantId=t1&threadId=19_meeting_TESTabc@thread.v2&messageId=0&language=en-US>\n')
ZOOM_URL = 'https://us02web.zoom.us/j/84512345678?pwd=QWERTY.1'

def ev(i, title, s, e, **o):
    r = {'id': i, 'Event_Title': title, 'Start_DateTime': s, 'End_DateTime': e, 'All_day': False, 'Venue': '', 'Description': '', 'What_Id': None, 'Who_Id': None,
         'Owner': {'id': ME, 'name': 'Beau Carrigan', 'email': 'beau@example.org'}, 'Recurring_Activity': None}
    r.update(o); return r

def fixture():
    return {
        'me': ME,
        'events': [
            ev(TEST_ID, 'TEST – CS Home calendar', '2026-10-22T10:25:00-05:00', '2026-10-22T10:55:00-05:00', Venue='Microsoft Teams Meeting', Description=DESC),
            ev('6715134000010000101', 'Late call with Anchorage', '2026-10-23T03:30:00+00:00', '2026-10-23T04:00:00+00:00'),
            ev('6715134000010000102', 'Just before midnight', '2026-10-22T23:59:00-05:00', '2026-10-23T00:15:00-05:00'),
            ev('6715134000010000103', 'Just after midnight', '2026-10-23T00:00:00-05:00', '2026-10-23T00:30:00-05:00'),
            ev('6715134000010000104', 'Training day', '2026-10-23T00:00:00-05:00', '2026-10-23T23:59:00-05:00', All_day=True),
            ev('6715134000010000105', 'Zoom renewal call', '2026-10-24T14:00:00-05:00', '2026-10-24T14:30:00-05:00', Venue='Zoom', Description='Join Zoom Meeting\n' + ZOOM_URL + '\nMeeting ID: 845 1234 5678\nPasscode: 559201'),
            ev('6715134000010000106', 'Canceled: Vendor demo', '2026-10-22T15:00:00-05:00', '2026-10-22T15:30:00-05:00'),
            ev('6715134000010000107', 'Someone else meeting', '2026-10-22T11:00:00-05:00', '2026-10-22T11:30:00-05:00', Owner={'id': OTHER, 'name': 'Joe'}),
            ev('6715134000010000108', 'Dane County quarterly review', '2026-10-23T09:00:00-05:00', '2026-10-23T10:00:00-05:00', What_Id={'id': DANE}, Who_Id={'id': PAT}),
            ev('6715134000010000109', 'Annual audit walk-through', '2026-10-25T13:00:00-05:00', '2026-10-25T14:00:00-05:00', Recurring_Activity={'RRULE': 'FREQ=YEARLY;INTERVAL=1'}),
            ev('6715134000010000110', 'Dane County: GPS spare review', '2026-10-22T13:00:00-05:00', '2026-10-22T13:30:00-05:00', Venue='Microsoft Teams Meeting',
               Description='Join: https://teams.microsoft.com/meet/29483756123?p=Tok3nNotTheCode'),
            ev('6715134000010000111', 'Deal review', '2026-10-27T10:00:00-05:00', '2026-10-27T10:30:00-05:00', What_Id={'id': '6715134000000880001'}),
            ev('6715134000010000112', 'Google Meet with vendor', '2026-10-28T11:00:00-05:00', '2026-10-28T11:30:00-05:00', Description='Video call link: https://meet.google.com/abc-defg-hij'),
            ev('6715134000010000113', 'Two days out of office', '2026-10-26T00:00:00-05:00', '2026-10-28T00:00:00-05:00', All_day=True),
        ],
        'masters': [ev('6715134000010000120', 'EM ops stand-up', '2026-10-01T08:30:00-05:00', '2026-10-01T08:45:00-05:00', Venue='Microsoft Teams Meeting',
                       Recurring_Activity={'RRULE': 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TH;DTSTART=2026-10-01'})],
        'accounts': [{'id': DANE, 'Account_Name': 'Dane County'}, {'id': POLK, 'Account_Name': 'Polk County'}, {'id': '6715134000000700001', 'Account_Name': 'Linn County Sheriff'}],
        'contacts': [{'id': PAT, 'Full_Name': 'Pat Moreno', 'Email': 'pmoreno@example.org', 'Account_Name': {'id': DANE}},
                     {'id': LEE, 'Full_Name': 'Lee Okafor', 'Email': 'lokafor@polk.example', 'Account_Name': {'id': POLK}}],
        'participants': {
            TEST_ID: [{'Email': 'beau@example.org', 'name': 'Beau Carrigan', 'id': 'p1', 'type': 'user', 'participant': ME},
                      {'Email': 'pmoreno@example.org', 'name': 'Pat Moreno', 'id': 'p2', 'type': 'contact', 'participant': PAT},
                      {'Email': 'guest@example.com', 'name': 'guest@example.com', 'id': 'p3', 'type': 'email', 'participant': 'guest@example.com'}],
            '6715134000010000110': [{'Email': 'pmoreno@example.org', 'name': 'Pat Moreno', 'id': 'p4', 'type': 'contact', 'participant': PAT}],
            '6715134000010000108': [{'Email': 'pmoreno@example.org', 'name': 'Pat Moreno', 'id': 'p5', 'type': 'contact', 'participant': PAT}],
        },
        'write': 'ok'
    }

SEEDED = {'jpk-shell-seeded-cs': '1'}
JS_CONTRAST = """() => {
  const parse = c => { const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const bgOf = el => { for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0.5) return c; } return parse(getComputedStyle(document.body).backgroundColor); };
  const sel = '.jpk-up-k, .jpk-up-rel, .jpk-up-t, .jpk-up-s, .jpk-chip, .jpk-btn, .jpk-day-h, .jpk-ev-time, .jpk-ev-t, .jpk-ev-open, .jpk-ev-v, .jpk-cal-empty, .jpk-dc-w, .jpk-dc-d, .jpk-cal-meta, .jpk-ol, .jpk-showweek, .jpk-cal-panel p, .jpk-cal-panel li, .jpk-cal-panel a, .jpk-pn-h, .jpk-pn-sub, .jpk-pn-tag, .jpk-pn-muted, .jpk-pn-bad, .jpk-pn-good, .jpk-pick-n, .jpk-pick-k, .jpk-pick-q, .jpk-pick-sel, .jpk-pn-when b, .jpk-pn-venue';
  const out = [];
  document.querySelectorAll(sel).forEach(el => {
    if (!el.getClientRects().length || getComputedStyle(el).visibility === 'hidden' || !el.textContent.trim() || el.closest('[disabled]')) return;
    const cs = getComputedStyle(el), fg = parse(cs.color), bg = bgOf(el); if (!fg || !bg) return;
    const L1 = lum(fg), L2 = lum(bg), ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const big = parseFloat(cs.fontSize) >= 24 || (parseFloat(cs.fontSize) >= 18.66 && +cs.fontWeight >= 700);
    if (ratio < (big ? 3 : 4.5)) out.push([el.className, el.textContent.trim().slice(0, 20), Math.round(ratio * 100) / 100]);
  });
  return out; }"""
JS_LIST = "() => Array.from(document.querySelectorAll('.jpk-day-list > li')).map(li => li.innerText.replace(/\\s+/g, ' ').trim())"
JS_CALLS = "(fn) => window.__calls.filter(c => c.fn === fn)"

class Run:
    def __init__(self, p):
        self.b = p.chromium.launch()
    def page(self, url=DEMO, query='', mock=None, cfg=None, w=1400, h=900, scheme='light', tz='America/Chicago', now=NOW, wait=1500, storage=SEEDED, nomock=False):
        ctx = self.b.new_context(viewport={'width': w, 'height': h}, color_scheme=scheme, timezone_id=tz, reduced_motion='reduce')
        pg = ctx.new_page()
        pg.errors = []; pg.console_errors = []
        pg.on('pageerror', lambda e: pg.errors.append(str(e)))
        pg.on('console', lambda m: pg.console_errors.append(m.text) if m.type == 'error' else None)
        pg.route('**/*', lambda r: r.continue_() if r.request.url.startswith('file:') else r.abort())
        pg.clock.set_system_time(datetime.datetime.fromisoformat(now))
        if storage:
            pg.add_init_script('(() => { const s = ' + json.dumps(storage) + '; for (const k in s) localStorage.setItem(k, s[k]); })()')
        if cfg is not None:
            pg.add_init_script('window.jpkCalendarConfig = ' + json.dumps(cfg) + ';')
        if not nomock:
            pg.add_init_script('window.__MOCK = ' + json.dumps(mock if mock is not None else fixture()) + ';')
            pg.add_init_script(path=MOCK_JS)
        pg.goto(url + query); pg.wait_for_timeout(wait)
        return pg
    def done(self, pg, name, allow_console=None):
        ce = [c for c in pg.console_errors if not (allow_console and re.search(allow_console, c))]
        check(name + ': zero console errors and page errors', not pg.errors and not ce, {'pageerrors': pg.errors, 'console': ce})
        pg.context.close()

def day(pg, d):
    pg.click(f'[data-jpk-day="{d}"]'); pg.wait_for_timeout(80)
    return pg.evaluate(JS_LIST)

def calls(pg, fn): return pg.evaluate(JS_CALLS, fn)

# ------------------------------------------------------------------ pure model (in the page, Chicago zone)
def tests_model(R):
    pg = R.page(nomock=True, query='?caldemo=empty', wait=600)
    J = lambda t: pg.evaluate('(t) => jpkCalendar._model.joinUrl(t)', t)
    check('[join] Teams meetup-join link found in a Teams invitation (with help, download and Meeting options links around it)', J(DESC) == TEAMS_URL, J(DESC))
    check('[join] Teams /meet/<id>?p= short link', J('Join: https://teams.microsoft.com/meet/29483756123?p=Tok3n') == 'https://teams.microsoft.com/meet/29483756123?p=Tok3n')
    check('[join] Teams link in HTML (href, &amp;)', J('<a href="https://teams.microsoft.com/l/meetup-join/19%3ameeting_X%40thread.v2/0?context=a&amp;b=1">Join</a>') == 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_X%40thread.v2/0?context=a&b=1')
    check('[join] Outlook Safe Links wrapper is unwrapped', J('https://nam12.safelinks.protection.outlook.com/?url=https%3A%2F%2Fteams.microsoft.com%2Fl%2Fmeetup-join%2F19%253ameeting_Y%2540thread.v2%2F0&data=05') == 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_Y%40thread.v2/0')
    check('[join] Zoom /j/ link (subdomain, pwd kept for one-click join)', J('Join Zoom Meeting\n' + ZOOM_URL + '\nPasscode: 559201') == ZOOM_URL)
    check('[join] Zoom personal room /my/', J('https://zoom.us/my/beaucarrigan.') == 'https://zoom.us/my/beaucarrigan')
    check('[join] Google Meet link', J('Video call link: https://meet.google.com/abc-defg-hij\nOr dial: +1 555') == 'https://meet.google.com/abc-defg-hij')
    neg = {
        'Meeting options only': 'Meeting options<https://teams.microsoft.com/meetingOptions/?organizerId=abc>',
        'Teams help link': 'Need help? https://aka.ms/JoinTeamsMeeting',
        'Teams dial-in link': 'Find a local number https://dialin.teams.microsoft.com/abc?id=1',
        'Join on the web page': 'https://www.microsoft.com/microsoft-teams/join-a-meeting',
        'Zoom register link': 'https://zoom.us/meeting/register/tJ0kc',
        'Google Meet help': 'https://support.google.com/a/users/answer/9282720',
        'Meet without a code': 'https://meet.google.com/',
        'plain text, no link': 'Room 2, bring the spare report',
        'empty': '',
    }
    for k, t in neg.items():
        check('[join negative] ' + k + ' -> null', J(t) is None, J(t))
    check('[join negative] null description -> null', pg.evaluate('() => jpkCalendar._model.joinUrl(null)') is None)

    E = lambda rule, base, frm, to: pg.evaluate("""([rule, base, frm, to]) => { const M = jpkCalendar._model, r = M.parseRule(rule); const out = M.expand(r, new Date(base), new Date(frm), new Date(to)); return out === null ? { unsupported: r && r.unsupported } : out.map(d => M.isoLocal(d)); }""", [rule, base, frm, to])
    r = E('FREQ=DAILY;INTERVAL=2;COUNT=5', '2026-10-01T09:00:00-05:00', '2026-10-01T00:00:00-05:00', '2026-10-31T23:59:00-05:00')
    check('[rrule] DAILY INTERVAL=2 COUNT=5', [x[:10] for x in r] == ['2026-10-01', '2026-10-03', '2026-10-05', '2026-10-07', '2026-10-09'], r)
    r = E('FREQ=DAILY;COUNT=3', '2026-10-20T09:00:00-05:00', '2026-10-21T00:00:00-05:00', '2026-10-31T23:59:00-05:00')
    check('[rrule] COUNT counts from the series start even when the range starts later', [x[:10] for x in r] == ['2026-10-21', '2026-10-22'], r)
    r = E('FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261028', '2026-10-05T14:00:00-05:00', '2026-10-01T00:00:00-05:00', '2026-11-30T23:59:00-06:00')
    check('[rrule] WEEKLY BYDAY=MO,WE UNTIL (date, inclusive)', [x[:10] for x in r] == ['2026-10-05', '2026-10-07', '2026-10-12', '2026-10-14', '2026-10-19', '2026-10-21', '2026-10-26', '2026-10-28'], r)
    r = E('FREQ=WEEKLY;INTERVAL=2;BYDAY=TU', '2026-10-06T10:00:00-05:00', '2026-10-01T00:00:00-05:00', '2026-11-30T23:59:00-06:00')
    check('[rrule] WEEKLY INTERVAL=2 BYDAY=TU', [x[:10] for x in r] == ['2026-10-06', '2026-10-20', '2026-11-03', '2026-11-17'], r)
    r = E('FREQ=WEEKLY;UNTIL=20261020T150000Z', '2026-10-06T10:00:00-05:00', '2026-10-01T00:00:00-05:00', '2026-11-30T23:59:00-06:00')
    check('[rrule] WEEKLY without BYDAY uses the start weekday; UNTIL with Z time', [x[:10] for x in r] == ['2026-10-06', '2026-10-13', '2026-10-20'], r)
    r = E('FREQ=WEEKLY;UNTIL=20261020T145959Z', '2026-10-06T10:00:00-05:00', '2026-10-01T00:00:00-05:00', '2026-11-30T23:59:00-06:00')
    check('[rrule] UNTIL one second before an occurrence excludes it', [x[:10] for x in r] == ['2026-10-06', '2026-10-13'], r)
    r = E('FREQ=MONTHLY;BYDAY=2TU', '2026-10-13T10:00:00-05:00', '2026-10-01T00:00:00-05:00', '2026-12-31T23:59:00-06:00')
    check('[rrule] MONTHLY BYDAY=2TU (second Tuesday)', [x[:10] for x in r] == ['2026-10-13', '2026-11-10', '2026-12-08'], r)
    r = E('FREQ=MONTHLY;BYDAY=TU;BYSETPOS=2', '2026-10-13T10:00:00-05:00', '2026-10-01T00:00:00-05:00', '2026-12-31T23:59:00-06:00')
    check('[rrule] MONTHLY BYDAY=TU;BYSETPOS=2 equals 2TU', [x[:10] for x in r] == ['2026-10-13', '2026-11-10', '2026-12-08'], r)
    r = E('FREQ=MONTHLY;BYDAY=-1FR;INTERVAL=1', '2026-10-30T15:00:00-05:00', '2026-10-01T00:00:00-05:00', '2027-01-31T23:59:00-06:00')
    check('[rrule] MONTHLY BYDAY=-1FR (last Friday)', [x[:10] for x in r] == ['2026-10-30', '2026-11-27', '2026-12-25', '2027-01-29'], r)
    r = E('FREQ=MONTHLY;BYMONTHDAY=31;COUNT=3', '2026-08-31T09:00:00-05:00', '2026-08-01T00:00:00-05:00', '2027-03-31T23:59:00-05:00')
    check('[rrule] MONTHLY BYMONTHDAY=31 skips short months; COUNT=3', [x[:10] for x in r] == ['2026-08-31', '2026-10-31', '2026-12-31'], r)
    r = E('FREQ=MONTHLY;INTERVAL=2', '2026-09-15T09:00:00-05:00', '2026-09-01T00:00:00-05:00', '2027-01-31T23:59:00-06:00')
    check('[rrule] MONTHLY INTERVAL=2 on the start date', [x[:10] for x in r] == ['2026-09-15', '2026-11-15', '2027-01-15'], r)
    r = E('FREQ=WEEKLY;BYDAY=MO', '2026-10-26T09:00:00-05:00', '2026-10-26T00:00:00-05:00', '2026-11-10T23:59:00-06:00')
    check('[rrule] across the daylight-saving change 9:00 stays 9:00 local (-05:00 then -06:00)', r == ['2026-10-26T09:00:00-05:00', '2026-11-02T09:00:00-06:00', '2026-11-09T09:00:00-06:00'], r)
    for rule, why in [('FREQ=YEARLY;INTERVAL=1', 'FREQ=YEARLY'), ('FREQ=WEEKLY;BYHOUR=9', 'BYHOUR'), ('FREQ=DAILY;BYMONTHDAY=3', 'DAILY with BYMONTHDAY'), ('FREQ=MONTHLY;BYDAY=XX', 'BYDAY=XX'), ('INTERVAL=2', 'FREQ=missing')]:
        r = E(rule, '2026-10-06T10:00:00-05:00', '2026-10-01T00:00:00-05:00', '2026-11-30T23:59:00-06:00')
        check('[rrule unsupported] ' + rule + ' -> not expanded (' + why + ')', r == {'unsupported': why}, r)
    forms = pg.evaluate("""() => { const P = jpkCalendar._model.parseRule; return [P({ RRULE: 'FREQ=DAILY;INTERVAL=3' }).interval, P('{"RRULE":"FREQ=WEEKLY;BYDAY=FR"}').byday[0].wd, P('RRULE:FREQ=MONTHLY;COUNT=4').count, P(null), P('')]; }""")
    check('[rrule] value forms: object {RRULE}, JSON string, RRULE: prefix, empty', forms == [3, 5, 4, None, None], forms)

    W = pg.evaluate("""() => { const M = jpkCalendar._model; return [
      M.writeError({ data: [{ code: 'INVALID_DATA', details: { api_name: 'What_Id' }, message: 'the related id given seems to be invalid', status: 'error' }] }),
      M.writeError({ code: 'NO_PERMISSION', message: 'permission denied' }), M.writeError(new Error('save timed out')),
      JSON.stringify(M.payload({ id: '1' }, { account: { id: 2 }, contact: null })), JSON.stringify(M.payload({ id: '1' }, { account: null, contact: { id: 3 } })) ]; }""")
    check('[write] Zoho error text is Zoho\'s own (code: message (field))', W[:3] == ['INVALID_DATA: the related id given seems to be invalid (What_Id)', 'NO_PERMISSION: permission denied', 'save timed out'], W)
    check('[write] payload has only what was asked (account only)', W[3] == '{"id":"1","What_Id":{"id":"2"},"$se_module":"Accounts"}', W[3])
    check('[write] payload has only what was asked (contact only)', W[4] == '{"id":"1","Who_Id":{"id":"3"}}', W[4])
    R.done(pg, '[model]')

# ------------------------------------------------------------------ load: query, time zone, day boundaries, all-day, recurrence, cancelled, owner
def tests_load(R):
    pg = R.page()
    q = [c['q'] for c in calls(pg, 'coql')]
    main = [x for x in q if ' from Events ' in x and 'is not null' not in x]
    check('[load] one COQL read of Events for the range, Owner = current user, Description included', len(main) == 1 and f'Owner.id = {ME}' in main[0] and 'Description' in main[0] and 'Recurring_Activity' in main[0], q)
    check('[load] range literals in the viewer zone with offset, one day either side (21 Oct 00:00 to 29 Oct 23:59:59, -05:00)', "Start_DateTime >= '2026-10-21T00:00:00-05:00'" in main[0] and "Start_DateTime <= '2026-10-29T23:59:59-05:00'" in main[0], main)
    check('[load] COQL groups two conditions at a time and pages with limit 200 offset 0', "where ((Owner.id = " in main[0] and main[0].endswith('limit 200 offset 0'), main)
    check('[load] repeating meetings that started earlier are read once (Recurring_Activity is not null, Start before the range)', sum(1 for x in q if 'Recurring_Activity is not null' in x and "Start_DateTime < '2026-10-21T00:00:00-05:00'" in x) == 1, q)
    check('[load] chip names: one Accounts read and one Contacts read by id', any(' from Accounts where id in (' in x for x in q) and any(' from Contacts where id in (' in x for x in q), q)
    check('[load] no participant (getRecord) read during load', calls(pg, 'getRecord') == [])
    check('[load] no write during load', calls(pg, 'updateRecord') == [])
    today = pg.evaluate(JS_LIST)
    check('[load] today list (Chicago): stand-up occurrence 8:30, TEST 10:25, Dane 1:00 PM, 22:30 UTC-stored late call, 23:59 meeting',
          [t.split(' Microsoft')[0] for t in today] == ['8:30 AM to 8:45 AM EM ops stand-up', '10:25 AM to 10:55 AM TEST – CS Home calendar', '1:00 PM to 1:30 PM Dane County: GPS spare review', '10:30 PM to 11:00 PM Late call with Anchorage', '11:59 PM to 12:15 AM Just before midnight'], today)
    check('[load] cancelled meeting and another owner\'s meeting are not shown', not any('Canceled' in t or 'Someone else' in t for t in today))
    up = pg.evaluate("() => document.querySelector('.jpk-upnext').innerText")
    check('[up-next] TEST meeting in 25 min, Join, Open in Zoho, Open in Outlook, Link to account', all(x in up for x in ['in 25 min', 'TEST – CS Home calendar', '10:25 AM to 10:55 AM', 'Join', 'Open in Zoho', 'Open in Outlook', 'Link to account']), up)
    a = pg.evaluate("""() => Array.from(document.querySelectorAll('.jpk-upnext a')).map(a => [a.textContent, a.getAttribute('href'), a.target, a.rel])""")
    check('[up-next] Join opens the Teams link in a new tab with rel noopener', ['Join', TEAMS_URL, '_blank', 'noopener'] in a, a)
    check('[up-next] Open in Zoho opens the Events record (target _top)', ['Open in Zoho', 'https://crm.zoho.com/crm/org882980956/tab/Events/' + TEST_ID, '_top', ''] in a, a)
    check('[up-next] Open in Outlook: spec behaviour (Outlook day view, new tab, noopener)', ['Open in Outlook', 'https://outlook.office.com/calendar/view/day', '_blank', 'noopener'] in a, a)
    rowjoin = pg.evaluate("() => Array.from(document.querySelectorAll('.jpk-day-list .jpk-join')).map(a => [a.getAttribute('href'), a.target, a.rel])")
    check('[today] row Join buttons: Teams meetup-join and Teams /meet/ links, new tab, noopener', rowjoin == [[TEAMS_URL, '_blank', 'noopener'], ['https://teams.microsoft.com/meet/29483756123?p=Tok3nNotTheCode', '_blank', 'noopener']], rowjoin)
    html = pg.evaluate("() => document.documentElement.outerHTML")
    st = pg.evaluate("() => JSON.stringify(jpkCalendar.state.events) + JSON.stringify(JPKShell.state.cal.events)")
    check('[passcode] passcode and meeting ID never in the page (text, attributes) or in the event objects', PASSCODE not in html and MEETING_ID not in html and 'Passcode' not in html and PASSCODE not in st and 'Description' not in st and '559201' not in st, [PASSCODE in html, MEETING_ID in html, PASSCODE in st])
    check('[passcode] the join link is never shown as text, only as a link target', TEAMS_URL not in pg.evaluate("() => document.body.innerText"))
    o = pg.evaluate("() => jpkCalendar.state.events.find(e => e.id === '" + TEST_ID + "')")
    check('[interface] event object fields as the step 5 interface defines', set(['id', 'title', 'start', 'end', 'allDay', 'venue', 'joinUrl', 'accountId', 'contactId', 'attendees']) <= set(o.keys()) and o['start'] == '2026-10-22T10:25:00-05:00' and o['attendees'] == [] and o['joinUrl'] == TEAMS_URL, o)
    d23 = day(pg, '2026-10-23')
    check('[day 23] all-day event first, then just-after-midnight, then the linked review', d23 == ['All day Training day', '12:00 AM to 12:30 AM Just after midnight', '9:00 AM to 10:00 AM Dane County quarterly review'], d23)
    check('[day 23] the late call (03:30 UTC on 23 Oct) is NOT on 23 Oct for a Chicago viewer', not any('Anchorage' in t for t in d23))
    d24 = day(pg, '2026-10-24')
    check('[day 24] Zoom meeting with its Zoom Join link', d24 == ['2:00 PM to 2:30 PM Zoom renewal call Zoom Join'] and pg.evaluate("() => document.querySelector('.jpk-day-list .jpk-join').getAttribute('href')") == ZOOM_URL, d24)
    d25 = day(pg, '2026-10-25')
    rec = pg.evaluate("() => jpkCalendar.state.events.filter(e => e.title === 'Annual audit walk-through').map(e => [e.recurring, e.recurrence])")
    check('[recurrence] unsupported rule (YEARLY): shown once on its own date and marked recurring', d25 == ['1:00 PM to 2:00 PM Annual audit walk-through'] and rec == [[True, 'Repeats. This repeat rule is not supported here, so only the date on the record is shown.']], [d25, rec])
    d26 = day(pg, '2026-10-26')
    check('[recurrence] weekly MO,TH stand-up from 1 Oct appears on Mon 26 Oct; two-day all-day event listed on its first day', d26 == ['All day Two days out of office', '8:30 AM to 8:45 AM EM ops stand-up Microsoft Teams Meeting'], d26)
    d27 = day(pg, '2026-10-27')
    check('[all-day] multi-day all-day event (end at exclusive midnight) also listed on its second day, not a third', any('Two days out of office' in t for t in d27) and not any('Two days' in t for t in day(pg, '2026-10-28')), d27)
    so = pg.evaluate("() => jpkCalendar.state.events.filter(e => e.title === 'EM ops stand-up').map(e => e.start)")
    check('[recurrence] stand-up occurrences in range: Thu 22 and Mon 26 only, 08:30 local', so == ['2026-10-22T08:30:00-05:00', '2026-10-26T08:30:00-05:00'], so)
    chips = pg.evaluate("() => Array.from(document.querySelectorAll('.jpk-daychip')).map(b => b.getAttribute('aria-label'))")
    check('[week strip] seven days with meeting counts from real data', chips == ['Thursday, October 22: 5 meetings', 'Friday, October 23: 3 meetings', 'Saturday, October 24: 1 meeting', 'Sunday, October 25: 1 meeting', 'Monday, October 26: 2 meetings', 'Tuesday, October 27: 2 meetings', 'Wednesday, October 28: 1 meeting'], chips)
    lk = pg.evaluate("() => { const e = jpkCalendar.state.events; const r = e.find(x => x.title === 'Dane County quarterly review'), d = e.find(x => x.title === 'Deal review'); return [r.accountId, r.accountName, r.contactId, r.contactName, d.accountId, d.whatId]; }")
    check('[links] What_Id/Who_Id names resolved; a What_Id that is not an account gives no account chip', lk == [DANE, 'Dane County', PAT, 'Pat Moreno', '', '6715134000000880001'], lk)
    cnt = pg.evaluate("() => JPKShell.counts.meetings")
    check('[counts] header meetings count comes from the real data (meetings not yet ended today: TEST, Dane, late call, 23:59)', cnt == 4, cnt)
    R.done(pg, '[load]')

    # late-evening event seen from another zone; all-day stays on its date
    pg = R.page(tz='Europe/London', now='2026-10-22T16:00:00+01:00')
    t = pg.evaluate(JS_LIST)
    check('[tz London] TEST shown at 4:25 PM local; the 22:30 Chicago call is not on 22 Oct', any(x.startswith('4:25 PM to 4:55 PM TEST') for x in t) and not any('Anchorage' in x for x in t), t)
    d23 = day(pg, '2026-10-23')
    check('[tz London] the 22:30 Chicago call shows on 23 Oct at 4:30 AM; "just before midnight" at 5:59 AM', any(x.startswith('4:30 AM to 5:00 AM Late call') for x in d23) and any(x.startswith('5:59 AM') for x in d23), d23)
    check('[tz London] the all-day event stays on 23 Oct (date of the record, not shifted)', 'All day Training day' in d23, d23)
    q = [c['q'] for c in calls(pg, 'coql') if ' from Events ' in c['q'] and 'is not null' not in c['q']][0]
    check('[tz London] range literals use the viewer offset (+01:00)', "'2026-10-21T00:00:00+01:00'" in q, q)
    R.done(pg, '[tz London]')

    pg = R.page(tz='America/Los_Angeles', now='2026-10-22T08:00:00-07:00')
    d23 = day(pg, '2026-10-23')
    check('[tz Los Angeles] the all-day event stays on 23 Oct; the 22:30 Chicago call shows on 22 Oct at 8:30 PM', 'All day Training day' in d23 and any(x.startswith('8:30 PM to 9:00 PM Late call') for x in day(pg, '2026-10-22')), d23)
    R.done(pg, '[tz Los Angeles]')

# ------------------------------------------------------------------ daylight-saving week
def tests_dst(R):
    m = fixture()
    m['events'] = [ev('6715134000010000201', 'Sunday late check', '2026-11-01T22:30:00-06:00', '2026-11-01T23:00:00-06:00'),
                   ev('6715134000010000202', 'Before the change', '2026-10-31T09:00:00-05:00', '2026-10-31T09:30:00-05:00')]
    m['masters'] = [ev('6715134000010000203', 'Daily huddle', '2026-10-19T09:00:00-05:00', '2026-10-19T09:15:00-05:00', Recurring_Activity={'RRULE': 'FREQ=DAILY;INTERVAL=1'})]
    pg = R.page(mock=m, now='2026-10-29T10:00:00-05:00')
    chips = pg.evaluate("() => Array.from(document.querySelectorAll('.jpk-daychip')).map(b => b.getAttribute('data-jpk-day'))")
    check('[dst] week strip across the 1 Nov change: 29 Oct to 4 Nov, seven distinct days', chips == ['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'], chips)
    q = [c['q'] for c in calls(pg, 'coql') if ' from Events ' in c['q'] and 'is not null' not in c['q']][0]
    check('[dst] query start uses -05:00 and end uses -06:00 (each boundary its own offset)', "'2026-10-28T00:00:00-05:00'" in q and "'2026-11-05T23:59:59-06:00'" in q, q)
    hud = pg.evaluate("() => jpkCalendar.state.events.filter(e => e.title === 'Daily huddle').map(e => e.start)")
    check('[dst] daily 9:00 meeting stays 9:00 local on every day of the week', hud == ['2026-10-29T09:00:00-05:00', '2026-10-30T09:00:00-05:00', '2026-10-31T09:00:00-05:00', '2026-11-01T09:00:00-06:00', '2026-11-02T09:00:00-06:00', '2026-11-03T09:00:00-06:00', '2026-11-04T09:00:00-06:00'], hud)
    d = day(pg, '2026-11-01')
    check('[dst] 1 Nov list: huddle 9:00 AM and the 22:30 -06:00 meeting at 10:30 PM on the right day', d == ['9:00 AM to 9:15 AM Daily huddle', '10:30 PM to 11:00 PM Sunday late check'], d)
    check('[dst] every chip counts its meetings (huddle each day, plus one on 31 Oct and 1 Nov)', pg.evaluate("() => Array.from(document.querySelectorAll('.jpk-daychip')).map(b => b.getAttribute('aria-label').split(': ')[1])") == ['1 meeting', '1 meeting', '2 meetings', '2 meetings', '1 meeting', '1 meeting', '1 meeting'])
    pg.locator('#jpk-cal').screenshot(path=str(SHOTS / 'cal-dst-week.png'))
    R.done(pg, '[dst]')

# ------------------------------------------------------------------ paging, failure, empty, fallbacks
def tests_states(R):
    m = fixture()
    m['masters'] = []
    m['events'] = [ev('67151340000300%04d' % i, 'Bulk %03d' % i, '2026-10-2%dT%02d:%02d:00-05:00' % (3 + i % 5, 8 + (i % 9), i % 60), '2026-10-2%dT%02d:%02d:00-05:00' % (3 + i % 5, 8 + (i % 9), i % 60)) for i in range(205)]
    pg = R.page(mock=m)
    q = [c['q'] for c in calls(pg, 'coql') if ' from Events ' in c['q'] and 'is not null' not in c['q']]
    n = pg.evaluate("() => jpkCalendar.state.events.length")
    check('[paging] 205 rows: two pages (offset 0, offset 200), all 205 meetings kept', len(q) == 2 and q[0].endswith('offset 0') and q[1].endswith('offset 200') and n == 205, [q, n])
    R.done(pg, '[paging]')

    m = fixture(); m['events'] = []; m['masters'] = []; m['empty'] = 'reject204'
    pg = R.page(mock=m, query='?ag=empty')
    lst = pg.evaluate("() => document.querySelector('.jpk-day-list').innerText.trim()")
    check('[empty] nothing in 7 days (204 from COQL): exact wording plus Open Outlook', lst == 'No meetings synced. Put a meeting on the Zoho CRM Calendar in Outlook to see it here. Open Outlook', lst)
    check('[empty] up-next: "Nothing scheduled. Your day is open."', pg.evaluate("() => document.querySelector('.jpk-upnext').innerText.trim()") == 'Nothing scheduled. Your day is open.')
    check('[empty] header meetings count is 0 (known, not unknown)', pg.evaluate("() => JPKShell.counts.meetings") == 0)
    R.done(pg, '[empty]')

    m = fixture(); m['events'] = []; m['masters'] = []
    pg = R.page(mock=m)
    check('[empty] fallback up-next from Today & Upcoming when there are no meetings', pg.evaluate("() => document.querySelector('.jpk-upnext').innerText").startswith('Next up · from Today & Upcoming'))
    R.done(pg, '[empty fallback]')

    m = fixture(); m['eventsFail'] = True
    pg = R.page(mock=m)
    lst = pg.evaluate("() => document.querySelector('.jpk-day-list').innerText.trim()")
    check('[failure] read failed: exact failure wording, never a blank zone', lst == 'Calendar could not load. Reload the page to try again.', lst)
    check('[failure] meetings count shows the unknown mark with its title, never 0', pg.evaluate("() => { const a = document.querySelector('[data-jpk-count=meetings]'); return [a.querySelector('b').textContent, a.title]; }") == ['—', 'Calendar could not load'])
    check('[failure] each query shape was tried once before giving up (6 tries), no write, no getRecord', len([c for c in calls(pg, 'coql') if ' from Events ' in c['q']]) == 6 and not calls(pg, 'getRecord'), len(calls(pg, 'coql')))
    check('[failure] up-next still useful (falls back to Today & Upcoming)', pg.evaluate("() => document.querySelector('.jpk-upnext').innerText").startswith('Next up · from Today & Upcoming'))
    R.done(pg, '[failure]')

    m = fixture(); m['hang'] = True
    pg = R.page(mock=m, cfg={'timeoutMs': 400, 'writeAllowedIds': [TEST_ID]}, wait=2000)
    check('[failure] Zoho never answers: timeout shows the failure wording after one try (a timeout is not retried)', pg.evaluate("() => document.querySelector('.jpk-day-list').innerText.trim()") == 'Calendar could not load. Reload the page to try again.' and len(calls(pg, 'coql')) == 1, calls(pg, 'coql'))
    R.done(pg, '[failure timeout]')

    m = fixture(); m['refuse'] = ['Owner.id']
    pg = R.page(mock=m)
    t = pg.evaluate(JS_LIST)
    check('[owner] COQL refuses Owner.id: retried without it and filtered here; other owner still hidden', len(t) == 5 and not any('Someone else' in x for x in t) and 'owner filter' in ' '.join(pg.evaluate("() => jpkCalendar.state.notes")), t)
    R.done(pg, '[owner refused]')

    m = fixture(); m['refuse'] = ['Recurring_Activity']
    pg = R.page(mock=m)
    t = pg.evaluate(JS_LIST)
    check('[columns] COQL refuses Recurring_Activity: meetings still load (no expansion), join links kept', len(t) == 4 and pg.evaluate("() => jpkCalendar.state.query.cols") == 'noRecur' and 'Join' in t[0], t)
    R.done(pg, '[recurring refused]')

    pg = R.page(query='?nouser=1', cfg={'userWaitMs': 400, 'writeAllowedIds': [TEST_ID]})
    check('[user] page never publishes the user: asks ZOHO.CRM.CONFIG.getCurrentUser once, then loads', len(calls(pg, 'getCurrentUser')) == 1 and len(pg.evaluate(JS_LIST)) == 5)
    R.done(pg, '[user fallback]')

# ------------------------------------------------------------------ participants: lazy, visible day only
def tests_participants(R):
    pg = R.page()
    check('[participants] none read after load', calls(pg, 'getRecord') == [])
    pg.click(f'[data-jpk-open="{TEST_ID}"]'); pg.wait_for_timeout(300)
    gr = [c['arg']['RecordID'] for c in calls(pg, 'getRecord')]
    check('[participants] opening a meeting reads that one record only (getRecord, Events)', gr == [TEST_ID] and calls(pg, 'getRecord')[0]['arg']['Entity'] == 'Events', gr)
    att = pg.evaluate("() => document.getElementById('jpk-pn-att').innerText")
    check('[details] attendees: contact (linked to Zoho), Zoho user, outside guest', 'Pat Moreno' in att and 'Contact' in att and 'Beau Carrigan' in att and 'Zoho user' in att and 'guest@example.com' in att, att)
    check('[details] contact attendee links to the Contacts record', pg.evaluate("() => document.querySelector('#jpk-pn-att a').getAttribute('href')") == 'https://crm.zoho.com/crm/org882980956/tab/Contacts/' + PAT)
    pt = pg.evaluate("() => document.getElementById('jpk-cal-panel').innerText")
    check('[details] shows when, venue, Join, Link, Open in Zoho, Open in Outlook; never the passcode', all(x in pt for x in ['Thursday, October 22, 10:25 AM to 10:55 AM', 'Microsoft Teams Meeting', 'Join', 'Link to account or contact', 'Open in Zoho', 'Open in Outlook']) and PASSCODE not in pg.evaluate("() => document.documentElement.outerHTML"), pt)
    check('[details] focus moved to the panel heading', pg.evaluate("() => document.activeElement.id") == 'jpk-pn-h')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(80)
    check('[details] Esc closes it and focus returns to the meeting title that opened it', pg.evaluate("() => [document.getElementById('jpk-cal-panel').hidden, document.activeElement.getAttribute('data-jpk-open')]") == [True, TEST_ID])
    pg.click(f'[data-jpk-open="{TEST_ID}"]'); pg.wait_for_timeout(200); pg.keyboard.press('Escape')
    check('[participants] reopening uses the cache (still one read)', len(calls(pg, 'getRecord')) == 1)
    check('[participants] attendees are kept on the event for the shell', pg.evaluate("() => JPKShell.state.cal.events.find(e => e.id === '" + TEST_ID + "').attendees.length") == 3)
    day(pg, '2026-10-23')
    r = pg.evaluate("() => jpkCalendar.participants(jpkCalendar.state.events.find(e => e.title === 'Zoom renewal call')).then(() => 'read', e => e.message)")
    check('[participants] a meeting on a day not on screen is refused without a call (never the whole week)', r == 'Attendees load only for the day on screen.' and len(calls(pg, 'getRecord')) == 1, r)
    pg.click('[data-jpk-open="6715134000010000108"]'); pg.wait_for_timeout(300)
    gr = [c['arg']['RecordID'] for c in calls(pg, 'getRecord')]
    check('[participants] opening a meeting on the selected day reads just that one', gr == [TEST_ID, '6715134000010000108'], gr)
    R.done(pg, '[participants]')

    pg = R.page(cfg={'detailCap': 1, 'writeAllowedIds': [TEST_ID]})
    pg.click(f'[data-jpk-open="{TEST_ID}"]'); pg.wait_for_timeout(200); pg.keyboard.press('Escape')
    pg.click('[data-jpk-open="6715134000010000110"]'); pg.wait_for_timeout(200)
    t = pg.evaluate("() => document.getElementById('jpk-pn-att').innerText")
    check('[participants] daily cap (detailCap) respected, with a plain message', t == 'Attendees could not load: Attendees load for up to 1 meeting a day. Open the meeting in Zoho to see the rest.' and len(calls(pg, 'getRecord')) == 1, t)
    R.done(pg, '[participants cap]')

# ------------------------------------------------------------------ link picker
def open_picker(pg):
    pg.click('.jpk-upnext [data-jpk-link]'); pg.wait_for_timeout(400)

def picks(pg, ul):
    return pg.evaluate("(ul) => Array.from(document.querySelectorAll('#' + ul + ' [data-pick]')).map(b => [b.getAttribute('data-pick'), b.querySelector('.jpk-pick-n').textContent, b.getAttribute('aria-pressed')])", ul)

def tests_link(R):
    pg = R.page()
    n_events_q = len([c for c in calls(pg, 'coql') if ' from Events ' in c['q']])
    opener = pg.evaluate("() => { window.__op = document.querySelector('.jpk-upnext [data-jpk-link]'); return !!window.__op; }")
    open_picker(pg)
    check('[picker] opens inline under the up-next card, focus on its heading', pg.evaluate("() => [document.getElementById('jpk-cal-panel').hidden, document.activeElement.id, document.querySelector('.jpk-upnext').nextElementSibling.id]") == [False, 'jpk-pn-h', 'jpk-cal-panel'])
    check('[picker] it is labelled (role dialog, aria-labelledby the heading)', pg.evaluate("() => { const p = document.getElementById('jpk-cal-panel'); return [p.getAttribute('role'), p.getAttribute('aria-labelledby')]; }") == ['dialog', 'jpk-pn-h'])
    s = picks(pg, 'jpk-pick-sug')
    check('[picker] suggestions: the attendee who is a contact first, then that contact\'s account; users and outside guests are not suggested', s == [['contact:' + PAT, 'Pat Moreno', 'false'], ['account:' + DANE, 'Dane County', 'false']], s)
    check('[picker] participants were read for this meeting only', [c['arg']['RecordID'] for c in calls(pg, 'getRecord')] == [TEST_ID])
    check('[picker] Review is disabled until something is picked', pg.evaluate("() => document.querySelector('[data-pn=review]').disabled"))
    pg.fill('#jpk-pick-q', 'p'); pg.wait_for_timeout(450)
    check('[picker search] one letter: asks for two', pg.evaluate("() => document.getElementById('jpk-pick-res').innerText.trim()") == 'Type at least 2 letters.')
    pg.fill('#jpk-pick-q', 'polk'); pg.wait_for_timeout(500)
    r = picks(pg, 'jpk-pick-res')
    check('[picker search] results after the suggestions: accounts then contacts', r == [['account:' + POLK, 'Polk County', 'false'], ['contact:' + LEE, 'Lee Okafor', 'false']], r)
    sq = [c['q'] for c in calls(pg, 'coql') if "like '%polk%'" in c['q']]
    check('[picker search] COQL like on Account_Name and on contact Last_Name / First_Name / Email', len(sq) == 2 and any("Account_Name like '%polk%'" in x for x in sq) and any("((Last_Name like '%polk%' or First_Name like '%polk%') or Email like '%polk%')" in x for x in sq), sq)
    pg.fill('#jpk-pick-q', "o'brien"); pg.wait_for_timeout(500)
    check('[picker search] quotes are escaped the page\'s way and nothing found says so', any("like '%o''brien%'" in c['q'] for c in calls(pg, 'coql')) and pg.evaluate("() => document.getElementById('jpk-pick-res').innerText.trim()") == 'Nothing found for “o\'brien”.')
    pg.fill('#jpk-pick-q', '')
    # keyboard: pick both suggestions with Tab + Space/Enter
    pg.focus('#jpk-pn-h')
    pg.keyboard.press('Tab'); pg.keyboard.press('Tab')
    check('[keyboard] Tab from the heading reaches Close, then the first suggestion', pg.evaluate("() => document.activeElement.getAttribute('data-pick')") == 'contact:' + PAT)
    pg.keyboard.press('Space'); pg.keyboard.press('Tab'); pg.keyboard.press('Enter'); pg.wait_for_timeout(50)
    s = picks(pg, 'jpk-pick-sug')
    check('[keyboard] Space and Enter pick the contact and the account (aria-pressed)', [x[2] for x in s] == ['true', 'true'], s)
    check('[picker] chosen line names both', pg.evaluate("() => document.getElementById('jpk-pick-sel').textContent") == 'Chosen: account Dane County and contact Pat Moreno.')
    pg.click('[data-pn=review]'); pg.wait_for_timeout(50)
    c = pg.evaluate("() => document.getElementById('jpk-cal-panel').innerText")
    check('[confirm] a confirm step names the meeting, its date and both records before anything is written', 'Check before linking' in c and 'TEST – CS Home calendar' in c and 'Thursday, October 22, 10:25 AM to 10:55 AM' in c and 'Account: Dane County' in c and 'Contact: Pat Moreno' in c and calls(pg, 'updateRecord') == [], c)
    check('[confirm] focus on the confirm heading', pg.evaluate("() => document.activeElement.id") == 'jpk-pn-h')
    pg.click('[data-pn=write]'); pg.wait_for_timeout(300)
    u = calls(pg, 'updateRecord')
    check('[write] one updateRecord on Events with exactly {id, What_Id, $se_module, Who_Id}', len(u) == 1 and u[0]['arg']['Entity'] == 'Events' and u[0]['arg']['APIData'] == {'id': TEST_ID, 'What_Id': {'id': DANE}, '$se_module': 'Accounts', 'Who_Id': {'id': PAT}}, u)
    check('[write] Trigger follows the page convention (workflow)', u and u[0]['arg']['Trigger'] == ['workflow'], u)
    t = pg.evaluate("() => document.getElementById('jpk-pn-msg').innerText")
    check('[write] success says what changed', t == 'Linked. This meeting now shows Dane County and Pat Moreno.', t)
    up = pg.evaluate("() => Array.from(document.querySelectorAll('.jpk-upnext .jpk-chip')).map(a => [a.textContent, a.getAttribute('href')])")
    check('[write] up-next card updated without a reload: account and contact chips', up == [['Dane County', 'https://crm.zoho.com/crm/org882980956/tab/Accounts/' + DANE], ['Pat Moreno', 'https://crm.zoho.com/crm/org882980956/tab/Contacts/' + PAT]], up)
    check('[write] no Events re-read after the write (no full reload)', len([c for c in calls(pg, 'coql') if ' from Events ' in c['q']]) == n_events_q)
    pg.click('[data-pn=close]'); pg.wait_for_timeout(50)
    check('[picker] Close returns focus to the card (opener is gone, first chip takes it)', pg.evaluate("() => [document.getElementById('jpk-cal-panel').hidden, document.activeElement.className, document.activeElement.textContent]") == [True, 'jpk-chip', 'Dane County'])
    R.done(pg, '[link]')

    # contact only
    pg = R.page()
    open_picker(pg)
    pg.click(f'[data-pick="contact:{PAT}"]'); pg.click('[data-pn=review]'); pg.click('[data-pn=write]'); pg.wait_for_timeout(300)
    u = calls(pg, 'updateRecord')
    check('[write] contact only: payload is exactly {id, Who_Id}', len(u) == 1 and u[0]['arg']['APIData'] == {'id': TEST_ID, 'Who_Id': {'id': PAT}}, u)
    check('[write] contact only: card shows the contact chip', pg.evaluate("() => Array.from(document.querySelectorAll('.jpk-upnext .jpk-chip')).map(a => a.textContent)") == ['Pat Moreno'])
    R.done(pg, '[link contact only]')

    # Back keeps the search term; Esc cancels and focus returns to the opener; nothing written
    pg = R.page()
    open_picker(pg)
    pg.fill('#jpk-pick-q', 'polk'); pg.wait_for_timeout(500)
    pg.click(f'[data-pick="account:{POLK}"]'); pg.click('[data-pn=review]'); pg.click('[data-pn=back]'); pg.wait_for_timeout(500)
    check('[picker] Back returns to the choices with the search term kept', pg.evaluate("() => document.getElementById('jpk-pick-q').value") == 'polk')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(50)
    check('[picker] Esc cancels; focus back on "Link to account"; nothing written', pg.evaluate("() => [document.getElementById('jpk-cal-panel').hidden, document.activeElement.getAttribute('data-jpk-link')]") == [True, TEST_ID] and calls(pg, 'updateRecord') == [])
    R.done(pg, '[link cancel]')

    # blocked: a meeting that is not the TEST event
    pg = R.page()
    pg.click('[data-jpk-open="6715134000010000110"]'); pg.wait_for_timeout(300)
    pg.click('[data-pn=tolink]'); pg.wait_for_timeout(400)
    s = picks(pg, 'jpk-pick-sug')
    check('[blocked] the flow is the same for any meeting (suggestions from its attendees)', s == [['contact:' + PAT, 'Pat Moreno', 'false'], ['account:' + DANE, 'Dane County', 'false']], s)
    pg.click(f'[data-pick="account:{DANE}"]'); pg.click('[data-pn=review]'); pg.click('[data-pn=write]'); pg.wait_for_timeout(200)
    t = pg.evaluate("() => document.getElementById('jpk-pn-msg').innerText")
    check('[blocked] write outside writeAllowedIds: exact wording, no call made', t == 'Linking is limited to the test meeting while this is being checked.' and calls(pg, 'updateRecord') == [], t)
    check('[blocked] message is announced (role alert) and focus is on the result heading', pg.evaluate("() => [document.getElementById('jpk-pn-msg').getAttribute('role'), document.activeElement.id]") == ['alert', 'jpk-pn-h'])
    R.done(pg, '[link blocked]')

    pg = R.page(cfg={'writeAllowedIds': '*'})
    pg.click('[data-jpk-open="6715134000010000110"]'); pg.wait_for_timeout(300)
    pg.click('[data-pn=tolink]'); pg.wait_for_timeout(400)
    pg.click(f'[data-pick="account:{DANE}"]'); pg.click('[data-pn=review]'); pg.click('[data-pn=write]'); pg.wait_for_timeout(300)
    u = calls(pg, 'updateRecord')
    check('[allowed *] writeAllowedIds "*" allows any meeting; payload {id, What_Id, $se_module}', len(u) == 1 and u[0]['arg']['APIData'] == {'id': '6715134000010000110', 'What_Id': {'id': DANE}, '$se_module': 'Accounts'}, u)
    R.done(pg, '[link allowed *]')

    # errors
    for mode, want in [('error', 'Zoho did not save the link. Zoho said: INVALID_DATA: the related id given seems to be invalid (What_Id).'), ('reject', 'Zoho did not save the link. Zoho said: NO_PERMISSION: permission denied.')]:
        m = fixture(); m['write'] = mode
        pg = R.page(mock=m)
        open_picker(pg)
        pg.click(f'[data-pick="account:{DANE}"]'); pg.click('[data-pn=review]'); pg.click('[data-pn=write]'); pg.wait_for_timeout(300)
        t = pg.evaluate("() => document.getElementById('jpk-pn-msg').innerText")
        check(f'[error {mode}] the exact Zoho error is shown', t == want, t)
        check(f'[error {mode}] card unchanged (still "Link to account", no chip)', pg.evaluate("() => !!document.querySelector('.jpk-upnext [data-jpk-link]') && !document.querySelector('.jpk-upnext .jpk-chip')"))
        pg.click('[data-pn=back]'); pg.wait_for_timeout(450)
        check(f'[error {mode}] Back returns to the picker to try again', pg.evaluate("() => !!document.getElementById('jpk-pick-q')"))
        R.done(pg, f'[link error {mode}]')

# ------------------------------------------------------------------ layout, themes, contrast, screenshots
def tests_layout(R):
    for w, scheme in [(1400, 'light'), (1400, 'dark'), (390, 'light'), (390, 'dark')]:
        n = f'[layout {w} {scheme}]'
        pg = R.page(w=w, scheme=scheme, query='?theme=' + scheme)
        if w < 600:
            pg.click('.jpk-showweek'); pg.wait_for_timeout(80)
        low = pg.evaluate(JS_CONTRAST)
        check(n + ' AA contrast on calendar text', not low, low[:6])
        pg.locator('#jpk-cal').screenshot(path=str(SHOTS / f'cal-{w}-{scheme}.png'))
        open_picker(pg)
        pg.fill('#jpk-pick-q', 'polk'); pg.wait_for_timeout(500)
        pg.click(f'[data-pick="contact:{PAT}"]')
        low = pg.evaluate(JS_CONTRAST)
        check(n + ' AA contrast in the link picker', not low, low[:6])
        sw = pg.evaluate("() => [document.documentElement.scrollWidth, innerWidth, document.getElementById('jpk-cal-panel').getBoundingClientRect().right]")
        check(n + ' no horizontal scroll with the picker open; picker inside the viewport', sw[0] <= sw[1] and sw[2] <= sw[1], sw)
        if w < 600:
            g = pg.evaluate("() => { const p = document.getElementById('jpk-cal-panel').getBoundingClientRect(); return [Math.round(p.left), Math.round(innerWidth - p.right)]; }")
            check(n + ' picker keeps the page gutter at 390 px', g[0] >= 16 and g[1] >= 16, g)
        pg.locator('#jpk-cal').screenshot(path=str(SHOTS / f'cal-picker-{w}-{scheme}.png'))
        pg.click('[data-pn=review]'); pg.wait_for_timeout(50)
        pg.locator('#jpk-cal').screenshot(path=str(SHOTS / f'cal-confirm-{w}-{scheme}.png'))
        R.done(pg, n)
    pg = R.page()
    pg.click(f'[data-jpk-open="{TEST_ID}"]'); pg.wait_for_timeout(300)
    pg.locator('#jpk-cal').screenshot(path=str(SHOTS / 'cal-details-1400-light.png'))
    R.done(pg, '[layout details]')

# ------------------------------------------------------------------ keyboard walk, no SDK demo, real widget
def tests_keyboard(R):
    pg = R.page()
    pg.focus('.jpk-cal .jpk-tg')
    seen = []
    for i in range(30):
        pg.keyboard.press('Tab')
        seen.append(pg.evaluate("() => { const a = document.activeElement; return a.closest('#jpk-cal') ? (a.getAttribute('data-jpk-link') ? 'link' : a.getAttribute('data-jpk-open') ? 'open' : a.getAttribute('data-jpk-day') ? 'day' : a.textContent.trim()) : null; }"))
        if seen[-1] is None: break
    check('[keyboard] Tab through the calendar: Link, Join, Open in Zoho, Open in Outlook, meeting titles, day chips, Open Outlook', seen[:4] == ['link', 'Join', 'Open in Zoho', 'Open in Outlook'] and seen.count('open') == 5 and seen.count('day') == 7 and 'Open Outlook' in seen, seen)
    pg.focus(f'[data-jpk-open="{TEST_ID}"]'); pg.keyboard.press('Enter'); pg.wait_for_timeout(300)
    check('[keyboard] Enter on a meeting title opens its details', pg.evaluate("() => document.activeElement.id") == 'jpk-pn-h')
    pg.keyboard.press('Tab'); pg.keyboard.press('Tab'); pg.keyboard.press('Tab')
    check('[keyboard] Tab order in details: Close, attendee link, Join', pg.evaluate("() => document.activeElement.textContent") == 'Join')
    R.done(pg, '[keyboard]')

def tests_preview(R):
    pg = R.page(nomock=True, wait=1500)
    up = pg.evaluate("() => document.querySelector('.jpk-upnext').innerText")
    check('[preview] no SDK: built-in demo records through the same parsing (TEST meeting up next, Join found, no passcode)', 'TEST – CS Home calendar' in up and 'Join' in up and 'dEm0pX' not in pg.evaluate("() => document.documentElement.outerHTML"), up)
    check('[preview] not the step 5 stub', pg.evaluate("() => !window.jpkCalendar.stub && window.jpkCalendar.version") == '0.1.0')
    open_picker(pg)
    pg.click('[data-pick="contact:6715134000002592199"]'); pg.click('[data-pn=review]'); pg.click('[data-pn=write]'); pg.wait_for_timeout(400)
    check('[preview] link flow works and says nothing was saved', pg.evaluate("() => document.getElementById('jpk-pn-msg').innerText").endswith('Preview only: nothing was saved in Zoho.'))
    R.done(pg, '[preview]')
    for q, want in [('?caldemo=empty', 'No meetings synced. Put a meeting on the Zoho CRM Calendar in Outlook to see it here. Open Outlook'), ('?caldemo=err', 'Calendar could not load. Reload the page to try again.'), ('?caldemo=later', 'No meetings today.')]:
        pg = R.page(nomock=True, query=q, wait=1200)
        t = pg.evaluate("() => document.querySelector('.jpk-day-list').innerText.trim()")
        check(f'[preview {q}] exact wording', t == want, t)
        R.done(pg, f'[preview {q}]')
    pg = R.page(nomock=True, query='?caldemo=done', wait=1200)
    check('[preview ?caldemo=done] "No more meetings today."', pg.evaluate("() => document.querySelector('.jpk-upnext').innerText.trim()") == 'No more meetings today.')
    R.done(pg, '[preview ?caldemo=done]')

def tests_real(R):
    for w, scheme in [(1400, 'light'), (390, 'dark')]:
        pg = R.page(url=REAL, query='?preview=1&ntdemo=1', nomock=True, w=w, scheme=scheme, wait=3500)
        n = f'[real {w} {scheme}]'
        check(n + ' real v5.11 widget + shell + calendar: calendar loads from jpk-calendar (demo records in preview)', 'TEST – CS Home calendar' in pg.evaluate("() => document.querySelector('.jpk-upnext').innerText") and pg.evaluate("() => !window.jpkCalendar.stub"))
        if w < 600:
            sw = pg.evaluate("() => [document.documentElement.scrollWidth, innerWidth]")
            check(n + ' no horizontal scroll', sw[0] <= sw[1], sw)
        pg.screenshot(path=str(SHOTS / f'cal-real-widget-{w}-{scheme}.png'), full_page=False)
        R.done(pg, n, allow_console=r'Failed to load resource')

def tests_text(R):
    js = (B / 'jpk-calendar.js').read_text(encoding='utf-8'); css = (B / 'jpk-calendar.css').read_text(encoding='utf-8')
    check('[text] no em dash anywhere in jpk-calendar.js or jpk-calendar.css', '—' not in js and '—' not in css)
    check('[text] no network path other than the Zoho SDK (no fetch, XMLHttpRequest, WebSocket, sendBeacon, import)', not re.search(r'\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon|\bimport\(|EventSource', js))
    check('[text] updateRecord only on Events', re.findall(r"updateRecord\(\{ Entity: '(\w+)'", js) == ['Events'])
    pg = R.page()
    for sel in ['[data-jpk-open="' + TEST_ID + '"]', '[data-pn=tolink]']:
        pg.click(sel); pg.wait_for_timeout(400)
    pg.click(f'[data-pick="contact:{PAT}"]'); pg.click('[data-pn=review]')
    t = pg.evaluate("() => document.getElementById('jpk-cal').innerText")
    check('[text] no em dash in user-facing calendar text (details, picker, confirm)', '—' not in t, t[:200])
    R.done(pg, '[text]')

# ------------------------------------------------------------------ all-day records as stored in the live org (UTC day written in Central)
def tests_allday_live(R):
    chips = "() => Object.fromEntries(Array.from(document.querySelectorAll('.jpk-daychip')).map(b => [b.getAttribute('data-jpk-day'), b.getAttribute('aria-label').split(': ')[1]]))"
    m = fixture(); m['masters'] = []
    m['events'] = [ev('6715134000010000301', 'Kids no school', '2025-04-20T19:00:00-05:00', '2025-04-21T18:59:59-05:00', All_day=True),
                   ev('6715134000010000302', 'Outlook-style day off', '2025-04-23T00:00:00-05:00', '2025-04-24T00:00:00-05:00', All_day=True)]
    pg = R.page(mock=m, now='2025-04-20T10:00:00-05:00')
    c = pg.evaluate(chips)
    check('[all-day live] single day stored 20 Apr 19:00 to 21 Apr 18:59:59 (-05:00) shows on 21 Apr only; week strip agrees', day(pg, '2025-04-20') == ['No meetings today.'] and day(pg, '2025-04-21') == ['All day Kids no school'] and day(pg, '2025-04-22') == ['Nothing on this day.'] and c['2025-04-20'] == '0 meetings' and c['2025-04-21'] == '1 meeting', c)
    check('[all-day live] Outlook-style local midnight to exclusive midnight shows on 23 Apr only', day(pg, '2025-04-23') == ['All day Outlook-style day off'] and day(pg, '2025-04-24') == ['Nothing on this day.'] and c['2025-04-23'] == '1 meeting' and c['2025-04-24'] == '0 meetings', c)
    R.done(pg, '[all-day live single]')
    m = fixture(); m['masters'] = []
    m['events'] = [ev('6715134000010000303', 'NAPSA Atlanta', '2025-09-13T19:00:00-05:00', '2025-09-17T18:59:59-05:00', All_day=True)]
    for tz, now in [('America/Chicago', '2025-09-13T10:00:00-05:00'), ('America/Los_Angeles', '2025-09-13T08:00:00-07:00')]:
        pg = R.page(mock=m, now=now, tz=tz)
        c = pg.evaluate(chips)
        want = {'2025-09-13': '0 meetings', '2025-09-14': '1 meeting', '2025-09-15': '1 meeting', '2025-09-16': '1 meeting', '2025-09-17': '1 meeting', '2025-09-18': '0 meetings', '2025-09-19': '0 meetings'}
        lists = [day(pg, d) for d in ['2025-09-14', '2025-09-17', '2025-09-18']]
        check(f'[all-day live {tz}] multi-day stored 13 Sep 19:00 to 17 Sep 18:59:59 (-05:00) shows 14 to 17 Sep in the week strip and day list', c == want and lists == [['All day NAPSA Atlanta'], ['All day NAPSA Atlanta'], ['Nothing on this day.']], [c, lists])
        R.done(pg, f'[all-day live multi {tz}]')

with sync_playwright() as p:
    R = Run(p)
    for t in (tests_text, tests_model, tests_load, tests_allday_live, tests_dst, tests_states, tests_participants, tests_link, tests_layout, tests_keyboard, tests_preview, tests_real):
        try: t(R)
        except Exception as e: check(t.__name__ + ' crashed', False, traceback.format_exc())
    R.b.close()

passed = sum(1 for r in results if r[1]); failed = len(results) - passed
print(f'\n{passed} passed, {failed} failed, {len(results)} checks')
(B / 'tests' / 'last-run-cal.txt').write_text('\n'.join(('PASS ' if r[1] else 'FAIL ') + r[0] + ('' if r[1] else '  :: ' + str(r[2])[:500]) for r in results) + f'\n\n{passed} passed, {failed} failed\n')
sys.exit(1 if failed else 0)
