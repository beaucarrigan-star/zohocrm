/* jpk-nav.js v1.0.0 (19 Oct 2026): JPK.navBar, "Back to [tab]" + "Home" buttons for widgets on record pages.
   Standalone kit file (load after jpk.js if you use it; it does not need jpk.js).
   One module-to-tab map below. Edit only the map when a tab or module changes.
   Same-window navigation: a plain <a target="_top"> link to the CRM tab URL (tested 19 Oct 2026 from a
   widget on a Canvas record page: opens in the same window; the SDK has no tab-navigation call). */
(function (root) {
  'use strict';
  var JPK = root.JPK = root.JPK || {};
  var ORG = 'https://crm.zoho.com/crm/org882980956/tab/';

  /* ---- the one map: tab label -> web tab, and which modules belong to which tab ---- */
  var TABS = {
    'Records':         { url: ORG + 'WebTab25', modules: ['Accounts', 'Deals', 'Contracts', 'Customer_Onboarding', 'Vendors'] },
    'Support Process': { url: ORG + 'WebTab26', modules: ['Cases', 'Support_Emails'] },
    'Processes':       { url: ORG + 'WebTab24', modules: ['Billing_Periods', 'Billing_Findings', 'Solicitations', 'Contract_Ingest_Tab'] }
  };
  var HOME = { label: 'Home', url: ORG + 'Home/begin' };
  /* friendly names, used for ?module= in demo mode and matching */
  var ALIAS = { 'opportunities': 'Deals', 'customer onboarding': 'Customer_Onboarding', 'support emails': 'Support_Emails',
    'billing periods': 'Billing_Periods', 'billing findings': 'Billing_Findings', 'contract ingest': 'Contract_Ingest_Tab' };

  function resolve(entity) {
    var e = String(entity || '').trim();
    if (ALIAS[e.toLowerCase()]) e = ALIAS[e.toLowerCase()];
    var low = e.toLowerCase();
    for (var label in TABS) {
      if (!Object.prototype.hasOwnProperty.call(TABS, label)) continue;
      var m = TABS[label].modules;
      for (var i = 0; i < m.length; i++) if (m[i].toLowerCase() === low) return { label: label, url: TABS[label].url, home: HOME.url, module: m[i] };
    }
    return null; /* unmapped module: caller shows Home only */
  }

  var CSS = '.jpk-nav{display:flex;align-items:center;gap:8px;flex-wrap:nowrap;margin:0;padding:6px 8px;' +
    'font:500 13px var(--font,"Public Sans",system-ui,-apple-system,"Segoe UI",sans-serif);background:var(--surface,#fff);color:var(--ink,#16191D)}' +
    '.jpk-nav a{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border:1px solid var(--line-strong,#B8BEC7);' +
    'border-radius:var(--r-sm,3px);background:var(--surface,#fff);color:var(--ink,#16191D);text-decoration:none;font:inherit;white-space:nowrap;cursor:pointer}' +
    '.jpk-nav a:hover{background:var(--surface2,#F7F8FA)}' +
    '.jpk-nav a.back{color:var(--accent-ink,#284A90);font-weight:600;border-color:var(--accent,#2F55A4)}' +
    '.jpk-nav a:focus-visible{outline:2px solid var(--accent,#2F55A4);outline-offset:2px}' +
    '.jpk-nav svg{width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;flex-shrink:0}' +
    '@media (max-width:640px){.jpk-nav{padding:6px 8px}.jpk-nav a{height:36px;padding:0 10px}}' +
    '@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .jpk-nav{background:var(--surface,#191C20);color:var(--ink,#E6E8EB)}' +
    ':root:not([data-theme="light"]) .jpk-nav a{background:var(--surface,#191C20);color:var(--ink,#E6E8EB);border-color:var(--line-strong,#424955)}' +
    ':root:not([data-theme="light"]) .jpk-nav a:hover{background:var(--surface2,#1F2328)}' +
    ':root:not([data-theme="light"]) .jpk-nav a.back{color:var(--accent-ink,#9DB6EA);border-color:var(--accent,#7F9FE0)}}';

  function el(tag, attrs, html) {
    var n = document.createElement(tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (html) n.innerHTML = html;
    return n;
  }
  var ARROW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>';
  var HOMEI = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11l9-8 9 8M5 10v10h14V10"/></svg>';

  /* JPK.navBar(mount, entity) -> the resolved tab (or null). Draws "Back to <tab>" (if the module is mapped) and "Home". */
  function navBar(mount, entity) {
    if (!document.getElementById('jpk-nav-css')) {
      var st = el('style', { id: 'jpk-nav-css' }); st.textContent = CSS; document.head.appendChild(st);
    }
    var r = resolve(entity);
    var nav = el('nav', { 'class': 'jpk-nav', 'aria-label': 'Navigate' });
    if (r) nav.appendChild(el('a', { 'class': 'back', href: r.url, target: '_top', rel: 'noopener', title: 'Back to ' + r.label }, ARROW + '<span>Back to ' + r.label + '</span>'));
    nav.appendChild(el('a', { 'class': 'home', href: HOME.url, target: '_top', rel: 'noopener', title: 'Home' }, HOMEI + '<span>Home</span>'));
    mount.innerHTML = ''; mount.appendChild(nav);
    return r;
  }

  JPK.navBar = navBar; JPK.navResolve = resolve; JPK.navMap = { tabs: TABS, home: HOME };
  if (typeof module !== 'undefined' && module.exports) module.exports = { resolve: resolve, TABS: TABS, HOME: HOME };
})(typeof window !== 'undefined' ? window : this);
