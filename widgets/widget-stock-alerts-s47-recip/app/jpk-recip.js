/* jpk-recip v1.0.0 (S47, 30 Oct 2026) - multi-select "To" picker for the stock alert emails.
   Turns an existing To field (input or textarea holding comma-separated addresses) into a dropdown:
   chips for the people already on the email, a search box, and a checklist grouped
   "At this customer" (the account's contacts with an email) and "JusticePoint" (active CRM users).
   An address that is not in the list can still be typed and added with Enter or a comma.
   The original field stays in the page (hidden) and always holds the comma-separated list, and an
   "input" event fires on it after every change, so the host's own read, check and send code is untouched.

   JPKRecip.mount(field, { load: function () { return Promise.resolve([{ email, name, group }]) } })
   JPKRecip.auto(selector, function (field) { return { load: ... } })   mounts on every matching field, now and later. */
(function () {
  'use strict';
  if (window.JPKRecip) return;
  var GROUPS = ['At this customer', 'JusticePoint', 'Other'];
  var EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
  var uid = 0;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function split(raw) { return String(raw || '').split(/[,;\n]+/).map(function (x) { return x.trim(); }).filter(Boolean); }
  function low(s) { return String(s || '').toLowerCase(); }

  var css = '' +
    '.jr{position:relative;font:inherit}' +
    '.jr-box{display:flex;flex-wrap:wrap;align-items:center;gap:4px;min-height:34px;padding:3px 6px;cursor:text;' +
      'background:var(--surface,#fff);color:var(--ink,#1d2526);border:1px solid var(--line-strong,#b9c3c5);border-radius:var(--radius-sm,6px)}' +
    '.jr-box:focus-within{outline:2px solid var(--focus,var(--accent,#1f6f7a));outline-offset:1px}' +
    '.jr.err .jr-box{border-color:var(--bad,#b3261e)}' +
    '.jr-chip{display:inline-flex;align-items:center;gap:2px;max-width:100%;padding:1px 2px 1px 8px;border-radius:999px;font-size:.92em;' +
      'background:color-mix(in srgb,currentColor 9%,transparent);border:1px solid color-mix(in srgb,currentColor 22%,transparent)}' +
    '.jr-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.jr-chip.bad{border-color:var(--bad,#b3261e);color:var(--bad,#b3261e)}' +
    '.jr-chip button{all:unset;cursor:pointer;width:20px;height:20px;line-height:20px;text-align:center;border-radius:50%;font-size:14px;color:inherit;opacity:.75}' +
    '.jr-chip button:hover,.jr-chip button:focus-visible{background:color-mix(in srgb,currentColor 18%,transparent);color:inherit}' +
    '.jr-in{flex:1 1 140px;min-width:120px;border:0!important;outline:0!important;background:transparent!important;color:inherit;font:inherit;padding:4px 2px!important;box-shadow:none!important}' +
    '.jr-tog{all:unset;cursor:pointer;padding:0 6px;color:var(--muted,#5b6668);font-size:12px}' +
    '.jr-list{position:absolute;z-index:50;left:0;right:0;top:calc(100% + 2px);max-height:260px;overflow:auto;margin:0;padding:4px 0;list-style:none;' +
      'background:var(--surface,#fff);color:var(--ink,#1d2526);border:1px solid var(--line-strong,#b9c3c5);border-radius:var(--radius-sm,6px);box-shadow:0 6px 18px rgba(0,0,0,.18)}' +
    '.jr-list[hidden]{display:none}' +
    '.jr-g{padding:6px 10px 2px;font-size:.78em;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--muted,#5b6668)}' +
    '.jr-o{display:flex;gap:8px;align-items:baseline;padding:5px 10px;cursor:pointer}' +
    '.jr-o.act,.jr-o:hover{background:color-mix(in srgb,currentColor 8%,transparent)}' +
    '.jr-o .ck{flex:0 0 14px;text-align:center;font-weight:700;color:var(--accent,#1f6f7a)}' +
    '.jr-o .nm{font-weight:500}' +
    '.jr-o .em{color:var(--muted,#5b6668);font-size:.9em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.jr-none{padding:6px 10px;color:var(--muted,#5b6668);font-size:.9em}' +
    '.jr-sum{margin-top:2px;font-size:.85em;color:var(--muted,#5b6668)}';

  function addCss() {
    if (document.getElementById('jpk-recip-css')) return;
    var s = document.createElement('style'); s.id = 'jpk-recip-css'; s.textContent = css; document.head.appendChild(s);
  }

  function mount(field, opts) {
    if (!field || field.getAttribute('data-recip')) return null;
    addCss(); opts = opts || {};
    var id = 'jr' + (++uid);
    field.setAttribute('data-recip', id);
    var people = [];            // { email, name, group }
    var sel = split(field.value);
    var open = false, act = -1, shown = [];

    var wrap = document.createElement('div'); wrap.className = 'jr';
    wrap.innerHTML = '<div class="jr-box"><input class="jr-in" type="text" role="combobox" aria-expanded="false" aria-autocomplete="list" aria-controls="' + id + '-l" autocomplete="off" placeholder="Pick or type a name or address"><button type="button" class="jr-tog" tabindex="-1" aria-label="Show the list">&#9662;</button></div>' +
      '<ul class="jr-list" id="' + id + '-l" role="listbox" aria-multiselectable="true" hidden></ul><div class="jr-sum" aria-live="polite"></div>';
    field.parentNode.insertBefore(wrap, field.nextSibling);
    field.style.display = 'none';
    var box = wrap.querySelector('.jr-box'), inp = wrap.querySelector('.jr-in'), list = wrap.querySelector('.jr-list'), sum = wrap.querySelector('.jr-sum');
    if (field.id) { inp.id = field.id + '-pick'; var lab = document.querySelector('label[for="' + field.id + '"]'); if (lab) lab.setAttribute('for', inp.id); }

    function who(email) { var e = low(email); for (var i = 0; i < people.length; i++) if (low(people[i].email) === e) return people[i]; return null; }
    function has(email) { var e = low(email); return sel.some(function (x) { return low(x) === e; }); }
    function write() {
      field.value = sel.join(', ');
      try { field.dispatchEvent(new Event('input', { bubbles: true })); field.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) { /* old browsers */ }
    }
    function paintChips() {
      Array.prototype.forEach.call(box.querySelectorAll('.jr-chip'), function (c) { c.remove(); });
      sel.forEach(function (e) {
        var p = who(e), c = document.createElement('span');
        c.className = 'jr-chip' + (EMAIL.test(e) ? '' : ' bad'); c.title = e;
        c.innerHTML = '<span>' + esc(p && p.name ? p.name : e) + '</span><button type="button" aria-label="Remove ' + esc(e) + '">&times;</button>';
        c.querySelector('button').addEventListener('click', function (ev) { ev.stopPropagation(); toggle(e); inp.focus(); });
        box.insertBefore(c, inp);
      });
      var n = sel.length;
      sum.textContent = n ? n + (n === 1 ? ' person' : ' people') + ' on this email' : 'No one on this email yet';
      wrap.classList.toggle('err', field.classList.contains('err'));
    }
    function toggle(email) {
      if (has(email)) sel = sel.filter(function (x) { return low(x) !== low(email); }); else sel.push(email);
      write(); paintChips(); if (open) paintList();
    }
    function paintList() {
      var q = low(inp.value.trim());
      var pool = people.slice();
      sel.forEach(function (e) { if (!who(e)) pool.push({ email: e, name: '', group: 'Other' }); });
      shown = pool.filter(function (p) { return !q || low(p.email).indexOf(q) >= 0 || low(p.name).indexOf(q) >= 0; });
      shown.sort(function (a, b) { return GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || low(a.name || a.email).localeCompare(low(b.name || b.email)); });
      var html = '', g = null;
      shown.forEach(function (p, i) {
        if (p.group !== g) { g = p.group; html += '<li class="jr-g" role="presentation">' + esc(g) + '</li>'; }
        var on = has(p.email);
        html += '<li class="jr-o' + (i === act ? ' act' : '') + '" role="option" id="' + id + '-o' + i + '" data-i="' + i + '" aria-selected="' + on + '">' +
          '<span class="ck" aria-hidden="true">' + (on ? '&#10003;' : '') + '</span><span class="nm">' + esc(p.name || p.email) + '</span>' +
          (p.name ? '<span class="em">' + esc(p.email) + '</span>' : '') + '</li>';
      });
      if (!shown.length) {
        html = '<li class="jr-none" role="presentation">' + (people.length || !loaded ? (loaded ? 'No match.' : 'Loading people…') : 'No contacts or users found.') +
          (q && EMAIL.test(inp.value.trim()) ? ' Press Enter to add ' + esc(inp.value.trim()) + '.' : '') + '</li>';
      }
      list.innerHTML = html;
      inp.setAttribute('aria-activedescendant', act >= 0 && shown[act] ? id + '-o' + act : '');
    }
    function setOpen(on) {
      open = on; list.hidden = !on; inp.setAttribute('aria-expanded', String(on));
      if (on) { act = -1; paintList(); }
    }
    function addTyped() {
      var parts = split(inp.value), added = false;
      parts.forEach(function (e) { if (!has(e)) { sel.push(e); added = true; } });
      inp.value = '';
      if (added) { write(); paintChips(); }
      if (open) paintList();
    }

    box.addEventListener('mousedown', function (e) { if (e.target === box) { e.preventDefault(); inp.focus(); setOpen(true); } });
    wrap.querySelector('.jr-tog').addEventListener('mousedown', function (e) { e.preventDefault(); inp.focus(); setOpen(!open); });
    inp.addEventListener('focus', function () { setOpen(true); });
    inp.addEventListener('input', function () {
      if (/[,;]/.test(inp.value)) { addTyped(); return; }
      act = -1; if (!open) setOpen(true); else paintList();
    });
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); if (!open) setOpen(true);
        if (shown.length) { act = e.key === 'ArrowDown' ? (act + 1) % shown.length : (act <= 0 ? shown.length - 1 : act - 1); paintList(); var a = document.getElementById(id + '-o' + act); if (a && a.scrollIntoView) a.scrollIntoView({ block: 'nearest' }); }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (open && act >= 0 && shown[act]) toggle(shown[act].email);
        else if (inp.value.trim()) addTyped();
      } else if (e.key === 'Escape') {
        if (open) { e.stopPropagation(); setOpen(false); }
      } else if (e.key === 'Backspace' && !inp.value && sel.length) {
        toggle(sel[sel.length - 1]);
      } else if (e.key === 'Tab') { if (inp.value.trim()) addTyped(); setOpen(false); }
    });
    inp.addEventListener('blur', function () { setTimeout(function () { if (!wrap.contains(document.activeElement)) { if (inp.value.trim()) addTyped(); setOpen(false); } }, 120); });
    list.addEventListener('mousedown', function (e) {
      e.preventDefault();
      var o = e.target.closest ? e.target.closest('.jr-o') : null; if (!o) return;
      var p = shown[+o.getAttribute('data-i')]; if (p) { act = +o.getAttribute('data-i'); toggle(p.email); }
    });
    // keep the error state and disabled state in step with the hidden field
    try {
      new MutationObserver(function () {
        wrap.classList.toggle('err', field.classList.contains('err'));
        inp.disabled = !!field.disabled;
      }).observe(field, { attributes: true, attributeFilter: ['class', 'disabled'] });
    } catch (e) { /* no observer */ }

    var loaded = false;
    paintChips();
    Promise.resolve().then(function () { return opts.load ? opts.load() : []; }).then(function (rows) {
      var seen = {};
      people = (rows || []).filter(function (p) {
        if (!p || !p.email || !EMAIL.test(p.email) || seen[low(p.email)]) return false;
        seen[low(p.email)] = 1; return true;
      }).map(function (p) { return { email: String(p.email).trim(), name: String(p.name || '').trim(), group: GROUPS.indexOf(p.group) >= 0 ? p.group : 'Other' }; });
    }, function () { people = []; }).then(function () { loaded = true; paintChips(); if (open) paintList(); });

    return {
      value: function () { return sel.slice(); },
      set: function (list2) { sel = split(Array.isArray(list2) ? list2.join(',') : list2); write(); paintChips(); }
    };
  }

  function auto(selector, optsFor) {
    function scan(root) {
      Array.prototype.forEach.call((root || document).querySelectorAll(selector), function (f) {
        if (!f.getAttribute('data-recip')) mount(f, optsFor(f) || {});
      });
    }
    scan(document);
    try { new MutationObserver(function () { scan(document); }).observe(document.body, { childList: true, subtree: true }); } catch (e) { /* no observer */ }
  }

  /* People for one account: its contacts with an email (not archived) and the active CRM users.
     coql(query) must resolve to an array of rows. Either half failing just leaves that group out. */
  function crmPeople(accountId, coql) {
    var contacts = !accountId ? Promise.resolve([]) : Promise.resolve().then(function () {
      var aid = String(accountId).replace(/[^\d]/g, '');
      return coql("select First_Name, Last_Name, Email, Contact_Status from Contacts where (Account_Name.id = '" + aid + "' and Email is not null) limit 200");
    }).then(function (rows) {
      return (rows || []).filter(function (c) { return c.Contact_Status !== 'Archived'; }).map(function (c) {
        return { email: c.Email, name: ((c.First_Name || '') + ' ' + (c.Last_Name || '')).trim(), group: 'At this customer' };
      });
    }).catch(function () { return []; });
    var users = Promise.resolve().then(function () {
      if (!window.ZOHO || !ZOHO.CRM || !ZOHO.CRM.API || typeof ZOHO.CRM.API.getAllUsers !== 'function') return [];
      return ZOHO.CRM.API.getAllUsers({ Type: 'ActiveUsers' }).then(function (r) {
        return ((r && r.users) || []).map(function (u) { return { email: u.email, name: u.full_name || '', group: 'JusticePoint' }; });
      });
    }).catch(function () { return []; });
    return Promise.all([contacts, users]).then(function (a) { return a[0].concat(a[1]); });
  }

  window.JPKRecip = { version: '1.0.0', mount: mount, auto: auto, crmPeople: crmPeople, split: split };
})();
