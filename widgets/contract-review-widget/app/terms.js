/* Contract terms panel (related-list widget on Accounts). Phase 4, 27 Sep 2026.
   Reads live - no rollup fields: the Account's Contracts, the current Rate_Lines of the primary
   contract, and its Confirmed / Proposed Contract_Clauses (via the denormalised Account lookup). */
(function () {
  'use strict';
  var api = CI.api, H = CI.H, esc = H.esc;
  var app = document.getElementById('app');
  var S = {};

  api.init().then(function (b) {
    S.accountId = b.id;
    return Promise.all([api.accountContracts(b.id), api.accountClauses(b.id)]);
  }).then(function (r) {
    S.contracts = r[0]; S.clauses = r[1];
    var live = S.contracts.filter(function (c) { return ['Ended', 'Ending - No Renewal'].indexOf(c.Contract_Status) < 0; });
    S.primary = (live.length ? live : S.contracts)[0];
    if (!S.primary) return null;
    return api.contract(S.primary.id).then(function (full) { S.full = full; });
  }).then(render).catch(function (e) {
    app.innerHTML = '<div class="empty">Could not load contract terms: ' + esc(H.errText(e)) + '</div>'; fit();
  });

  function fit() { setTimeout(function () { api.resize(document.documentElement.scrollHeight + 4); }, 30); }

  function currentLines(rows) {
    var best = {};
    (rows || []).forEach(function (r) {
      var st = H.rateState(r); if (st === 'superseded' || st === 'rejected') return;
      var k = H.rateKey(r).split('|').slice(0, 3).join('|');
      if (!best[k] || String(r.Effective_Date || '') > String(best[k].Effective_Date || '')) best[k] = r;
    });
    return Object.keys(best).map(function (k) { return best[k]; }).sort(function (a, b) {
      return String(a.Rate_Device).localeCompare(String(b.Rate_Device)) || (Number(a.Tier_Min_Units) || 0) - (Number(b.Tier_Min_Units) || 0);
    });
  }
  function expiryChip(c) {
    if (!c.Contract_End_Date) return '<span class="chip muted">No end date</span>';
    var d = H.days(H.today(), c.Contract_End_Date);
    if (d < 0) return '<span class="chip muted">Ended ' + esc(H.date(c.Contract_End_Date)) + '</span>';
    var cls = d <= 30 ? 'bad' : d <= 90 ? 'warn' : 'good';
    return '<span class="chip ' + cls + '">' + d + ' days left</span>';
  }
  function ingestChip(s) {
    if (s === 'Ingested') return '<span class="chip good">Verified</span>';
    if (s === 'Needs Review') return '<span class="chip new">Needs review</span>';
    if (s === 'Failed') return '<span class="chip bad">Ingest failed</span>';
    return '<span class="chip muted">Not ingested</span>';
  }

  function render() {
    if (!S.primary) {
      app.innerHTML = '<div class="empty">No contracts on this account yet. Use <b>New Contract from Packet</b> to create one from the signed packet.</div>';
      return fit();
    }
    var c = Object.assign({}, S.primary, S.full || {});
    var start = c.Contract_Start_Date, end = c.Contract_End_Date, pct = 0;
    if (start && end) pct = Math.min(100, Math.max(0, H.days(start, H.today()) * 100 / Math.max(1, H.days(start, end))));
    var term = '<h4>Term</h4>' + (start || end ?
      '<div class="term" aria-hidden="true"><div class="done" style="width:' + pct + '%"></div><div class="now" style="left:calc(' + pct + '% - 1px)"></div></div>' +
      '<div class="term-lbl num"><span>' + esc(H.date(start) || '?') + '</span><span>' + esc(H.date(end) || '?') + '</span></div>' : '<div class="none">No term dates</div>') +
      '<dl class="kv">' +
      kv('Auto-renews', c.Auto_Renews) + kv('Original end', H.date(c.Original_End_Date)) +
      kv('Renewals allowed', H.blank(c.Renewals_Allowed) ? '' : c.Renewals_Allowed + (H.blank(c.Renewal_Option_Length_Mo) ? '' : ' x ' + c.Renewal_Option_Length_Mo + ' months')) +
      kv('Renewals left', c.Renewal_Options_Left) + kv('End after 1 renewal', H.date(c.End_After_1_Renewal)) +
      kv('End with all renewals', H.date(c.Final_End_Date)) +
      kv('Notice', H.blank(c.Notice_Period_Days) ? '' : c.Notice_Period_Days + ' days' + (c.Notice_Deadline ? ' · by ' + H.date(c.Notice_Deadline) : '')) +
      kv('Last verified', H.date(c.Last_Verified)) + '</dl>';

    var lines = currentLines(c.Rate_Lines);
    var basis = c.Rate_Basis ? '<span class="chip teal">' + esc(c.Rate_Basis) + (c.Admin_Rate_Pct != null && c.Admin_Rate_Pct !== '' ? ' + ' + esc(c.Admin_Rate_Pct) + '%' : '') + '</span>' : '<span class="chip muted">Rate basis not set</span>';
    var pricing = '<h4>Current pricing</h4>' + basis +
      (lines.length ? '<table class="t" style="margin-top:8px"><tbody>' + lines.map(function (r) {
        var a = Number(r.Tier_Min_Units) || 0, b = Number(r.Tier_Max_Units) || 0;
        var tier = !a && !b ? '' : ' <small style="color:var(--muted)">' + (b ? a + '–' + b : a + '+') + '</small>';
        var src = r.Source_Ref ? 'per ' + H.cite(r.Source_Ref).replace(/\.pdf|\.docx?|\.xlsx/i, '') : 'hand-entered';
        return '<tr><td>' + esc(r.Rate_Device) + tier + '<br><small style="color:var(--muted)">' + esc(src) + (r.Effective_Date ? ', eff. ' + esc(H.date(r.Effective_Date)) : '') + '</small></td>' +
          '<td class="r num"><b>' + H.money(r.Rate_Daily_Amount) + '</b>' + (H.rateState(r) === 'verified' ? ' <span title="Line verified" style="color:var(--good)">✓</span>' : '') + '</td></tr>';
      }).join('') + '</tbody></table>' : '<p class="none" style="color:var(--muted)">No rate lines.</p>');

    var mine = S.clauses.filter(function (k) { return k.Contract && String(k.Contract.id) === String(c.id); });
    var conf = S.clauses.filter(function (k) { return k.Status === 'Confirmed'; });
    var prop = mine.filter(function (k) { return k.Status === 'Proposed'; }).length;
    var upcoming = conf.slice().sort(function (a, b) { return String(a.Due_Date || '9999').localeCompare(String(b.Due_Date || '9999')); }).slice(0, 4);
    var obl = '<h4>Obligations</h4><div class="big num">' + conf.length + '</div><div style="color:var(--muted);font-size:12px;margin-bottom:8px">confirmed across this account’s contracts</div>' +
      (upcoming.length ? '<ul class="obl">' + upcoming.map(function (k) {
        return '<li>' + esc(k.Title) + '<small>' + esc([k.Clause_Type, k.Cadence, k.Due_Date ? 'due ' + H.date(k.Due_Date) : ''].filter(Boolean).join(' · ')) + '</small></li>';
      }).join('') + '</ul>' : '') +
      (prop ? '<p style="margin:8px 0 0"><span class="chip new">' + prop + ' proposed</span> awaiting review</p>' : '');

    var others = S.contracts.filter(function (x) { return x.id !== c.id; });
    var html = '<div class="cards"><div class="ccard"><div class="hd"><div class="nm">' + esc(c.Name) +
      '<small>' + esc([c.Counterparty_Type, c.Contract_Status].filter(Boolean).join(' · ')) + '</small></div>' +
      expiryChip(c) + ingestChip(c.Ingest_Status) +
      (c.Ingest_Status === 'Needs Review' ? '<button class="btn sm primary" data-open="' + esc(c.id) + '">Review</button>' : '<button class="btn sm" data-open="' + esc(c.id) + '">Open contract</button>') +
      '</div><div class="bd"><div>' + term + '</div><div>' + pricing + '</div><div>' + obl + '</div></div></div></div>';
    if (others.length) {
      html += '<details class="others"><summary>' + others.length + ' other contract' + (others.length === 1 ? '' : 's') + '</summary><table class="t" style="margin-top:6px"><tbody>' +
        others.map(function (x) {
          return '<tr><td><button class="btn link sm" data-open="' + esc(x.id) + '">' + esc(x.Name) + '</button><br><small style="color:var(--muted)">' + esc([x.Counterparty_Type, x.Contract_Status].filter(Boolean).join(' · ')) + '</small></td>' +
            '<td class="num">' + esc(H.date(x.Contract_Start_Date)) + ' → ' + esc(H.date(x.Contract_End_Date)) + '</td><td>' + ingestChip(x.Ingest_Status) + '</td></tr>';
        }).join('') + '</tbody></table></details>';
    }
    app.innerHTML = html;
    app.querySelector('.others') && app.querySelector('.others').addEventListener('toggle', fit);
    fit();
  }
  function kv(k, v) { return H.blank(v) ? '' : '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>'; }

  app.addEventListener('click', function (e) {
    var b = e.target.closest('[data-open]'); if (b) api.openRecord('Contracts', b.getAttribute('data-open'));
  });
})();
