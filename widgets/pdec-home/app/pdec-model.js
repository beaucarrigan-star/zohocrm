/* PDEC Home model: pure functions, no Zoho calls. Works in the browser (window.PdecModel) and in node (module.exports). */
(function (root) {
  'use strict';
  var STAGES = ['Met', 'In conversation', 'Opportunity', 'Proposal sent', 'Won'];
  var PROPOSAL = ['Proposal Submitted', 'Budget Proposal', 'Contract Negotiation', 'County/Board Approval', 'Contract and Credentialing'];
  var WON = ['Closed Won'];
  var LOST = ['Closed Lost', 'Closed Lost to Competition', 'Dead'];
  var DAY = 86400000;

  function t(d) { var x = d ? new Date(d).getTime() : NaN; return isNaN(x) ? null : x; }
  function num(v) { v = Number(v); return isFinite(v) ? v : 0; }
  function isWon(d) { return WON.indexOf(d.Stage) >= 0; }
  function isLost(d) { return LOST.indexOf(d.Stage) >= 0; }
  function isOpen(d) { return !isWon(d) && !isLost(d); }
  function isProposal(d) { return PROPOSAL.indexOf(d.Stage) >= 0; }
  function refId(r) { return r && typeof r === 'object' ? r.id : r || null; }

  /* Stage for one person at one conference. Worked out from records, never typed. */
  function stageFor(contactId, camp, touches, deals) {
    var start = t(camp.Conference_Start_Date || camp.Start_Date);
    var mine = deals.filter(function (d) { return refId(d.Contact_Name) === contactId && refId(d.Source_Campaign) === camp.id; });
    if (mine.some(isWon)) return 4;
    if (mine.some(function (d) { return isOpen(d) && isProposal(d); })) return 3;
    if (mine.some(isOpen)) return 2;
    var talked = touches.some(function (x) { return x.contactId === contactId && (start == null || t(x.date) > start); });
    return talked ? 1 : 0;
  }

  function funnel(camp, members, touches, deals) {
    var counts = [0, 0, 0, 0, 0], cdeals = deals.filter(function (d) { return refId(d.Source_Campaign) === camp.id; });
    members.forEach(function (m) { var s = stageFor(m.id, camp, touches, deals); for (var i = 0; i <= s; i++) counts[i]++; });
    /* an opportunity can exist for a person not on the member list: count it so nothing is hidden */
    var memberIds = {}; members.forEach(function (m) { memberIds[m.id] = 1; });
    var orphan = cdeals.filter(function (d) { return !refId(d.Contact_Name) || !memberIds[refId(d.Contact_Name)]; }).length;
    var won = cdeals.filter(isWon), revenue = won.reduce(function (s, d) { return s + num(d.Services_Revenue); }, 0);
    var cost = num(camp.Total_Event_Cost) || ['Registration_Cost', 'Exhibitor_Cost', 'Travel_Cost', 'Sponsorship_Cost', 'Lodging_Cost', 'Shipping_Cost'].reduce(function (s, k) { return s + num(camp[k]); }, 0);
    var opps = cdeals.length;
    return {
      id: camp.id, name: camp.Campaign_Name, start: camp.Conference_Start_Date || camp.Start_Date || null, status: camp.Status || null,
      role: camp.Speaking_or_Training_Opportunity ? 'Presenting' : 'Attending',
      met: counts[0], conversation: counts[1], opportunity: counts[2], proposal: counts[3], won: counts[4],
      opportunitiesTotal: opps, orphanOpportunities: orphan, wonCount: won.length, revenue: revenue, cost: cost,
      costPerPerson: counts[0] ? cost / counts[0] : null, costPerOpportunity: opps ? cost / opps : null,
      revenuePerDollar: cost ? revenue / cost : null
    };
  }

  function totals(rows) {
    var z = { met: 0, conversation: 0, opportunity: 0, proposal: 0, won: 0, opportunitiesTotal: 0, wonCount: 0, revenue: 0, cost: 0 };
    rows.forEach(function (r) { Object.keys(z).forEach(function (k) { z[k] += num(r[k]); }); });
    z.costPerOpportunity = z.opportunitiesTotal ? z.cost / z.opportunitiesTotal : null;
    z.revenuePerDollar = z.cost ? z.revenue / z.cost : null;
    return z;
  }

  /* Days from the conference to the first opportunity and to the first win, per conference, then the median. */
  function lag(camp, deals) {
    var start = t(camp.Conference_Start_Date || camp.Start_Date); if (start == null) return { firstOpp: null, firstWin: null };
    var mine = deals.filter(function (d) { return refId(d.Source_Campaign) === camp.id; });
    var created = mine.map(function (d) { return t(d.Created_Time); }).filter(Boolean).sort();
    var wins = mine.filter(isWon).map(function (d) { return t(d.Closing_Date) || t(d.Stage_Modified_Time); }).filter(Boolean).sort();
    return { firstOpp: created.length ? Math.round((created[0] - start) / DAY) : null, firstWin: wins.length ? Math.round((wins[0] - start) / DAY) : null };
  }

  function byService(deals, field) {
    var out = {};
    deals.forEach(function (d) {
      var v = d[field]; var list = Array.isArray(v) ? v : (v ? [v] : ['Not set']); if (!list.length) list = ['Not set'];
      list.forEach(function (k) { var o = out[k] || (out[k] = { key: k, opportunities: 0, won: 0, revenue: 0 }); o.opportunities++; if (isWon(d)) { o.won++; o.revenue += num(d.Services_Revenue); } });
    });
    return Object.keys(out).map(function (k) { return out[k]; }).sort(function (a, b) { return b.opportunities - a.opportunities; });
  }

  /* One column of events for one person: conferences, notes and activities, opportunity steps. Newest last. */
  function journey(contactId, camps, memberships, notes, activities, deals) {
    var ev = [];
    camps.forEach(function (c) {
      var m = (memberships[c.id] || []).filter(function (x) { return x.id === contactId; })[0];
      if (m) ev.push({ date: c.Conference_Start_Date || c.Start_Date, kind: 'conference', title: c.Campaign_Name, detail: m.status || 'Member' });
    });
    notes.forEach(function (n) { ev.push({ date: n.Created_Time, kind: 'note', title: n.Note_Title || 'Note', detail: n.Note_Content || '' }); });
    activities.forEach(function (a) { ev.push({ date: a.date, kind: a.kind || 'activity', title: a.title || a.kind || 'Activity', detail: a.detail || '' }); });
    deals.filter(function (d) { return refId(d.Contact_Name) === contactId; }).forEach(function (d) {
      ev.push({ date: d.Created_Time, kind: 'opportunity', title: 'Opportunity opened: ' + d.Deal_Name, detail: [].concat(d.PDEC_Service_Type || []).join(', ') + (d.PDEC_Topic ? ' · ' + d.PDEC_Topic : '') });
      if (d.Stage_Modified_Time && d.Stage_Modified_Time !== d.Created_Time) ev.push({ date: d.Stage_Modified_Time, kind: isWon(d) ? 'won' : 'stage', title: 'Stage: ' + d.Stage, detail: d.Deal_Name });
    });
    return ev.filter(function (e) { return t(e.date) != null; }).sort(function (a, b) { return t(a.date) - t(b.date); });
  }

  function money(n) { return n == null ? 'n/a' : '$' + Math.round(n).toLocaleString('en-US'); }
  function pct(a, b) { return b ? Math.round(100 * a / b) + '%' : 'n/a'; }

  /* Rows for the report to Ed and Nick. Same rows feed the PDF view, the email text and the home tiles. */
  function report(rows, deals, periodLabel) {
    var tt = totals(rows);
    var open = deals.filter(isOpen);
    return {
      period: periodLabel,
      lines: [
        ['People met at conferences', String(tt.met)],
        ['In conversation afterwards', tt.conversation + ' (' + pct(tt.conversation, tt.met) + ')'],
        ['Opportunities from conferences', String(tt.opportunitiesTotal)],
        ['Proposals sent', String(tt.proposal)],
        ['Won', tt.wonCount + ' (' + money(tt.revenue) + ')'],
        ['Conference cost', money(tt.cost)],
        ['Cost per opportunity', money(tt.costPerOpportunity)],
        ['Open PDEC opportunities', String(open.length)]
      ],
      totals: tt
    };
  }
  function emailText(rep, note) {
    return ['Ed and Nick,', '', 'Here is the PDEC report for ' + rep.period + '.' + (note ? ' ' + note : ''), ''].concat(
      rep.lines.map(function (l) { return l[0] + ': ' + l[1]; })).concat(['', 'Miranda']).join('\n');
  }

  var api = { STAGES: STAGES, PROPOSAL: PROPOSAL, WON: WON, LOST: LOST, stageFor: stageFor, funnel: funnel, totals: totals, lag: lag, byService: byService, journey: journey, report: report, emailText: emailText, money: money, pct: pct, isOpen: isOpen, isWon: isWon };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PdecModel = api;
})(typeof window !== 'undefined' ? window : this);
