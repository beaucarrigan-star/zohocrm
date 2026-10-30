/* jpk-rail.js (jpk-theme v3, wave 3): the left rail for the standalone tool widgets.
   Wraps the page in .jpk-shell: tri-brand logo, brand scope switcher (JPK.brand), the tool's name, and the tool's own tabs/steps
   mirrored as rail items (click forwards to the real control). Load AFTER jpk.js and jpk-brand.js, last script on the page:
   <script src="jpk-rail.js" data-group="Equipment" data-tool="Stock Alerts"></script>
   Brand scope itself lives in jpk.js (JPK.crm.coql adds the brand criteria); changing the brand reloads the tool. */
(function (root) {
  'use strict';
  var doc = root.document, cs = doc.currentScript;
  var GROUP = cs && cs.getAttribute('data-group') || 'Tools', TOOL = cs && cs.getAttribute('data-tool') || doc.title || 'Tool';
  var ICO = 'M4 6h16M4 12h16M4 18h16';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function build() {
    if (doc.querySelector('.jpk-shell')) return;
    var shell = doc.createElement('div'); shell.className = 'jpk-shell';
    var rail = doc.createElement('nav'); rail.className = 'jpk-rail'; rail.id = 'rail'; rail.setAttribute('aria-label', 'Navigation');
    var main = doc.createElement('main'); main.className = 'jpk-main'; main.id = 'jpk-main';
    var hint = doc.createElement('div'); hint.className = 'scopehint'; hint.id = 'bhint'; hint.hidden = true; hint.setAttribute('role', 'status');
    main.appendChild(hint);
    Array.prototype.slice.call(doc.body.children).forEach(function (n) {
      if (/^(SCRIPT|LINK|STYLE)$/.test(n.tagName) || n.id === 'jpk-toast' || n.hasAttribute('data-jpk-keep')) return;
      main.appendChild(n);
    });
    shell.appendChild(rail); shell.appendChild(main); doc.body.insertBefore(shell, doc.body.firstChild);
    rail.innerHTML = '<div class="logo"><img src="jpk-logo.png" alt="The Difference Principle, JusticePoint, Sirona Recovery"></div><div id="brand"></div>' +
      '<div class="grp">' + esc(GROUP) + '</div>' +
      '<button type="button" class="nav" aria-current="page" id="rail-tool"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + ICO + '"/></svg><span class="nl">' + esc(TOOL) + '</span></button>' +
      '<div id="rail-secs"></div>';
    if (root.JPK && root.JPK.brand) {
      root.JPK.brand({ mount: rail.querySelector('#brand'), onChange: function () { try { root.location.reload(); } catch (e) {} } });
    } else rail.querySelector('#brand').hidden = true;
    sync(); watch(main); scopeHint(hint);
    rail.querySelector('#rail-tool').addEventListener('click', function () { main.scrollTo ? main.scrollTo(0, 0) : 0; root.scrollTo(0, 0); });
  }
  /* ---- sections: the tool's own tabs (role=tab), else its flow steps, mirrored into the rail ---- */
  var mirrored = [];
  function sources() {
    var tabs = doc.querySelectorAll('#jpk-main [role="tab"]');
    if (tabs.length) return Array.prototype.map.call(tabs, function (t) { return { el: t, kind: 'tab' }; });
    var stages = doc.querySelectorAll('#jpk-main ol.flow > li.stage');
    return Array.prototype.map.call(stages, function (t) { return { el: t, kind: 'stage' }; });
  }
  function labelOf(el) {
    if (el.matches && el.matches('li.stage')) { var h = el.querySelector('h2'); if (!h) return ''; var hc = h.cloneNode(true); Array.prototype.forEach.call(hc.querySelectorAll('.n'), function (x) { x.remove(); }); return (hc.textContent || '').replace(/\s+/g, ' ').trim(); }
    var c = el.cloneNode(true); Array.prototype.forEach.call(c.querySelectorAll('.cnt,svg,small'), function (x) { x.remove(); });
    return (c.textContent || '').replace(/\s+/g, ' ').trim();
  }
  function countOf(el) { if (el.matches && el.matches('li.stage')) { var bg = el.querySelector('.big'); return bg ? bg.textContent.trim() : ''; } var c = el.querySelector('.cnt'); return c ? c.textContent.trim() : ''; }
  function isOn(s) { var e = s.el; if (s.kind === 'stage') return !!e.querySelector('[aria-pressed="true"],[aria-current="true"],.on,.sel,.cur'); return e.getAttribute('aria-selected') === 'true' || e.getAttribute('aria-current') === 'step' || e.getAttribute('aria-pressed') === 'true' || e.classList.contains('cur') || e.classList.contains('on'); }
  function sync() {
    var host = doc.getElementById('rail-secs'); if (!host) return;
    var src = sources().filter(function (s) { return labelOf(s.el); }); mirrored = src;
    var sig = src.map(function (s) { return labelOf(s.el) + '|' + countOf(s.el) + '|' + (isOn(s) ? 1 : 0); }).join('~');
    if (host.getAttribute('data-sig') === sig) return;
    host.setAttribute('data-sig', sig);
    host.innerHTML = src.length ? '<div class="grp">' + (src[0].kind === 'stage' ? 'Stages' : 'On this page') + '</div>' + src.map(function (s, i) {
      var n = countOf(s.el);
      return '<button type="button" class="nav sec-item" data-i="' + i + '" aria-current="' + (isOn(s) ? 'true' : 'false') + '"><span class="nl">' + esc(labelOf(s.el)) + '</span>' + (n ? '<span class="cnt">' + esc(n) + '</span>' : '') + '</button>';
    }).join('') : '';
    doc.querySelector('.jpk-shell').classList.toggle('has-secs', src.some(function (s) { return s.kind === 'tab'; }));
  }
  var timer;
  function watch(main) {
    var mo = new MutationObserver(function () { clearTimeout(timer); timer = setTimeout(sync, 60); });
    mo.observe(main, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-selected', 'aria-current', 'aria-pressed', 'class'], characterData: true });
    doc.getElementById('rail').addEventListener('click', function (e) {
      var b = e.target.closest('.sec-item'); if (!b) return;
      var s = mirrored[+b.getAttribute('data-i')]; if (s && s.el && s.kind === 'stage') { try { s.el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (x) { s.el.scrollIntoView(); } } else if (s && s.el) { s.el.click(); try { s.el.focus({ preventScroll: true }); } catch (x) {} }
    });
  }
  /* ---- scope hint: says what the brand choice did to this tool ---- */
  function scopeHint(hint) {
    function paint() {
      var J = root.JPK, key = J && J.scopeKey ? J.scopeKey() : 'all'; if (key === 'all') { hint.hidden = true; return; }
      var st = J.scopeStats || { applied: 0, failed: [] }, name = (J.scopeLabel && J.scopeLabel()) || key;
      hint.hidden = false;
      hint.textContent = st.failed.length ? 'Brand scope could not be applied to ' + st.failed.join(', ') + '; those lists show all brands.'
        : st.applied ? 'Scoped to ' + name + '.' : doc.documentElement.getAttribute('data-live') === 'no' ? 'Brand scope applies to live data.' : 'Scoped to ' + name + ' where this tool\'s records belong to an account. Other lists are not split by brand.';
    }
    root.addEventListener('jpk-scope', paint); setTimeout(paint, 2500); paint();
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', build); else build();
})(window);
