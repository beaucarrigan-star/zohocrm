# Lost Devices widget (step 3)

Bundle is ready: kit files are already in app/. Upload as a Web Tab widget (see ux/LOST-DEVICES-DEPLOY-2026-10-19.md, step 2 onward).


Preview: open app/lost.html?demo=1 in a browser.
Tests: node --test tests/*.test.js  (27 pass)
Zip: plugin-manifest.json at the zip root, app/ beside it.
Read-only. Never reads Last_Client. Webtab name: Lost Devices.

## Writing (added 19 Oct)
Administrator and EM Support see Add lost device, a status menu in each row, and Edit. Other profiles see the read-only page.
Money and credit fields in the edit form show for Administrator only. Writes use ZOHO.CRM.API with the workflow trigger so Loss Amount and Status Date fill in.
Profiles are matched by name in app/lost-edit-model.js (canWrite, canEditMoney). Zoho profile permissions still decide what is actually saved.
