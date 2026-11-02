# Equipment Shipped import pipeline - status (Oct 12, 2026)

What it replaces: the hand load of Allied "Equipment Shipped" reports into Accessory_Shipments (296 rows loaded by hand
Sep 29 covering Jan 5 - Sep 29; the Oct 1-12 reports emailed to the Equipment Shipped folder on Oct 12 are NOT loaded yet
and are the first run for this pipeline).

How Beau gets the data: exports Equipment Shipped from SmartView per contract (7 xlsx files on Oct 12) and saves them into
the OneDrive folder "Shipments" (synced locally as C:\Users\Beau\JusticePoint\Shipments). Oct 12 decision: OneDrive, not mail, because the
org has no Outlook default service in Zoho Connections and reading mail would need an Azure app registration (the same
blocker as the mailbox path for unit counts). The "Equipment Shipped" mail folder is no longer read.

Built (tests pass: 5):
- ship_parse: Catalyst Advanced I/O function (python_3_9) in this folder, deployed into contract-pipeline (31190000000040038).
  Stateless; token SHIP_PARSE_TOKEN (deploy-ship.ps1 creates it in %USERPROFILE%\.shippipe.env). POST /parse with JSON
  {"file_url": <OneDrive @microsoft.graph.downloadUrl>} (or {"file_b64"}) returns one row per packing slip: name, row_key (= packing slip), allied_customer, ship_date, month,
  order_number, packing_slip, tracking_number, devices (serialised units), straps, pin_trays, tamper_plugs, chargers
  (cords + wall plugs + chargers), tools, quantity (accessory units), is_accessory. Name strips "Justice Point - ", same
  shape as the Sep 29 rows. Unknown accessory types count in Quantity and raise a warning.
- Deluge automation.equipment_shipped_import(startDate, endDate): lists /Equipment Shipped through Graph with the existing
  "onedrive" connection, takes every .xlsx last modified in the range, posts its download link to ship_parse, upserts
  Accessory_Shipments on Row_Key (trigger []), sets Account by matching Allied_Customer to Accounts.SmartView_Customer
  (split on ";"), returns a one-line summary naming any customer with no Account.
- Deluge schedule.equipment_shipped_daily(): calls the import for the last 7 days and emails Beau the summary.

Deploy (manual, in order):
1. powershell -ExecutionPolicy Bypass -File .\deploy-ship.ps1  (token lands on the clipboard; health URL printed).
2. Setup > Developer Space > Functions: create equipment_shipped_import (category Automation, args startDate Date,
   endDate Date), paste equipment_shipped_import.dg, replace <SHIP_PARSE_TOKEN>. The "onedrive" connection already exists.
3. The OneDrive folder "Shipments" holds the seven Oct 1-12 files (done Oct 12). The function finds it by path, then by name search.
   Run the function by hand with startDate = the day the files were saved, endDate = today; check the summary and that
   Accessory_Shipments shows 2026-10 rows with Accounts set. (Range = file last-modified date, not ship date.)
4. Create equipment_shipped_daily (category Scheduler), paste the .dg, schedule daily 06:30 America/Chicago. The
   recommendations scheduler em_accessory_order_recommendations runs at 07:00 and picks the new slips up.
   If the cross-namespace call (schedule -> automation) is refused when saving, paste the import body into the
   scheduler with startDate/endDate fixed to subDay(7)/today.

Open: Beau still exports the reports by hand. Options to remove that: a Power Automate flow that saves attachments from
the Equipment Shipped mail folder into the OneDrive folder (like the unit-counts flow), or SmartView scheduling the
report by email with that same flow catching it. The pipeline needs no change either way; it reads any .xlsx in the folder.
Deployed Oct 12: ship_parse 1.0.0 is live (health check returned). Deluge functions and schedule not yet created.
