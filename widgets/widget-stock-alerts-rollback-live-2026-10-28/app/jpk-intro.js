/* jpk-intro.js v1.0.0. One-line "what this tool does" strip for JusticePoint widgets.
   Standalone: no dependencies, no network. Works with or without jpk.js/jpk.css.
   Use one tag, after the page's own markup (or in <head> with defer is not needed):
     <script src="jpk-intro.js"
       data-what="One sentence: what this tool does."
       data-fed="Where its data comes from."
       data-feeds="What it changes or what uses its output."></script>
   data-fed and data-feeds are optional. The strip goes at the top of <main> (or <body>).
   It is plain text, read by screen readers, and the viewer can hide it for the visit.
   Placement: top of <main>, else top of .wrap, else top of <body>. */
(function () {
  'use strict';
  var s = document.currentScript;
  if (!s) return;
  var what = s.getAttribute('data-what');
  if (!what) return;
  var fed = s.getAttribute('data-fed');
  var feeds = s.getAttribute('data-feeds');

  function run() {
    if (document.getElementById('jpk-intro')) return;
    var css = document.createElement('style');
    css.textContent =
      '#jpk-intro{margin:0 0 10px;padding:8px 12px;border:1px solid rgba(128,128,128,.35);border-radius:8px;' +
      'background:rgba(128,128,128,.08);font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:inherit;display:flex;gap:10px;align-items:flex-start}' +
      '#jpk-intro .ji-t{flex:1;min-width:0}#jpk-intro b{font-weight:600}' +
      '#jpk-intro .ji-l{display:block;opacity:.85;margin-top:2px}' +
      '#jpk-intro button{flex:none;font:inherit;color:inherit;background:none;border:0;cursor:pointer;opacity:.7;padding:0 4px;min-height:24px;text-decoration:underline}' +
      '#jpk-intro button:hover,#jpk-intro button:focus-visible{opacity:1}' +
      '#jpk-intro[hidden]{display:none}';
    document.head.appendChild(css);

    var box = document.createElement('div');
    box.id = 'jpk-intro';
    box.setAttribute('role', 'note');
    var t = document.createElement('div');
    t.className = 'ji-t';
    function line(label, text, first) {
      var d = document.createElement(first ? 'div' : 'span');
      if (!first) d.className = 'ji-l';
      var b = document.createElement('b');
      b.textContent = label;
      d.appendChild(b);
      d.appendChild(document.createTextNode(' ' + text));
      t.appendChild(d);
    }
    line('What this does:', what, true);
    if (fed) line('Fed by:', fed);
    if (feeds) line('Feeds:', feeds);
    var x = document.createElement('button');
    x.type = 'button';
    x.textContent = 'Hide';
    x.addEventListener('click', function () { box.hidden = true; });
    box.appendChild(t);
    box.appendChild(x);

    var host = document.querySelector('main') || document.querySelector('.wrap') || document.body;
    host.insertBefore(box, host.firstChild);
  }

  if (document.body) run();
  else document.addEventListener('DOMContentLoaded', run);
})();
