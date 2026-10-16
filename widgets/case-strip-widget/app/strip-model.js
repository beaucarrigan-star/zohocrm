/* Case strip: pure logic (no DOM, no Zoho). Browser: window.StripModel. Node: require.
   Field API names read from the live Cases module on 16 Oct 2026:
   Owner (ownerlookup), Status, Handling_Team (picklist), Due_By (datetime), Next_Action (text), Waiting_On (picklist), Created_Time, Subject, Case_Number. */
(function (root) {
  'use strict';
  var NONE = { '': 1, '-none-': 1, 'none': 1 };
  function clean(v) { var s = v == null ? '' : String(v).trim(); return NONE[s.toLowerCase()] ? '' : s; }
  function J() { return root.JPK && root.JPK.model; }

  /* Users come back from Zoho as {id, full_name, email, status, profile:{name}}. Owner on a case is {id} only, so names are resolved here. */
  function normalizeUsers(list) {
    return (list || []).filter(function (u) { return u && u.id && (u.status == null || /^active$/i.test(u.status)); })
      .map(function (u) { return { id: String(u.id), name: u.full_name || u.name || u.email || 'Unknown user', email: u.email || '', profile: (u.profile && u.profile.name) || '' }; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
  }
  function userName(users, id) { var f = (users || []).filter(function (u) { return String(u.id) === String(id); })[0]; return f ? f.name : ''; }

  /* rec: raw Cases record. opts: {users, now, model}. model defaults to JPK.model (needs caseDue/ownerState/caseBucket). */
  function normalizeCase(rec, opts) {
    opts = opts || {}; var m = opts.model || J(); rec = rec || {};
    var ownerId = rec.Owner && rec.Owner.id ? String(rec.Owner.id) : '';
    var ownerName = (rec.Owner && rec.Owner.name) || userName(opts.users, ownerId);
    var waiting = clean(rec.Waiting_On) || 'Nobody';
    var opened = rec.Created_Time || '';
    var dueRaw = rec.Due_By ? String(rec.Due_By).slice(0, 10) : '';
    var paused = /^(vendor|customer|internal)$/i.test(waiting);
    var due = null, source = '';
    if (paused) { source = 'paused'; }
    else if (dueRaw) { due = dueRaw; source = 'due-by'; }
    else if (opened && m) { var c = m.caseDue({ opened: opened, waitingOn: waiting }); if (c.due) { due = c.dueText; source = 'computed'; } }
    var b = m ? m.caseBucket(rec.Status || '') : { open: true, label: rec.Status || '' };
    return {
      id: String(rec.id || ''), subject: rec.Subject || '', number: rec.Case_Number || '', status: rec.Status || '', statusLabel: b.label, open: b.open, otherOpen: b.label === 'Other open',
      owner: ownerId ? { id: ownerId, name: ownerName || 'Unknown user' } : null,
      team: clean(rec.Handling_Team), waitingOn: waiting, due: due, dueSource: source, pausedReason: paused ? 'Due date paused while waiting on ' + waiting.toLowerCase() : '',
      next: clean(rec.Next_Action) ? { text: clean(rec.Next_Action) } : null, opened: opened
    };
  }

  /* ---- writes the strip may make (plan section 3). Pure builders so they are testable. ---- */
  function takePayload(caseId, userId) { return { id: String(caseId), Owner: { id: String(userId) } }; }
  function assignPayload(caseId, userId) { return { id: String(caseId), Owner: { id: String(userId) } }; }

  var MAX_REASON = 200;
  /* USWDS-style messages: say what to enter and give an example. ids match the field ids so the summary can link to them. */
  function validateHandoff(v, ids) {
    ids = ids || { to: 'ho-to', reason: 'ho-reason' };
    var errs = [];
    if (!v || !v.to) errs.push({ id: ids.to, message: 'Choose who the case is going to.' });
    else if (v.from && String(v.from) === String(v.to)) errs.push({ id: ids.to, message: 'Choose someone other than the current owner.' });
    var r = v && v.reason ? String(v.reason).trim() : '';
    if (!r) errs.push({ id: ids.reason, message: 'Enter one line on why, for example: Customer needs the vendor RMA number.' });
    else if (r.length > MAX_REASON) errs.push({ id: ids.reason, message: 'Shorten the reason to ' + MAX_REASON + ' characters or fewer. It is ' + r.length + ' now.' });
    else if (/[\r\n]/.test(r)) errs.push({ id: ids.reason, message: 'Keep the reason to one line.' });
    return errs;
  }
  /* The Note that records why ownership moved. */
  function handoffNote(h) {
    return { Title: 'Handoff: ' + (h.fromName || 'Unassigned') + ' to ' + h.toName, Content: String(h.reason).trim() + '\n\nHanded off by ' + (h.byName || 'unknown') + '.' };
  }

  var api = { clean: clean, normalizeUsers: normalizeUsers, userName: userName, normalizeCase: normalizeCase, takePayload: takePayload, assignPayload: assignPayload,
    validateHandoff: validateHandoff, handoffNote: handoffNote, MAX_REASON: MAX_REASON };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.StripModel = api;
})(typeof window !== 'undefined' ? window : this);
