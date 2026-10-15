/* PDEC Home view + loader. Reads only. Opens with sample data when it is not inside Zoho. */
(function () {
  'use strict';
  var M = window.PdecModel, $ = function (id) { return document.getElementById(id); };
  var ED_NICK = ['egordon@differenceprinciple.org', 'nsayner@differenceprinciple.org'];
  var S = { warn: [], tab: 'overview', period: 'all', data: null, demo: false, sel: null, selCamp: null, journey: null, note: '' };
  var TABS = [['overview', 'Overview'], ['journey', 'Relationship journey'], ['report', 'Report to Ed and Nick']];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function toast(m) { if (window.JPK) JPK.toast(m); }
  function day(d) { return d ? String(d).slice(0, 10) : ''; }

  /* ---------- loading ---------- */
  /* Each read that fails is remembered, so the page can say which numbers may be short instead of silently showing zero. */
  function safeAll(q, name) {
    return JPK.crm.coqlAll(q).catch(function (e) { S.warn.push(name + ': ' + (e && e.message || 'could not be read')); return []; });
  }
  function members(campId, name) {
    var all = [];
    function page(n) {
      return ZOHO.CRM.API.getRelatedRecords({ Entity: 'Campaigns', RecordID: campId, RelatedList: 'Contacts', page: n, per_page: 200 }).then(function (r) {
        var rows = (r && r.data) || []; all = all.concat(rows);
        return r && r.info && r.info.more_records ? page(n + 1) : all;
      }).catch(function () { S.warn.push('People for ' + name + ' could not be read'); return all; });
    }
    return page(1).then(function (rows) {
      return rows.map(function (x) { var mi = x.$member_info || {}; return { id: x.id, name: x.Full_Name || x.name || '(no name)', status: mi.Member_Status || null, account: x.Account_Name && (x.Account_Name.name || x.Account_Name) || null }; });
    });
  }
  function loadZoho() {
    var since = '2025-01-01T00:00:00+00:00', camps, deals, memberMap = {};
    return safeAll("select id, Campaign_Name, Type, Status, Start_Date, Conference_Start_Date, Conference_End_Date, Speaking_or_Training_Opportunity, Total_Event_Cost, Registration_Cost, Exhibitor_Cost, Travel_Cost, Sponsorship_Cost, Lodging_Cost, Shipping_Cost from Campaigns where Type = 'Tradeshow/Conference'", 'Conferences')
      .then(function (c) { camps = c; return safeAll("select id, Deal_Name, Stage, Closing_Date, Created_Time, Stage_Modified_Time, Account_Name, Contact_Name, Source_Campaign, Services_Revenue, PDEC_Service_Type, PDEC_Topic from Deals where Source_Campaign is not null", 'Opportunities'); })
      .then(function (d) { deals = d; return Promise.all(camps.map(function (c) { return members(c.id, c.Campaign_Name).then(function (m) { memberMap[c.id] = m; }); })); })
      .then(function () { return Promise.all([
        safeAll("select Who_Id, Call_Start_Time from Calls where Call_Start_Time >= '" + since + "'", 'Calls'),
        safeAll("select Who_Id, Start_DateTime from Events where Start_DateTime >= '" + since + "'", 'Meetings'),
        safeAll("select Parent_Id, Created_Time from Notes where Created_Time >= '" + since + "'", 'Notes')]); })
      .then(function (t) {
        var ids = {}; Object.keys(memberMap).forEach(function (k) { memberMap[k].forEach(function (m) { ids[m.id] = 1; }); });
        var touches = [];
        t[0].forEach(function (x) { var id = x.Who_Id && x.Who_Id.id; if (ids[id]) touches.push({ contactId: id, date: x.Call_Start_Time, kind: 'call' }); });
        t[1].forEach(function (x) { var id = x.Who_Id && x.Who_Id.id; if (ids[id]) touches.push({ contactId: id, date: x.Start_DateTime, kind: 'meeting' }); });
        t[2].forEach(function (x) { var id = x.Parent_Id && (x.Parent_Id.id || x.Parent_Id); if (ids[id]) touches.push({ contactId: id, date: x.Created_Time, kind: 'note' }); });
        return { campaigns: camps, members: memberMap, deals: deals, touches: touches };
      });
  }
  function showWarn() {
    var w = $('warn');
    if (S.warn.length) { w.hidden = false; w.textContent = 'Some numbers may be short. ' + S.warn.join('; ') + '.'; } else w.hidden = true;
  }
  function load() {
    S.warn = []; showWarn();
    $('view').innerHTML = '<p class="empty">Loading…</p>';
    return JPK.crm.init().then(function (init) {
      if (init && init.demo) { S.demo = true; return window.PdecDemo; }
      S.demo = false; return loadZoho();
    }).then(function (d) {
      S.data = d; $('demo-flag').hidden = !S.demo;
      $('sub').textContent = S.demo ? 'This page is open outside Zoho, so it shows sample data.' : 'Reads Campaigns, Deals and activity. Nothing here changes a record.';
      showWarn(); render();
    }).catch(function (e) { $('view').innerHTML = '<div class="empty"><b>Could not read from Zoho</b>' + esc(e && e.message || e) + '</div>'; });
  }

  /* ---------- derived ---------- */
  function inPeriod(c) {
    if (S.period === 'all') return true;
    var s = c.Conference_Start_Date || c.Start_Date; if (!s) return false;
    var d = new Date(s), n = new Date();
    if (S.period === 'year') return d.getFullYear() === n.getFullYear();
    if (S.period === 'quarter') return d.getFullYear() === n.getFullYear() && Math.floor(d.getMonth() / 3) === Math.floor(n.getMonth() / 3);
    return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth();
  }
  function label() { var n = new Date(); return { all: 'all conferences', year: String(n.getFullYear()), quarter: 'Q' + (Math.floor(n.getMonth() / 3) + 1) + ' ' + n.getFullYear(), month: n.toLocaleString('en-US', { month: 'long', year: 'numeric' }) }[S.period]; }
  function rows() { var D = S.data; return D.campaigns.filter(inPeriod).map(function (c) { return M.funnel(c, D.members[c.id] || [], D.touches, D.deals); }).sort(function (a, b) { return String(b.start).localeCompare(String(a.start)); }); }
  function periodDeals(rs) { var ids = {}; rs.forEach(function (r) { ids[r.id] = 1; }); return S.data.deals.filter(function (d) { var c = d.Source_Campaign && (d.Source_Campaign.id || d.Source_Campaign); return ids[c]; }); }

  /* ---------- views ---------- */
  function periodPicker() {
    return '<div class="seg noprint" role="group" aria-label="Period">' + [['all', 'All conferences'], ['year', 'This year'], ['quarter', 'This quarter'], ['month', 'This month']].map(function (o) { return '<button type="button" data-period="' + o[0] + '" aria-pressed="' + (S.period === o[0]) + '">' + o[1] + '</button>'; }).join('') + '</div>';
  }
  function kpi(label, value) { return '<div><small>' + label + '</small><b>' + value + '</b></div>'; }
  function stageChip(st) { return '<span class="chip' + (st >= 4 ? ' good' : st >= 2 ? ' info' : '') + '">' + M.STAGES[st] + '</span>'; }

  function vOverview() {
    var rs = rows(), tt = M.totals(rs), deals = periodDeals(rs), open = deals.filter(M.isOpen).length;
    if (!rs.length) return periodPicker() + '<div class="empty"><b>No conferences in this period</b>Conferences are Campaigns of type Tradeshow/Conference.</div>';
    var max = Math.max(tt.met, 1), fun = [['Met', tt.met], ['In conversation', tt.conversation], ['Opportunity', tt.opportunity], ['Proposal sent', tt.proposal], ['Won', tt.won]].map(function (x) {
      return '<div class="f"><span>' + x[0] + '</span><span class="b"><i style="width:' + Math.round(100 * x[1] / max) + '%"></i></span><span class="v">' + x[1] + ' · ' + M.pct(x[1], tt.met) + '</span></div>'; }).join('');
    var lag = rs.map(function (r) { return M.lag(S.data.campaigns.filter(function (c) { return c.id === r.id; })[0], S.data.deals); });
    var med = function (k) { var v = lag.map(function (l) { return l[k]; }).filter(function (x) { return x != null; }).sort(function (a, b) { return a - b; }); return v.length ? v[Math.floor(v.length / 2)] + ' days' : 'n/a'; };
    var svc = function (field) { var b = M.byService(deals, field); return b.length ? '<div class="tw"><table><thead><tr><th scope="col">' + (field === 'PDEC_Topic' ? 'Topic' : 'Service type') + '</th><th scope="col" class="r">Opps</th><th scope="col" class="r">Won</th><th scope="col" class="r">Revenue</th></tr></thead><tbody>' + b.map(function (x) { return '<tr><td>' + esc(x.key) + '</td><td class="r">' + x.opportunities + '</td><td class="r">' + x.won + '</td><td class="r">' + M.money(x.revenue) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="note">None yet. Fill in PDEC Service Type and PDEC Topic on the opportunity.</p>'; };
    return periodPicker()
      + '<section class="card totals" aria-label="Totals"><div class="sum five">' + kpi('People met', tt.met) + kpi('In conversation', tt.conversation) + kpi('Open opportunities', open) + kpi('Won', tt.wonCount) + kpi('Won revenue', M.money(tt.revenue)) + '</div></section>'
      + '<section class="card"><h2>Conferences</h2><div class="tw"><table><thead><tr><th scope="col">Conference</th><th scope="col">Date</th><th scope="col">Role</th><th scope="col" class="r">Met</th><th scope="col" class="r">Talked</th><th scope="col" class="r">Opp</th><th scope="col" class="r">Proposal</th><th scope="col" class="r">Won</th><th scope="col" class="r">Revenue</th><th scope="col" class="r">Cost</th><th scope="col" class="r">Cost / opp</th></tr></thead><tbody>'
      + rs.map(function (r) { return '<tr class="click" tabindex="0" data-camp="' + esc(r.id) + '"><td>' + esc(r.name) + (r.orphanOpportunities ? ' <span class="chip warn sm" title="Opportunities for people not on the member list">' + r.orphanOpportunities + ' not on list</span>' : '') + '</td><td class="num">' + esc(day(r.start)) + '</td><td>' + esc(r.role) + '</td><td class="r">' + r.met + '</td><td class="r">' + r.conversation + '</td><td class="r">' + r.opportunity + '</td><td class="r">' + r.proposal + '</td><td class="r">' + r.won + '</td><td class="r">' + M.money(r.revenue) + '</td><td class="r">' + M.money(r.cost) + '</td><td class="r">' + M.money(r.costPerOpportunity) + '</td></tr>'; }).join('')
      + '</tbody></table></div><p class="note">Open a conference to see its people. Counts are cumulative: someone who reached Proposal sent also counts as Met, In conversation and Opportunity.</p></section>'
      + '<div class="cols"><section class="card"><h2>From met to won</h2><div class="fun">' + fun + '</div><p class="note">Median days from the conference to the first opportunity: ' + med('firstOpp') + '. To the first win: ' + med('firstWin') + '.</p></section>'
      + '<section class="card"><h2>By service type</h2>' + svc('PDEC_Service_Type') + '<h2 style="margin-top:16px">By topic</h2>' + svc('PDEC_Topic') + '</section></div>';
  }

  function vJourney() {
    var D = S.data, camp = D.campaigns.filter(function (c) { return c.id === S.selCamp; })[0] || D.campaigns[0];
    if (!camp) return '<div class="empty"><b>No conferences yet</b>Create a Campaign of type Tradeshow/Conference.</div>';
    S.selCamp = camp.id;
    var mem = D.members[camp.id] || [];
    var opts = D.campaigns.map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === camp.id ? ' selected' : '') + '>' + esc(c.Campaign_Name) + '</option>'; }).join('');
    var list = mem.length ? '<div class="tw"><table><thead><tr><th scope="col">Person</th><th scope="col">Organization</th><th scope="col">At the conference</th><th scope="col">Stage</th></tr></thead><tbody>' + mem.map(function (m) {
      var st = M.stageFor(m.id, camp, D.touches, D.deals); return '<tr class="click" tabindex="0" data-p="' + esc(m.id) + '"' + (S.sel && S.sel.id === m.id ? ' aria-selected="true"' : '') + '><td>' + esc(m.name) + '</td><td>' + (m.account ? esc(m.account) : '<span class="chip warn">No organization</span>') + '</td><td>' + esc(m.status || '') + '</td><td>' + stageChip(st) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="empty"><b>Nobody added yet</b>Add Contacts to this conference from the campaign record.</div>';
    var detail = '';
    if (S.sel) {
      var st = M.stageFor(S.sel.id, camp, D.touches, D.deals);
      detail = '<section class="card"><h2>' + esc(S.sel.name) + '</h2><div class="steps" role="list">' + M.STAGES.map(function (n, i) { return '<div class="step ' + (i < st ? 'done' : i === st ? 'cur' : '') + '" role="listitem"' + (i === st ? ' aria-current="step"' : '') + '>' + n + '</div>'; }).join('') + '</div>'
        + (S.journey ? (S.journey.length ? '<ul class="tl">' + S.journey.map(function (e) { return '<li><time>' + esc(day(e.date)) + '</time><span class="chip">' + esc(e.kind) + '</span><span><b>' + esc(e.title) + '</b>' + (e.detail ? '<br><span class="note">' + esc(e.detail) + '</span>' : '') + '</span></li>'; }).join('') + '</ul>' : '<div class="empty"><b>Nothing recorded yet</b>Notes, calls and meetings will show here.</div>') : '<p class="empty">Loading…</p>') + '</section>';
    }
    return '<div class="row ctl noprint"><label>Conference <select id="camp">' + opts + '</select></label><span class="muted sm">' + mem.length + ' people</span></div><div class="cols"><section class="card"><h2>People met</h2>' + list + '</section>' + detail + '</div>';
  }
  function openPerson(id) {
    var D = S.data, m = (D.members[S.selCamp] || []).filter(function (x) { return x.id === id; })[0];
    S.sel = m; S.journey = null; render();
    function done(notes, acts) { S.journey = M.journey(id, D.campaigns, D.members, notes, acts, D.deals); render(); }
    if (S.demo) return done((D.notes && D.notes[id]) || [], D.touches.filter(function (t) { return t.contactId === id; }).map(function (t) { return { date: t.date, kind: 'call', title: 'Follow-up' }; }));
    var rel = function (list) { return ZOHO.CRM.API.getRelatedRecords({ Entity: 'Contacts', RecordID: id, RelatedList: list, page: 1, per_page: 100 }).then(function (r) { return (r && r.data) || []; }).catch(function () { return []; }); };
    Promise.all([rel('Notes'), rel('Calls_History'), rel('Events_History')]).then(function (r) {
      var acts = r[1].map(function (c) { return { date: c.Call_Start_Time, kind: 'call', title: c.Subject || 'Call' }; }).concat(r[2].map(function (e) { return { date: e.Start_DateTime, kind: 'meeting', title: e.Event_Title || 'Meeting' }; }));
      done(r[0], acts);
    });
  }

  function vReport() {
    var rs = rows(), rep = M.report(rs, periodDeals(rs), label());
    return periodPicker()
      + '<section class="card paper" aria-label="Report preview"><header><div><h2 style="margin:0">PDEC report</h2><div class="muted sm">' + esc(rep.period) + ' · prepared by Miranda</div></div><div class="muted sm num">' + esc(new Date().toISOString().slice(0, 10)) + '</div></header>'
      + '<div class="tw"><table><tbody>' + rep.lines.map(function (l) { return '<tr><td>' + esc(l[0]) + '</td><td class="r"><b>' + esc(l[1]) + '</b></td></tr>'; }).join('') + '</tbody></table></div>'
      + (S.note ? '<p>' + esc(S.note) + '</p>' : '') + '</section>'
      + '<section class="card noprint"><h2>Send</h2><label>Note to Ed and Nick (optional)<br><input type="text" id="note" value="' + esc(S.note) + '"></label>'
      + '<div class="row sendrow"><button type="button" class="btn pri" id="print">Save as PDF</button><button type="button" class="btn" id="mail">Open email draft</button><button type="button" class="btn" id="copy">Copy summary</button></div>'
      + '<p class="note">Save as PDF opens the print window; choose Save as PDF there. The email draft opens in your own mail app, from your address, to Ed and Nick. Attach the PDF there if you want it attached. Nothing is sent from this page.</p></section>';
  }

  /* ---------- wiring ---------- */
  function render() {
    $('tabs').className = 'ctabs'; $('tabs').setAttribute('role', 'tablist'); $('tabs').setAttribute('aria-label', 'PDEC Home sections');
    var tabsEl = $('tabs');
    if (!tabsEl.firstChild) tabsEl.innerHTML = TABS.map(function (t) { return '<button type="button" role="tab" id="tab-' + t[0] + '" data-t="' + t[0] + '" aria-controls="view">' + t[1] + '</button>'; }).join('');
    Array.prototype.forEach.call(tabsEl.children, function (b) { var on = b.getAttribute('data-t') === S.tab; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
    $('view').setAttribute('role', 'tabpanel'); $('view').setAttribute('aria-labelledby', 'tab-' + S.tab);
    if (!S.data) return;
    $('view').innerHTML = { overview: vOverview, journey: vJourney, report: vReport }[S.tab]();
  }
  function reportText() { var rs = rows(); return M.emailText(M.report(rs, periodDeals(rs), label()), S.note); }
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-t]'); if (t) { S.tab = t.getAttribute('data-t'); return render(); }
    var pb = e.target.closest('[data-period]'); if (pb) { S.period = pb.getAttribute('data-period'); return render(); }
    var c = e.target.closest('tr[data-camp]'); if (c) { S.selCamp = c.getAttribute('data-camp'); S.sel = null; S.tab = 'journey'; return render(); }
    var p = e.target.closest('tr[data-p]'); if (p) return openPerson(p.getAttribute('data-p'));
    if (e.target.id === 'reload') return load();
    if (e.target.id === 'print') return window.print();
    if (e.target.id === 'copy') { return (navigator.clipboard ? navigator.clipboard.writeText(reportText()) : Promise.reject()).then(function () { toast('Summary copied'); }, function () { toast('Copy is blocked here. Use Open email draft instead.'); }); }
    if (e.target.id === 'mail') { var r2 = rows(), rep = M.report(r2, periodDeals(r2), label()); window.open('mailto:' + ED_NICK.join(',') + '?subject=' + encodeURIComponent('PDEC report, ' + rep.period) + '&body=' + encodeURIComponent(M.emailText(rep, S.note))); }
  });
  document.addEventListener('keydown', function (e) {
    var tr = e.target.closest && e.target.closest('tr.click'); if ((e.key === 'Enter' || e.key === ' ') && tr && e.target === tr) { e.preventDefault(); tr.click(); }
    var tab = e.target.closest && e.target.closest('[role="tab"][data-t]');
    if (tab && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) { var i = TABS.map(function (x) { return x[0]; }).indexOf(tab.getAttribute('data-t')); i = (i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length; S.tab = TABS[i][0]; render(); var n = document.getElementById('tab-' + S.tab); if (n) n.focus(); }
  });
  document.addEventListener('change', function (e) {
    if (e.target.id === 'camp') { S.selCamp = e.target.value; S.sel = null; render(); }
  });
  document.addEventListener('input', function (e) { if (e.target.id === 'note') S.note = e.target.value; });
  JPK.aboutButton({ button: '#help', title: 'How PDEC Home works', html:
    '<p>Each conference is a Campaign of type Tradeshow/Conference. The people you met are its members.</p>'
    + '<p>Each person is placed at the furthest step they have reached, worked out from Zoho and never typed: <b>Met</b> (on the campaign), <b>In conversation</b> (a call, meeting or note after the event), <b>Opportunity</b> (an open opportunity whose Source Campaign is this conference), <b>Proposal sent</b>, <b>Won</b>.</p>'
    + '<p>Source Campaign is the first conference only. Leave it blank for relationships that did not start at a conference.</p>'
    + '<p>The report tab is for Ed and Nick. Save it as a PDF or open an email from your own address. Nothing is sent from this page, and they see only what you send.</p>' });
  /* Light / dark / follow the device. Remembered per browser; works without storage. */
  function setTheme(v, save) {
    if (v === 'light' || v === 'dark') document.documentElement.setAttribute('data-theme', v); else { v = 'auto'; document.documentElement.removeAttribute('data-theme'); }
    Array.prototype.forEach.call(document.querySelectorAll('#theme [data-th]'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-th') === v)); });
    if (save) { try { localStorage.setItem('pdec-theme', v); } catch (e) { /* storage unavailable */ } }
  }
  document.getElementById('theme').addEventListener('click', function (e) { var b = e.target.closest('[data-th]'); if (b) setTheme(b.getAttribute('data-th'), true); });
  var savedTheme = 'auto'; try { savedTheme = localStorage.getItem('pdec-theme') || 'auto'; } catch (e) { /* storage unavailable */ }
  setTheme(savedTheme, false);
  load();
})();
