/* knowledge-data.js v1.0 (S43): lists and the demo records used when the page runs outside Zoho. */
(function (root) {
  'use strict';
  var DEVICES = {
    'Buddi': ['Alcotag'],
    'SuperCom': ['PureOne', 'PureProtect', 'PureBeacon'],
    'SCRAM': ['SCRAM CAM', 'SCRAM GPS', 'SCRAM Remote Breath', 'SCRAM House Arrest'],
    'Allied Universal': ['AT1'],
    'Sentinel': ['OM500'],
    'Other': []
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
      Steps: '<ol><li>Confirm the device is charged and the green light is on.</li><li>Ask the participant to go outside for 10 minutes.</li><li>Refresh the map. If still nothing, check the last communication time.</li><li>Escalate to SuperCom support with the device serial number.</li></ol>',
      Customer_safe_reply: 'Thanks for your patience. The device can take a little while to find its first location. Please take it outside for about 10 minutes. If it still has not reported, we will contact the manufacturer.', Customer_safe: true,
      Training_Path: '', Path_Step: '', Source_document: 'PureOne/PureMonitor Operational Training 1.0.1', Version: '1.0', Last_Reviewed: '2026-10-01', Review_Due: '2026-12-30', Status: 'Published' },
    { id: 'd2', Article_No: 'KA-2', Name: 'Enroll a participant in PureMonitor', Article_Type: 'Training', Vendor: 'SuperCom', Device: 'PureOne', Topic: 'Enrollment', Audience: ['EM Support'],
      Symptom_Trigger: '', Steps: '<ol><li>Open PureMonitor and choose New participant.</li><li>Enter the name and case number.</li><li>Scan the device serial number.</li><li>Save and check the device shows as Assigned.</li></ol>',
      Customer_safe_reply: '', Customer_safe: false, Training_Path: 'PureOne basics', Path_Step: '1', Source_document: 'PureOne/PureMonitor Operational Training 1.0.1', Version: '1.0', Last_Reviewed: '2026-10-01', Review_Due: '2026-12-30', Status: 'Published' },
    { id: 'd3', Article_No: 'KA-3', Name: 'Attach the AT1 strap', Article_Type: 'Training', Vendor: 'Allied Universal', Device: 'AT1', Topic: 'Installation', Audience: ['EM Support'],
      Symptom_Trigger: '', Steps: '<ol><li>Size the strap so one finger fits under it.</li><li>Seat the device on the ankle.</li><li>Fasten the strap with the installation tool.</li></ol>',
      Customer_safe_reply: '', Customer_safe: false, Training_Path: 'AT1 attach and removal', Path_Step: '1', Source_document: '1 Piece AT1 Attachment and Removal Guide', Version: '1.0', Last_Reviewed: '2026-10-01', Review_Due: '2026-12-30', Status: 'Published' },
    { id: 'd4', Article_No: 'KA-4', Name: 'Buddi Navigation basics', Article_Type: 'Training', Vendor: 'Buddi', Device: '', Topic: 'Other', Audience: ['EM Support', 'BD'],
      Symptom_Trigger: '', Steps: '<ol><li>Sign in to Buddi Navigation.</li><li>Find a participant from the list.</li><li>Open the map view.</li></ol>',
      Customer_safe_reply: '', Customer_safe: false, Training_Path: 'Buddi Navigation basics', Path_Step: '1', Source_document: 'Buddi Navigation Quick Start Guide', Version: '1.0', Last_Reviewed: '2026-10-01', Review_Due: '2026-12-30', Status: 'Published' },
    { id: 'd5', Article_No: 'KA-5', Name: 'Remote Breath test not completed', Article_Type: 'Troubleshooting', Vendor: 'SCRAM', Device: 'SCRAM Remote Breath', Topic: 'Events and Violations', Audience: ['EM Support', 'Customer-facing'],
      Symptom_Trigger: 'A scheduled breath test shows as Missed.',
      Steps: '<ol><li>Check the participant has a charged phone and signal.</li><li>Confirm the test window times.</li><li>Ask the participant to complete a retest.</li></ol>',
      Customer_safe_reply: 'A scheduled test was not completed. Please make sure your phone is charged and has signal, then complete a test as soon as you can.', Customer_safe: true,
      Training_Path: '', Path_Step: '', Source_document: 'Remote Breath Pro Troubleshooting', Version: '1.0', Last_Reviewed: '2026-06-01', Review_Due: '2026-08-30', Status: 'Published' }
  ];
  root.KN_DATA = { DEVICES: DEVICES, LISTS: LISTS, DEMO: DEMO };
})(window);
