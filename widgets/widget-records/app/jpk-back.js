/* jpk-back v1.0.0 (S50, 30 Oct 2026) - a Back button at the top of every tool page the home pages link to.
   Back goes to the page you came from (the browser's own back, which works from inside the Zoho frame).
   When there is nothing to go back to (the page was opened in a new tab or from a bookmark), it opens Home.
   Placed first in the page's .wrap, else main, else body and put back if the page redraws it. */
(function () {
  'use strict';
  if (window.__jpkBack) return; window.__jpkBack = true;
  var HOME = 'https://crm.zoho.com/crm/org882980956/tab/Home/begin';

  var css = document.createElement('style');
  css.textContent =
    '.jpk-back{display:flex;align-items:center;margin:0 0 10px}' +
    '.jpk-back.jpk-back-gap{padding:12px 12px 0}' +
    '.jpk-back button{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;gap:6px;cursor:pointer;' +
      'font:inherit;font-size:14px;font-weight:600;line-height:1;padding:7px 12px 7px 10px;border-radius:6px;' +
      'color:inherit;border:1px solid color-mix(in srgb,currentColor 25%,transparent);background:color-mix(in srgb,currentColor 4%,transparent)}' +
    '.jpk-back button:hover{background:color-mix(in srgb,currentColor 10%,transparent)}' +
    '.jpk-back button:focus-visible{outline:2px solid var(--focus,var(--accent,#1f6f7a));outline-offset:2px}' +
    '.jpk-back svg{width:16px;height:16px;flex:0 0 16px}' +
    '@media print{.jpk-back{display:none}}';
  document.head.appendChild(css);

  var bar = document.createElement('nav');
  bar.className = 'jpk-back'; bar.setAttribute('aria-label', 'Back');
  bar.innerHTML = '<button type="button" title="Go back to the page you came from">' +
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>Back</button>';

  function goHome() {
    try { window.open(HOME, '_top'); } catch (e) { location.href = HOME; }
  }
  bar.querySelector('button').addEventListener('click', function () {
    if (history.length > 1) history.back(); else goHome();
  });

  function host() { return document.querySelector('main#app') || document.querySelector('.wrap') || document.querySelector('main') || document.body; }
  function place() {
    var h = host();
    if (bar.parentNode === h && h.firstChild === bar) return;
    bar.classList.toggle('jpk-back-gap', !h.classList.contains('wrap') && h !== document.body);
    h.insertBefore(bar, h.firstChild);
  }
  function start() {
    place();
    try { new MutationObserver(function () { if (!bar.isConnected || host().firstChild !== bar) place(); }).observe(document.body, { childList: true, subtree: true }); } catch (e) { /* no observer */ }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
