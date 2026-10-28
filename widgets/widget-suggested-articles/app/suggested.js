/* suggested.js v1.0 (S44, 28 Oct 2026): "Suggested articles" panel on a Case (related-list widget).
   Reads Published Knowledge Articles, shows the top 3 for this case, and lets the agent mark which one solved it. */
(function (root) {
  'use strict';
  var M = root.SAModel;
  var $ = function (s) { return document.querySelector(s); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var S = { caseId: '', c: null, articles: [], used: null, msg: '', err: false, demo: false };

  function resize() { try { if (root.ZOHO && ZOHO.CRM && ZOHO.CRM.UI && ZOHO.CRM.UI.Resize) ZOHO.CRM.UI.Resize({ height: String(Math.ceil(document.documentElement.scrollHeight) + 4), width: '100%' }); } catch (e) {} }
  function norm(r) { return { id: String(r.id), no: r.Article_No || '', title: r.Name || '(untitled)', type: r.Article_Type || '', vendor: r.Vendor || '', device: r.Device || '', topic: r.Topic || '', symptom: r.Symptom_Trigger || '', steps: r.Steps || '', safe: r.Customer_safe === true || r.Customer_safe === 'true' }; }
  function say(m, err) { S.msg = m; S.err = !!err; paint(); }

  function card(x) {
    var a = x.a, used = S.used && S.used.id === a.id;
    var meta = [a.no, a.vendor, a.device].filter(Boolean).join(' · ');
    return '<div class="item' + (used ? ' used' : '') + '" data-id="' + esc(a.id) + '"><p class="t">' + esc(a.title) + '</p><div class="m">' + esc(meta) + '</div>' +
      '<div class="why">Why: ' + esc(x.why.join(', ') || 'general match') + '</div><div class="row">' +
      '<button type="button" class="btn pri" data-act="use" data-id="' + esc(a.id) + '"' + (used ? ' disabled' : '') + '>' + (used ? 'Used on this case' : 'Use on this case') + '</button>' +
      '<button type="button" class="btn" data-act="open" data-id="' + esc(a.id) + '">Open article</button>' +
      (a.safe ? '<span class="chip ok">Customer-safe reply</span>' : '') + '</div></div>';
  }
  function paint() {
    var c = S.c; if (!c) return;
    var top = M.suggest(S.articles, c, 3);
    var h = '<div class="hd"><h2>Suggested articles</h2><span class="m">' + esc(c.vendor ? 'Vendor: ' + c.vendor : 'No vendor set on the case') + (c.category ? ' · ' + esc(c.category) : '') + '</span></div>';
    if (S.used) h += '<div class="item used"><p class="t">Resolved with: ' + esc(S.used.no) + ' ' + esc(S.used.title) + '</p><div class="row"><button type="button" class="btn" data-act="open" data-id="' + esc(S.used.id) + '">Open article</button><button type="button" class="btn" data-act="clear">Remove</button></div></div>';
    h += top.length ? top.map(card).join('') : '<div class="empty">No published article matches this case yet.' + (c.vendor ? '' : ' Setting the Vendor on the case improves matches.') + '</div>';
    h += '<div class="foot"><button type="button" class="btn" data-act="draft">Nothing fits: start a draft article</button>' + (S.msg ? '<span class="msg' + (S.err ? ' err' : '') + '" role="status">' + esc(S.msg) + '</span>' : '') + '</div>';
    $('#sa').innerHTML = h; resize();
  }

  function zUse(id) {
    if (S.demo) { return Promise.resolve(); }
    return ZOHO.CRM.API.updateRecord({ Entity: 'Cases', APIData: { id: S.caseId, Resolved_With_Article: id === null ? null : { id: id } }, Trigger: [] }).then(function (res) {
      var d = res && res.data && res.data[0]; if (!d || d.code !== 'SUCCESS') throw new Error((d && d.message) || 'Zoho did not save the change');
    });
  }
  function act(e) {
    var b = e.target.closest('[data-act]'); if (!b) return;
    var a = b.getAttribute('data-act'), id = b.getAttribute('data-id');
    if (a === 'use') {
      var art = S.articles.filter(function (x) { return x.id === id; })[0];
      b.disabled = true;
      zUse(id).then(function () { S.used = art; say('Saved. This case now shows ' + art.no + ' as what solved it.'); }, function (err) { b.disabled = false; say('Could not save: ' + (err.message || err), true); });
    } else if (a === 'clear') {
      zUse(null).then(function () { S.used = null; say('Removed.'); }, function (err) { say('Could not remove: ' + (err.message || err), true); });
    } else if (a === 'open') {
      if (S.demo) { say('Opens the article when running inside Zoho'); return; }
      ZOHO.CRM.UI.Record.open({ Entity: 'Knowledge_Articles', RecordID: id });
    } else if (a === 'draft') {
      if (S.demo) { say('Opens a new article form when running inside Zoho'); return; }
      var c = S.c, rec = { Name: c.subject, Symptom_Trigger: c.subject, Article_Type: 'Troubleshooting', Status: 'Draft' };
      if (c.vendor) rec.Vendor = c.vendor;
      ZOHO.CRM.UI.Record.create({ Entity: 'Knowledge_Articles', RecordData: rec }).then(function () {}, function (err) { say('Could not open the form: ' + (err && err.message || err), true); });
    }
  }

  function loadArticles() {
    var f = 'id,Name,Article_No,Article_Type,Vendor,Device,Topic,Symptom_Trigger,Steps,Customer_safe';
    var out = [];
    function page(off) { return ZOHO.CRM.API.coql({ select_query: 'select ' + f + " from Knowledge_Articles where Status = 'Published' limit " + off + ', 200' }).then(function (res) { var r = (res && res.data) || []; out = out.concat(r); if (res && res.info && res.info.more_records && out.length < 1000) return page(off + 200); }); }
    return page(0).then(function () { return out.map(norm); });
  }
  function start(d) {
    var id = Array.isArray(d.EntityId) ? d.EntityId[0] : d.EntityId; S.caseId = String(id);
    ZOHO.CRM.API.getRecord({ Entity: 'Cases', RecordID: id }).then(function (res) {
      var r = res && res.data && res.data[0]; if (!r) throw new Error('The case could not be read');
      S.c = { subject: r.Subject || '', description: r.Description || '', category: r.Case_Category || '', vendor: M.mapVendor(r.Vendor && r.Vendor.name) };
      var ra = r.Resolved_With_Article; return loadArticles().then(function (arts) {
        S.articles = arts; S.used = ra && ra.id ? (arts.filter(function (x) { return x.id === String(ra.id); })[0] || { id: String(ra.id), no: '', title: ra.name || 'Article' }) : null; paint();
      });
    }).catch(function (err) { $('#sa').innerHTML = '<div class="empty">Could not load suggestions. ' + esc(err && (err.message || err.code) || '') + '</div>'; resize(); });
  }
  document.addEventListener('click', act);
  if (root.ZOHO && ZOHO.embeddedApp) {
    var got = false;
    ZOHO.embeddedApp.on('PageLoad', function (d) { got = true; start(d || {}); });
    ZOHO.embeddedApp.init();
    setTimeout(function () { if (!got) demo(); }, 2500);
  } else { demo(); }
  function demo() {
    S.demo = true; S.caseId = 'demo';
    S.c = { subject: 'No GPS location after enrollment on PureOne', description: '', category: 'Device Troubleshooting', vendor: 'SuperCom' };
    S.articles = (root.SA_DEMO || []).map(norm); paint();
  }
  root.SA = { state: S };
})(window);
