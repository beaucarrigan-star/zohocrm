# Lost Devices widget (step 3)

Before zipping for Zoho, copy these from the project's ux/kit/jpk/ into app/:
jpk.js (v1.2.1), jpk.css, jpk-theme-v3.css, jpk-patterns-v3.css.
(jpk-brand.js is not used: brand tabs use JPK.tabs and the Accounts.Brand lookup.)

Preview: open app/lost.html?demo=1 in a browser.
Tests: node --test tests/*.test.js  (27 pass)
Zip: plugin-manifest.json at the zip root, app/ beside it.
Read-only. Never reads Last_Client. Webtab name: Lost Devices.
