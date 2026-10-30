/* knowledge-data.js v2.0 (30 Oct 2026): lists and the demo records used when the page runs outside Zoho.
   Pictures: write [img: vendor/device/file.jpg | Caption] anywhere in Steps. The file lives in the widget's img/ folder. */
(function (root) {
  'use strict';
  var DEVICES = {
    'Buddi': ['Alcotag', 'AlcoBreath'],
    'SuperCom': ['PureOne', 'PureProtect', 'PureBeacon'],
    'SCRAM': ['SCRAM CAM', 'SCRAM GPS', 'SCRAM Remote Breath', 'SCRAM House Arrest'],
    'Allied Universal': ['AT1'],
    'Sentinel': ['OM500'],
    'Other': []
  };
  /* One line per vendor on the Home screen, so a new person knows what each one is. */
  var VENDOR_NOTES = {
    'Buddi': 'Alcotag and AlcoBreath alcohol monitors, Buddi Navigation (Eagle) software',
    'SuperCom': 'PureOne GPS tag, PureProtect, PureBeacon, PureMonitor and PureShield software',
    'SCRAM': 'CAM, GPS, Remote Breath and House Arrest devices',
    'Allied Universal': 'AT1 one-piece GPS tag, EM Manager software',
    'Sentinel': 'OM500 GPS tag, SentinelDNA software',
    'Other': 'Anything not tied to one vendor'
  };
  var LISTS = {
    vendors: ['Buddi', 'SuperCom', 'SCRAM', 'Allied Universal', 'Sentinel', 'Other'],
    types: ['Troubleshooting', 'Training', 'Reference'],
    topics: ['Enrollment', 'Installation', 'Zones and Schedules', 'Events and Violations', 'Removal', 'Users and Permissions', 'Reports', 'Billing and Returns', 'Other'],
    audiences: ['EM Support', 'BD', 'Leadership', 'Customer-facing']
  };
  /* Same shape as the Zoho records (API names). Demo only. */
  var DEMO = [
    { id: 'd1', Article_No: 'KA-1', Name: 'No GPS point after enrollment', Article_Type: 'Troubleshooting', Vendor: 'SuperCom', Device: 'PureOne', Topic: 'Enrollment', Audience: ['EM Support', 'Customer-facing'],
      Symptom_Trigger: 'The participant is enrolled but no location point has appeared on the map after 30 minutes.',
      Steps: '<ol><li>Confirm the device is charged and the green light is on.<br>[img: supercom/pureone/pureone-p20-14.jpg | A charged PureOne shows a steady green light]</li><li>Ask the participant to go outside for 10 minutes.</li><li>Refresh the map. If still nothing, check the last communication time on the Equipment tab.<br>[img: supercom/pureone/pureone-p20-15.jpg | The Equipment tab shows the last contact time]</li><li>Escalate to SuperCom support with the device serial number.</li></ol>',
      Customer_safe_reply: 'Thanks for your patience. The device can take a little while to find its first location. Please take it outside for about 10 minutes. If it still has not reported, we will contact the manufacturer.', Customer_safe: true,
      Training_Path: '', Path_Step: '', Source_document: 'PureOne/PureMonitor Operational Training 1.0.1', Version: '1.0', Last_Reviewed: '2026-10-01', Review_Due: '2026-12-30', Used_on_cases_30d: 4, Status: 'Published' },
    { id: 'd2', Article_No: 'KA-2', Name: 'Enroll a participant in PureMonitor', Article_Type: 'Training', Vendor: 'SuperCom', Device: 'PureOne', Topic: 'Enrollment', Audience: ['EM Support'],
      Symptom_Trigger: '', Steps: '<ol><li>Open PureMonitor and choose New participant.</li><li>Enter the name and ID. The Pure ID must be unique.<br>[img: supercom/pureone/pureone-p12-6.jpg | Personal details screen]</li><li>Fill in the contact details and the program details.<br>[img: supercom/pureone/pureone-p14-8.jpg | Program details screen]</li><li>Scan the device serial number, save, and check the device shows as Assigned.</li></ol>',
      Customer_safe_reply: '', Customer_safe: false, Training_Path: 'PureOne basics', Path_Step: '1', Source_document: 'PureOne/PureMonitor Operational Training 1.0.1', Version: '1.0', Last_Reviewed: '2026-10-01', Review_Due: '2026-12-30', Used_on_cases_30d: 0, Status: 'Published' },
    { id: 'd3', Article_No: 'KA-3', Name: 'Attach the AT1 strap', Article_Type: 'Training', Vendor: 'Allied Universal', Device: 'AT1', Topic: 'Installation', Audience: ['EM Support'],
      Symptom_Trigger: '', Steps: '<p>You need the device, a strap, and the strap installation tool.</p><p>[img: allied/at1/at1-ar-p07-1.jpg | The AT1 one-piece device and strap]</p><ol><li>Size the strap so one finger fits under it.</li><li>Seat the device on the ankle.<br>[img: allied/at1/at1-ar-p08-2.jpg | Seat the device flat against the ankle]</li><li>Fasten the strap with the installation tool.<br>[img: allied/at1/at1-ar-p09-5.jpg | Press the strap pin in with the tool]</li></ol>',
      Customer_safe_reply: '', Customer_safe: false, Training_Path: 'AT1 attach and removal', Path_Step: '1', Source_document: '1 Piece AT1 Attachment and Removal Guide', Version: '1.0', Last_Reviewed: '2026-10-01', Review_Due: '2026-12-30', Used_on_cases_30d: 1, Status: 'Published' },
    { id: 'd4', Article_No: 'KA-4', Name: 'Buddi Navigation basics', Article_Type: 'Training', Vendor: 'Buddi', Device: '', Topic: 'Other', Audience: ['EM Support', 'BD'],
      Symptom_Trigger: '', Steps: '<ol><li>Sign in to Buddi Navigation.</li><li>Find a participant (a "wearer") from the list.</li><li>Open the map view and choose Get an updated location.<br>[img: buddi/navigation/navigation-p07-4.jpg | Get an updated location, then click Save]</li></ol>',
      Customer_safe_reply: '', Customer_safe: false, Training_Path: 'Buddi Navigation basics', Path_Step: '1', Source_document: 'Buddi Navigation Quick Start Guide', Version: '1.0', Last_Reviewed: '2026-10-01', Review_Due: '2026-12-30', Used_on_cases_30d: 0, Status: 'Published' },
    { id: 'd5', Article_No: 'KA-5', Name: 'Remote Breath test not completed', Article_Type: 'Troubleshooting', Vendor: 'SCRAM', Device: 'SCRAM Remote Breath', Topic: 'Events and Violations', Audience: ['EM Support', 'Customer-facing'],
      Symptom_Trigger: 'A scheduled breath test shows as Missed.',
      Steps: '<ol><li>Check the participant has a charged phone and signal.</li><li>Confirm the test window times.</li><li>Ask the participant to complete a retest.</li></ol>',
      Customer_safe_reply: 'A scheduled test was not completed. Please make sure your phone is charged and has signal, then complete a test as soon as you can.', Customer_safe: true,
      Training_Path: '', Path_Step: '', Source_document: 'Remote Breath Pro Troubleshooting', Version: '1.0', Last_Reviewed: '2026-06-01', Review_Due: '2026-08-30', Used_on_cases_30d: 7, Status: 'Published' },
    { id: 'd6', Article_No: 'KA-6', Name: 'Set a curfew on the OM500', Article_Type: 'Training', Vendor: 'Sentinel', Device: 'OM500', Topic: 'Zones and Schedules', Audience: ['EM Support'],
      Symptom_Trigger: '', Steps: '<ol><li>Open the participant in SentinelDNA.</li><li>Open the Schedule tab and choose Add curfew.</li><li>Set the days and the in-by and out-after times, then save.<br>[img: sentinel/om500/om500-p15-25.png | The commands screen in SentinelDNA]</li></ol>',
      Customer_safe_reply: '', Customer_safe: false, Training_Path: 'OM500 basics', Path_Step: '2', Source_document: 'OM500 Instruction Manual', Version: '1.0', Last_Reviewed: '2026-10-30', Review_Due: '2027-01-28', Used_on_cases_30d: 0, Status: 'Published' },
    { id: 'd7', Article_No: 'KA-7', Name: 'Put on the OM500', Article_Type: 'Training', Vendor: 'Sentinel', Device: 'OM500', Topic: 'Installation', Audience: ['EM Support'],
      Symptom_Trigger: '', Steps: '<ol><li>Fit the strap around the ankle and seat the device.<br>[img: sentinel/om500/om500-p07-5.jpg | Strap seated in the device]</li><li>Insert the top (oval) pin and the bottom pin. The top pin only fits one way.<br>[img: sentinel/om500/om500-p08-12.jpg | Pin orientation]</li><li>Check the device reads Locked.<br>[img: sentinel/om500/om500-p07-11.jpg | Locked]</li></ol>',
      Customer_safe_reply: '', Customer_safe: false, Training_Path: 'OM500 basics', Path_Step: '1', Source_document: 'OM500 Instruction Manual', Version: '1.0', Last_Reviewed: '2026-10-30', Review_Due: '2027-01-28', Used_on_cases_30d: 0, Status: 'Published' }
  ];
  root.KN_DATA = { DEVICES: DEVICES, VENDOR_NOTES: VENDOR_NOTES, LISTS: LISTS, DEMO: DEMO };
})(window);
