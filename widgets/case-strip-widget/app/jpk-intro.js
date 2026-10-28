/* jpk-intro.js v1.1.0 (S35, 26 Oct 2026). "What this does" strip for JusticePoint widgets.
   Standalone: no dependencies, no network. Works with or without jpk.js/jpk.css.
   v1.1.0 adds, over v1.0.0 (same tag still works):
     - Hide is remembered per browser and per page (browser storage; if storage is blocked
       it falls back to hiding for the visit only).
     - If the wording changes, a hidden strip shows again once.
     - When hidden, a small "About this page" link sits at the foot of the page; it brings the strip back.
     - data-mode="line": one line, no labels, for home pages (placed under the greeting).
   Tag:
     <script src="jpk-intro.js"
       data-id="records"                      (storage key; defaults to the page file name)
       data-what="What it is for."            (required)
       data-fed="Fed by."  data-feeds="Feeds." (optional; not shown in line mode)
       data-mode="line"                       (optional; homes)
       data-after="#greeting"                 (optional; CSS selector to place after, else top of main/.wrap/body)
       data-foot="#foot"></script>            (optional; where the About link goes, else footer/.foot/end of main)
   The element ids are jpk-intro and jpk-intro-about. Plain text only; read by screen readers. */
(function () {
  'use strict';
  var s = document.currentScript;
  if (!s) return;
  var what = s.getAttribute('data-what');
  if (!what) return;
  var fed = s.getAttribute('data-fed');
  var feeds = s.getAttribute('data-feeds');
  var mode = s.getAttribute('data-mode') === 'line' ? 'line' : 'strip';
  var after = s.getAttribute('data-after');
  var footSel = s.getAttribute('data-foot');
  var pid = s.getAttribute('data-id') ||
    ((location.pathname.split('/').pop() || 'page').replace(/\.html?$/, ''));
  var KEY = 'jpk-intro-hidden:' + pid;

  // Short stable fingerprint of the wording, so changed wording shows again.
  function sig(str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }
  var SIG = sig([mode, what, fed || '', feeds || ''].join('\u0001'));

  function store(fn) { try { return fn(window.localStorage); } catch (e) { return null; } }
  function isHidden() { return store(function (ls) { return ls.getItem(KEY); }) === SIG; }
  function setHidden(on) {
    store(function (ls) { if (on) ls.setItem(KEY, SIG); else ls.removeItem(KEY); });
  }

  function run() {
    if (document.getElementById('jpk-intro')) return;
    var css = document.createElement('style');
    css.id = 'jpk-intro-css';
    css.textContent =
      '#jpk-intro{margin:0 0 10px;padding:8px 12px;border:1px solid rgba(128,128,128,.35);border-radius:8px;' +
      'background:rgba(128,128,128,.08);font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:inherit;display:flex;gap:10px;align-items:flex-start}' +
      '#jpk-intro .ji-t{flex:1;min-width:0;overflow-wrap:anywhere}#jpk-intro b{font-weight:600}' +
      '#jpk-intro .ji-l{display:block;opacity:.85;margin-top:2px}' +
      '#jpk-intro.ji-line{margin:2px 0 8px;padding:0;border:0;background:none;align-items:baseline;opacity:.85;font-family:inherit}' +
      '#jpk-intro button,#jpk-intro-about{flex:none;font:inherit;color:inherit;background:none;border:0;cursor:pointer;opacity:.7;padding:0 4px;min-height:24px;text-decoration:underline}' +
      '#jpk-intro button:hover,#jpk-intro button:focus-visible,#jpk-intro-about:hover,#jpk-intro-about:focus-visible{opacity:1}' +
      '#jpk-intro-about{font:12px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;margin:6px 0}' +
      '#jpk-intro[hidden],#jpk-intro-about[hidden]{display:none}';
    document.head.appendChild(css);

    var box = document.createElement('div');
    box.id = 'jpk-intro';
    box.setAttribute('role', 'note');
    box.setAttribute('aria-label', 'About this page');
    if (mode === 'line') box.className = 'ji-line';
    var t = document.createElement('div');
    t.className = 'ji-t';
    if (mode === 'line') {
      t.textContent = what;
    } else {
      var line = function (label, text, first) {
        var d = document.createElement(first ? 'div' : 'span');
        if (!first) d.className = 'ji-l';
        var b = document.createElement('b');
        b.textContent = label;
        d.appendChild(b);
        d.appendChild(document.createTextNode(' ' + text));
        t.appendChild(d);
      };
      line('What this does:', what, true);
      if (fed) line('Fed by:', fed);
      if (feeds) line('Feeds:', feeds);
    }
    var x = document.createElement('button');
    x.type = 'button';
    x.textContent = 'Hide';
    x.setAttribute('aria-label', 'Hide the note about this page');
    box.appendChild(t);
    box.appendChild(x);

    var about = document.createElement('button');
    about.type = 'button';
    about.id = 'jpk-intro-about';
    about.textContent = 'About this page';

    function show(on) {
      box.hidden = !on;
      about.hidden = on;
    }
    x.addEventListener('click', function () { setHidden(true); show(false); about.focus(); });
    about.addEventListener('click', function () { setHidden(false); show(true); x.focus(); });

    function q(sel) { if (!sel) return null; try { return document.querySelector(sel); } catch (e) { return null; } }
    function host() { return document.querySelector('main') || document.querySelector('.wrap') || document.body; }
    function placeBox() {
      var anchor = q(after);
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(box, anchor.nextSibling);
      else { var h = host(); h.insertBefore(box, h.firstChild); }
    }
    function placeAbout() {
      var foot = q(footSel) || (footSel ? null : (document.querySelector('footer') || document.querySelector('.foot')));
      (foot || host()).appendChild(about);
    }
    placeBox();
    placeAbout();
    show(!isHidden());

    // Pages that redraw their main area or header by script would drop the strip; put it back.
    var busy = false;
    new MutationObserver(function () {
      if (busy || (box.isConnected && about.isConnected)) return;
      busy = true;
      if (!box.isConnected) placeBox();
      if (!about.isConnected) placeAbout();
      busy = false;
    }).observe(document.body, { childList: true, subtree: true });
  }

  // With data-after, wait (up to 15 s) for the anchor, since home headers are painted by script.
  function start() {
    if (!after) return run();
    var found = function () { try { return document.querySelector(after); } catch (e) { return null; } };
    if (found()) return run();
    var done = false;
    var mo = new MutationObserver(function () { if (!done && found()) { done = true; mo.disconnect(); run(); } });
    mo.observe(document.body, { childList: true, subtree: true });
    setTimeout(function () { if (!done) { done = true; mo.disconnect(); run(); } }, 15000);
  }

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
})();
