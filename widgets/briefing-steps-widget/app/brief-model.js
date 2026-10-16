/* Solicitation briefing steps: pure logic (no DOM, no Zoho). Browser: window.BriefModel. Node: require.
   Solicitations fields read from the live module 16 Oct 2026: Name, Solicitation_Number, Issuing_Agency (lookup), Issuing_Agency_Text,
   Release_Date, Questions_Round_1_Due, Proposal_Due, Anticipated_Award, Anticipated_Start, Briefing_Status (-None- | Not started | Drafted from packet |
   Reviewed by RFP team | Briefed to leadership), Briefed_On, Bid_Decision, Decision_Date, Decision_By, Decision_Rationale, Decision_Conditions,
   Scope_of_Work, Submission_Requirements, Evaluation_Criteria, Key_Requirements_Summary, Owner, Created_By.
   There is no Bid Owner field: the record Owner is treated as the bid owner (see bidOwnerDone). */
(function (root) {
  'use strict';
  var NONE = { '': 1, '-none-': 1, 'none': 1 };
  function clean(v) { var s = v == null ? '' : String(v).trim(); return NONE[s.toLowerCase()] ? '' : s; }
  var RANK = { 'not started': 0, 'drafted from packet': 1, 'reviewed by rfp team': 2, 'briefed to leadership': 3 };
  var BRIEFING_VALUES = { drafted: 'Drafted from packet', reviewed: 'Reviewed by RFP team', briefed: 'Briefed to leadership' };
  var DECISIONS = ['Prime', 'Prime with partners', 'Sub', 'No-Bid - Track', 'No-Bid - Drop'];
  var MAX_RATIONALE = 2000, MAX_CONDITIONS = 2000, MAX_FILE = 20 * 1024 * 1024;
  var PARSERS = [{ value: 'requirements', label: 'Requirements from PDF text', on: true }, { value: 'tables', label: 'Requirement tables from Excel or Word', on: true }, { value: 'header', label: 'Key dates and header fields', on: false }];

  function rank(s) { var k = clean(s).toLowerCase(); return RANK[k] == null ? 0 : RANK[k]; }
  function lk(v) { return v && (v.id || v.name) ? { id: v.id ? String(v.id) : '', name: v.name || '' } : null; }
  function dt(v) { return v ? String(v).slice(0, 16) : ''; }       /* "2026-10-30T14:00:00-05:00" -> "2026-10-30T14:00" for a datetime-local input */
  function dd(v) { return v ? String(v).slice(0, 10) : ''; }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDay(v) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v || ''); return m ? (+m[3]) + ' ' + MONTHS[+m[2] - 1] + ' ' + m[1] : ''; }
  function fmtDue(v) { var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v || ''); if (!m) return ''; var h = +m[4], ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return fmtDay(v) + ', ' + h + ':' + m[5] + ' ' + ap; }

  /* A bid owner field does not exist yet. If one is added as Bid_Owner (user lookup) it is used; until then the Owner counts once it is someone other than whoever created the record. */
  function bidOwner(rec) { return rec.Bid_Owner !== undefined ? lk(rec.Bid_Owner) : lk(rec.Owner); }
  function bidOwnerDone(rec) {
    if (rec.Bid_Owner !== undefined) return !!lk(rec.Bid_Owner);
    var o = lk(rec.Owner), c = lk(rec.Created_By); return !!(o && o.id && (!c || !c.id || c.id !== o.id));
  }

  function normalize(rec, opts) {
    opts = opts || {}; rec = rec || {};
    var agency = (rec.Issuing_Agency && rec.Issuing_Agency.name) || clean(rec.Issuing_Agency_Text);
    var bs = clean(rec.Briefing_Status) || 'Not started', decision = clean(rec.Bid_Decision);
    var o = bidOwner(rec); if (o && !o.name && opts.users) { var f = opts.users.filter(function (u) { return String(u.id) === o.id; })[0]; if (f) o.name = f.name; }
    return {
      id: String(rec.id || ''), name: rec.Name || '', number: clean(rec.Solicitation_Number),
      agency: agency || '', agencyIsLookup: !!(rec.Issuing_Agency && rec.Issuing_Agency.id),
      release: dd(rec.Release_Date), q1: dt(rec.Questions_Round_1_Due), due: dt(rec.Proposal_Due), award: dd(rec.Anticipated_Award), start: dd(rec.Anticipated_Start),
      dueText: fmtDue(rec.Proposal_Due),
      briefing: bs, rank: rank(bs), briefedOn: dd(rec.Briefed_On),
      decision: decision, decided: !!decision && decision.toLowerCase() !== 'pending', rationale: clean(rec.Decision_Rationale), conditions: clean(rec.Decision_Conditions), decisionDate: dd(rec.Decision_Date),
      owner: o, ownerDone: bidOwnerDone(rec), ownerKnown: rec.Bid_Owner !== undefined,
      hasPacket: opts.attachments == null ? null : opts.attachments > 0,
      draft: { scope: clean(rec.Scope_of_Work), submission: clean(rec.Submission_Requirements), evaluation: clean(rec.Evaluation_Criteria), key: clean(rec.Key_Requirements_Summary) }
    };
  }

  /* The five steps, in the order the plan gives. Done is read from the record; a locked step lists which earlier steps it waits for. */
  function steps(s) {
    var packet = s.hasPacket === true || s.rank >= 1;
    var dates = !!(s.agency && s.due);
    var review = s.rank >= 2, decision = s.decided && !!s.rationale;
    return [
      { id: 'packet', label: 'Upload the packet', done: packet, needs: [] },
      { id: 'dates', label: 'Confirm agency and dates', done: dates, needs: ['packet'] },
      { id: 'review', label: 'Review the drafted briefing', done: review, started: s.rank === 1, needs: ['packet', 'dates'] },
      { id: 'decision', label: 'Record the bid decision and rationale', done: decision, started: s.decided || !!s.rationale, needs: ['review'] },
      { id: 'owner', label: 'Assign a bid owner', done: s.ownerDone, needs: ['decision'] }
    ];
  }

  /* Rows for JPK.checkAnswers. */
  function answers(s) {
    return [
      { id: 'agency', label: 'Agency', value: s.agency, missingText: 'Not provided' },
      { id: 'due', label: 'Proposal due', value: s.dueText, missingText: 'Not provided' },
      { id: 'review', label: 'Briefing review', value: s.rank >= 2 ? s.briefing : '', missingText: 'Not reviewed yet' },
      { id: 'decision', label: 'Bid decision', value: s.decided ? s.decision : '', missingText: 'Not recorded' },
      { id: 'rationale', label: 'Decision rationale', value: s.rationale, missingText: 'Not provided' },
      { id: 'owner', label: 'Bid owner', value: s.ownerDone && s.owner ? s.owner.name || 'Assigned' : '', missingText: 'Not assigned' }
    ];
  }
  var SUBMIT_MSG = {
    agency: 'Enter the agency name. Select Add next to Agency.',
    due: 'Enter the proposal due date and time. Select Add next to Proposal due.',
    review: 'Review the drafted briefing and mark it reviewed. Select Add next to Briefing review.',
    decision: 'Choose the bid decision. Select Add next to Bid decision.',
    rationale: 'Enter the reason for the bid decision. Select Add next to Decision rationale.',
    owner: 'Choose who owns this bid. Select Add next to Bid owner.'
  };
  function submitErrors(rows, idPrefix) {
    return rows.filter(function (r) { return r.missing; }).map(function (r) { return { id: (idPrefix || 'cya-') + r.id, message: SUBMIT_MSG[r.id] || ('Complete ' + r.label.toLowerCase() + '.') }; });
  }

  /* ---- validation (USWDS wording: say what to enter, give an example) ---- */
  function validateDates(v) {
    var e = [], day = function (x) { return x ? String(x).slice(0, 10) : ''; };
    if (v.needAgency && !String(v.agency || '').trim()) e.push({ id: 'bd-agency', message: 'Enter the agency name, for example Marinette County.' });
    if (!v.due) e.push({ id: 'bd-due', message: 'Enter the proposal due date and time, for example 10/30/2026 2:00 PM.' });
    var p = day(v.due), r = day(v.release), q = day(v.q1);
    if (r && p && p < r) e.push({ id: 'bd-due', message: 'Proposal due must be on or after the release date (' + fmtDay(r) + ').' });
    if (q && p && q > p) e.push({ id: 'bd-q1', message: 'Questions due must be on or before the proposal due date (' + fmtDay(p) + ').' });
    if (v.award && p && v.award < p) e.push({ id: 'bd-award', message: 'Anticipated award must be on or after the proposal due date (' + fmtDay(p) + ').' });
    if (v.start && v.award && v.start < v.award) e.push({ id: 'bd-start', message: 'Anticipated start must be on or after the anticipated award (' + fmtDay(v.award) + ').' });
    return e;
  }
  function validateDecision(v) {
    var e = [], r = String(v.rationale || '').trim(), c = String(v.conditions || '').trim();
    if (!v.decision || DECISIONS.indexOf(v.decision) < 0) e.push({ id: 'bd-decision', message: 'Choose the bid decision, for example Prime.' });
    if (!r) e.push({ id: 'bd-rationale', message: 'Enter the reason for the decision, for example: Fits our GPS lineup and the county renews in 2027.' });
    else if (r.length > MAX_RATIONALE) e.push({ id: 'bd-rationale', message: 'Shorten the reason to ' + MAX_RATIONALE + ' characters or fewer. It is ' + r.length + ' now.' });
    if (c.length > MAX_CONDITIONS) e.push({ id: 'bd-conditions', message: 'Shorten the conditions to ' + MAX_CONDITIONS + ' characters or fewer. It is ' + c.length + ' now.' });
    return e;
  }
  function validateOwner(v) { return v.to ? [] : [{ id: 'bd-owner', message: 'Choose who owns this bid.' }]; }
  /* file: {name,size}. */
  function validatePacket(file) {
    if (!file) return [{ id: 'bd-file', message: 'Choose the packet file, a .zip or a single PDF, Word or Excel file.' }];
    if (!/\.(zip|pdf|docx|xlsx|xls|csv|txt)$/i.test(file.name || '')) return [{ id: 'bd-file', message: 'Choose a .zip, PDF, Word, Excel, CSV or text file. "' + file.name + '" is not one of these.' }];
    if (file.size > MAX_FILE) return [{ id: 'bd-file', message: 'Choose a file under 20 MB. This one is ' + Math.round(file.size / 1048576 * 10) / 10 + ' MB. Put larger packets in SharePoint and attach them later.' }];
    return [];
  }

  /* ---- payloads: only these fields are ever written ---- */
  function zdt(v, offsetMin) { /* "2026-10-30T14:00" + offset minutes east of UTC -> "2026-10-30T14:00:00-05:00" */
    if (!v) return null; var a = Math.abs(offsetMin), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return String(v).slice(0, 16) + ':00' + (offsetMin >= 0 ? '+' : '-') + p(Math.floor(a / 60)) + ':' + p(a % 60);
  }
  function datesPayload(id, v, offsetMin) {
    var d = { id: String(id), Proposal_Due: zdt(v.due, offsetMin), Release_Date: v.release || null, Questions_Round_1_Due: v.q1 ? zdt(v.q1, offsetMin) : null, Anticipated_Award: v.award || null, Anticipated_Start: v.start || null };
    if (v.needAgency && v.agency) d.Issuing_Agency_Text = String(v.agency).trim();
    return d;
  }
  function reviewedPayload(id) { return { id: String(id), Briefing_Status: BRIEFING_VALUES.reviewed }; }
  function decisionPayload(id, v, userId, today) {
    var d = { id: String(id), Bid_Decision: v.decision, Decision_Rationale: String(v.rationale).trim(), Decision_Date: today };
    if (String(v.conditions || '').trim()) d.Decision_Conditions = String(v.conditions).trim();
    if (userId) d.Decision_By = { id: String(userId) };
    return d;
  }
  function ownerPayload(id, userId) { return { id: String(id), Owner: { id: String(userId) } }; }
  function briefedPayload(id, today) { return { id: String(id), Briefing_Status: BRIEFING_VALUES.briefed, Briefed_On: today }; }

  function normalizeUsers(list) {
    return (list || []).filter(function (u) { return u && u.id && (u.status == null || /^active$/i.test(u.status)); })
      .map(function (u) { return { id: String(u.id), name: u.full_name || u.name || u.email || 'Unknown user', profile: (u.profile && u.profile.name) || '' }; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  var api = { clean: clean, rank: rank, normalize: normalize, steps: steps, answers: answers, submitErrors: submitErrors, validateDates: validateDates, validateDecision: validateDecision, validateOwner: validateOwner, validatePacket: validatePacket,
    zdt: zdt, datesPayload: datesPayload, reviewedPayload: reviewedPayload, decisionPayload: decisionPayload, ownerPayload: ownerPayload, briefedPayload: briefedPayload, normalizeUsers: normalizeUsers,
    bidOwnerDone: bidOwnerDone, fmtDay: fmtDay, fmtDue: fmtDue, DECISIONS: DECISIONS, PARSERS: PARSERS, BRIEFING_VALUES: BRIEFING_VALUES, MAX_RATIONALE: MAX_RATIONALE, MAX_FILE: MAX_FILE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BriefModel = api;
})(typeof window !== 'undefined' ? window : this);
