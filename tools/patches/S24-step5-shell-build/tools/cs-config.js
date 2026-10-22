/* jpk-shell-config (CS): Beau CS Home. Spec section 7 with the section 11 decisions: S21 order (Numbers before Boards),
   Up-next above the tiles on narrow screens, step 4 "Close out" counts cases. */
window.JPK_SHELL = {
  home: 'cs',
  title: 'Beau CS Home',
  enabled: true,
  greeting: '#greeting',
  counts: [
    { key: 'meetings', label: 'meetings',   from: 'calendar.today',   zone: 'calendar' },
    { key: 'needs',    label: 'need you',   from: 'tiles.sum',        zone: '#needs-today' },
    { key: 'due',      label: 'due today',  from: 'agenda.today',     zone: '#agenda-card' },
    { key: 'approve',  label: 'to approve', from: 'alerts.approvals', zone: '#z-sm' }
  ],
  actions: [
    { id: 'markRenewed', label: 'Mark renewed', kind: 'view', view: 'renewals60', fallback: { kind: 'tab', module: 'Contracts' }, badge: 'tiles.renewals60', profiles: ['Administrator'], tip: 'Opens CS - Renewals due 60d. Mark each contract renewed on its record.' },
    { id: 'approveCollections', label: 'Approve collections email', kind: 'agendaRecordOrTab', module: 'Collection_Requests', source: 'collections', badge: 'alerts.collections', tip: 'Opens the collection request waiting for approval, or the list when there are several.' },
    { id: 'billingCheck', label: 'Billing check', kind: 'agendaRecordOrCreate', module: 'Billing_Periods', source: 'billing', badge: 'alerts.billing', profiles: ['Administrator'], tip: 'Opens this month\'s billing period, or a new one if it does not exist yet.' },
    { id: 'logLostDevice', label: 'Log lost device', kind: 'href', href: '', hideWhenMissing: true, tip: 'Opens Lost Devices.' },
    { id: 'newMeeting', label: 'New meeting', kind: 'meeting', mode: 'outlook', durationMin: 30, tip: 'Opens a new meeting in Outlook in a new tab.' }
  ],
  zones: {
    top:  ['#z-sm'],
    main: ['#needs-today', '#z-work', '#z-num', '#z-boards', '#dev-panel', '#z-rel'],
    side: ['jpk:calendar', '#agenda-card', '#z-ref'],
    narrowOrder: ['#z-sm', 'jpk:calendar', '#needs-today', '#agenda-card', '#z-work', '#z-num', '#z-boards', '#dev-panel', '#z-rel', '#z-ref'],
    sideWidth: 'clamp(320px, 30%, 400px)',
    stackPairsBelow: 900
  },
  calendar: {
    source: 'events', days: 7, owner: 'me', detailCap: 10, link: true, fallback: 'agenda',
    outlookUrl: 'https://outlook.office.com/calendar/view/day',
    help: 'Put a meeting on the Zoho CRM Calendar in Outlook to see it here.'
  },
  flow: [
    { n: 1, label: 'Alerts',                  count: 'alerts.all',       zones: ['#z-sm', '#agenda-card'] },
    { n: 2, label: 'Needs you today',         count: 'tiles.sum',        zones: ['#needs-today'] },
    { n: 3, label: 'Meetings and follow-ups', count: 'calendar.open+fu', zones: ['jpk:calendar', '#z-fu'] },
    { n: 4, label: 'Close out',               count: 'cases.mineOpen',   zones: ['#z-work'] }
  ],
  seed: { collapse: { 'bd-rel': true } }
};
