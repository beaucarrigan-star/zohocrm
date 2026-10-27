/* jpk-nav.js v1.1.0 (27 Oct 2026, S41 Phase 4c): JPK.navBar, "Back to [tab]" + "Home" buttons for widgets on record pages.
   v1.1.0: tab renamed Support (was Support Process); Back is per profile (Support and Processes are Administrator-only tabs,
   so other profiles go back to their own home page, named); Back to Records / Processes opens the module's section through
   ZOHO.CRM.UI.Widget.open with a message, and falls back to the plain tab link if Zoho refuses.
   v1.0.0 (19 Oct 2026): first version.
   Standalone kit file (load after jpk.js if you use it; it does not need jpk.js).
   One module-to-tab map below. Edit only the map when a tab, module or home page changes.
   Same-window navigation: a plain <a target="_top"> link to the CRM tab URL (tested 19 Oct 2026 from a
   widget on a Canvas record page: opens in the same window; the SDK has no tab-navigation call). */
(function (root) {
  'use strict';
  var JPK = root.JPK = root.JPK || {};
  var ORG = 'https://crm.zoho.com/crm/org882980956/tab/';

  /* ---- the one map ----
     TABS: tab label -> web tab URL, its API name (for Widget.open), who may use it, and which modules belong to it.
     modules: module API name -> the section key the tab's widget opens on (records.js module key). */
  var TABS = {
    'Records':   { url: ORG + 'WebTab25', api: 'Customer_and_Prospect_Tab', profiles: null,
                   modules: { Accounts: 'accounts', Deals: 'deals', Contracts: 'contracts', Customer_Onboarding: 'onboarding', Vendors: 'vendor_pricing' } },
    'Support':   { url: ORG + 'WebTab26', api: 'Support_Tab', profiles: ['Administrator'],
                   modules: { Cases: 'cases', Support_Emails: 'triage' } },
    'Processes': { url: ORG + 'WebTab24', api: 'Admin_Processes_Tab', profiles: ['Administrator'],
                   modules: { Billing_Periods: 'billing', Billing_Findings: 'billing_findings', Solicitations: 'p_solicit', Contract_Ingest_Tab: 'contract_ingest' } }
  };
  /* Home page each profile lands on (Setup > Customize Home page). Used to name Back when the tab is not theirs. */
  var HOMES = { 'EM Support': 'EM Homepage', 'Business Development': 'BD Home', 'Leadership': 'Leadership Home', 'PDEC': 'PDEC Home' };
  var HOME = { label: 'Home', url: ORG + 'Home/begin' };
  /* friendly names, used for ?module= in demo mode and matching */
  var ALIAS = { 'opportunities': 'Deals', 'customer onboarding': 'Customer_Onboarding', 'support emails': 'Support_Emails',
    'billing periods': 'Billing_Periods', 'billing findings': 'Billing_Findings', 'contract ingest': 'Contract_Ingest_Tab' };

  function allowed(tab, profile) { return !tab.profiles || (profile != null && tab.profiles.indexOf(profile) >= 0); }

  /* resolve(entity, profile) -> { label, url, api, section, home, module, toHome }
     profile unknown (null) is treated as Administrator only for tabs open to everyone; Admin-only tabs then wait for it. */
  function resolve(entity, profile) {
    var e = String(entity || '').trim();
    if (ALIAS[e.toLowerCase()]) e = ALIAS[e.toLowerCase()];
    var low = e.toLowerCase();
    for (var label in TABS) {
      if (!Object.prototype.hasOwnProperty.call(TABS, label)) continue;
      var t = TABS[label], m = t.modules;
      for (var k in m) {
        if (!Object.prototype.hasOwnProperty.call(m, k) || k.toLowerCase() !== low) continue;
        if (allowed(t, profile)) return { label: label, url: t.url, api: t.api, section: m[k], home: HOME.url, module: k, toHome: false };
        var hl = HOMES[profile] || 'Home';
        return { label: hl, url: HOME.url, api: null, section: null, home: HOME.url, module: k, toHome: true };
      }
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
    ':root:not([data-theme="light"]) .jpk-nav a.back{color:var(--accent-ink,#9DB6EA);border-color:var(--accent,#7F9FE0)}}' +
    ':root[data-theme="dark"] .jpk-nav{background:#191C20;color:#E6E8EB}' +
    ':root[data-theme="dark"] .jpk-nav a{background:#191C20;color:#E6E8EB;border-color:#424955}' +
    ':root[data-theme="dark"] .jpk-nav a:hover{background:#1F2328}' +
    ':root[data-theme="dark"] .jpk-nav a.back{color:#9DB6EA;border-color:#7F9FE0}';

  function el(tag, attrs, html) {
    var n = document.createElement(tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (html) n.innerHTML = html;
    return n;
  }
  var ARROW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>';
  var HOMEI = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11l9-8 9 8M5 10v10h14V10"/></svg>';

  /* Open a web tab on a section. Widget.open sends { jpk_section } to the tab's widget, which reads it on PageLoad.
     If the SDK call is missing or refused, follow the plain link (the tab opens on its own default section). */
  function openTab(r, link) {
    var Z = root.ZOHO;
    if (!r.api || !r.section || !Z || !Z.CRM || !Z.CRM.UI || !Z.CRM.UI.Widget || !Z.CRM.UI.Widget.open) return false;
    try {
      Promise.resolve(Z.CRM.UI.Widget.open({ Entity: r.api, Message: { jpk_section: r.section, jpk_from: r.module } }))
        .catch(function () { try { root.open(link.href, '_top'); } catch (e) { /* the user can use Home */ } });
      return true;
    } catch (e) { return false; }
  }

  /* JPK.navBar(mount, entity, opts) -> the resolved destination (or null).
     opts.profile: the user's profile name (Back for Admin-only tabs waits for it; without it Back shows Home).
     Draws "Back to <tab>" (if the module is mapped) and "Home". When Back already goes home, the Home button is left out. */
  function navBar(mount, entity, opts) {
    opts = opts || {};
    if (!document.getElementById('jpk-nav-css')) {
      var st = el('style', { id: 'jpk-nav-css' }); st.textContent = CSS; document.head.appendChild(st);
    }
    var r = resolve(entity, opts.profile == null ? null : opts.profile);
    var nav = el('nav', { 'class': 'jpk-nav', 'aria-label': 'Navigate' });
    if (r) {
      var a = el('a', { 'class': 'back', href: r.url, target: '_top', rel: 'noopener', title: 'Back to ' + r.label, 'data-section': r.section || '' }, ARROW + '<span>Back to ' + r.label + '</span>');
      a.addEventListener('click', function (ev) { if (opts.demo) { ev.preventDefault(); if (opts.onDemo) opts.onDemo(r); return; } if (openTab(r, a)) ev.preventDefault(); });
      nav.appendChild(a);
    }
    if (!r || !r.toHome) nav.appendChild(el('a', { 'class': 'home', href: HOME.url, target: '_top', rel: 'noopener', title: 'Home' }, HOMEI + '<span>Home</span>'));
    mount.innerHTML = ''; mount.appendChild(nav);
    return r;
  }

  /* For tab widgets: the section a Back click asked for, from PageLoad data (shape varies by SDK version). */
  function sectionFrom(d) {
    if (!d || typeof d !== 'object') return null;
    var cands = [d, d.Message, d.message, d.data, d.Data, d.customData];
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      if (typeof c === 'string') { try { c = JSON.parse(c); } catch (e) { continue; } }
      if (c && typeof c === 'object' && typeof c.jpk_section === 'string' && c.jpk_section) return c.jpk_section;
    }
    return null;
  }

  JPK.navBar = navBar; JPK.navResolve = resolve; JPK.navSection = sectionFrom; JPK.navMap = { tabs: TABS, homes: HOMES, home: HOME, version: '1.1.0' };
  if (typeof module !== 'undefined' && module.exports) module.exports = { resolve: resolve, sectionFrom: sectionFrom, TABS: TABS, HOMES: HOMES, HOME: HOME, VERSION: '1.1.0' };
})(typeof window !== 'undefined' ? window : this);
