/* jpk-shell config examples (S24 step 5). The patch inlines ONE of these as <script id="jpk-shell-config"> before jpk-shell.js.
   Schema (spec section 7): every key has a default in jpk-shell.js; an unknown key is ignored with a console warning.
     home        string   'cs' | 'bd' | 'em': storage keys (jpk-shell-<home>, jpk-flow-<home>-<day>)
     title       string
     enabled     boolean  false = the shell never runs (same as ?shell=0)
     greeting    selector of the existing greeting (never written)
     crmBase     string   CRM tab base URL (default org882980956);  slugs: { Module: 'TabSlug' } for record/tab links
     counts      [{ key, label, from, zone }]       from: calendar.today | tiles.sum | agenda.today | alerts.approvals | tiles.<viewKey> | a+b
     actions     [{ id, label, kind, ...}]           kind: view | tab | create | href | meeting | agendaRecordOrTab | agendaRecordOrCreate
                 profiles: [profile names] (absent = everyone); hideWhenMissing: true = not rendered while the target is missing
                 badge: a count expression; tip: tooltip text
     zones       { top, main, side, narrowOrder: [ '#id' | 'jpk:calendar' ], sideWidth, stackPairsBelow, narrowBelow }
     calendar    { source: 'events'|'none', days, owner, detailCap, link, fallback: 'agenda'|'none', outlookUrl, help }
     flow        [{ n, label, count, zones, tip }]   count expressions as above, plus alerts.all, calendar.open, fu, cases.mineOpen, boards.selected
     seed        { collapse: { '<layout key>': true } }  first visit only (flag jpk-shell-seeded-<home>)            */

/* CS: Beau CS Home (the build in tools/cs-config.js is this object) */
var JPK_SHELL_CS_EXAMPLE = {
  home: 'cs', title: 'Beau CS Home', enabled: true, greeting: '#greeting',
  counts: [
    { key: 'meetings', label: 'meetings', from: 'calendar.today', zone: 'calendar' },
    { key: 'needs', label: 'need you', from: 'tiles.sum', zone: '#needs-today' },
    { key: 'due', label: 'due today', from: 'agenda.today', zone: '#agenda-card' },
    { key: 'approve', label: 'to approve', from: 'alerts.approvals', zone: '#z-sm' }
  ],
  actions: [
    { id: 'markRenewed', label: 'Mark renewed', kind: 'view', view: 'renewals60', fallback: { kind: 'tab', module: 'Contracts' }, badge: 'tiles.renewals60', profiles: ['Administrator'] },
    { id: 'approveCollections', label: 'Approve collections email', kind: 'agendaRecordOrTab', module: 'Collection_Requests', source: 'collections', badge: 'alerts.collections' },
    { id: 'billingCheck', label: 'Billing check', kind: 'agendaRecordOrCreate', module: 'Billing_Periods', source: 'billing', badge: 'alerts.billing', profiles: ['Administrator'] },
    { id: 'logLostDevice', label: 'Log lost device', kind: 'href', href: '', hideWhenMissing: true },
    { id: 'newMeeting', label: 'New meeting', kind: 'meeting', mode: 'outlook', durationMin: 30 }
  ],
  zones: {
    top: ['#z-sm'],
    main: ['#needs-today', '#z-work', '#z-num', '#z-boards', '#dev-panel', '#z-rel'],
    side: ['jpk:calendar', '#agenda-card', '#z-ref'],
    narrowOrder: ['#z-sm', 'jpk:calendar', '#needs-today', '#agenda-card', '#z-work', '#z-num', '#z-boards', '#dev-panel', '#z-rel', '#z-ref'],
    sideWidth: 'clamp(320px, 30%, 400px)', stackPairsBelow: 900
  },
  calendar: { source: 'events', days: 7, owner: 'me', detailCap: 10, link: true, fallback: 'agenda', outlookUrl: 'https://outlook.office.com/calendar/view/day', help: 'Put a meeting on the Zoho CRM Calendar in Outlook to see it here.' },
  flow: [
    { n: 1, label: 'Alerts', count: 'alerts.all', zones: ['#z-sm', '#agenda-card'] },
    { n: 2, label: 'Needs you today', count: 'tiles.sum', zones: ['#needs-today'] },
    { n: 3, label: 'Meetings and follow-ups', count: 'calendar.open+fu', zones: ['jpk:calendar', '#z-fu'] },
    { n: 4, label: 'Close out', count: 'cases.mineOpen', zones: ['#z-work'] }
  ],
  seed: { collapse: { 'bd-rel': true } }
};

/* BD: BD Home (ids to be checked against BD Home's own file before its patch) */
var JPK_SHELL_BD_EXAMPLE = {
  home: 'bd', title: 'BD Home', enabled: true, greeting: '#greeting',
  counts: [
    { key: 'meetings', label: 'meetings', from: 'calendar.today', zone: 'calendar' },
    { key: 'needs', label: 'need you', from: 'tiles.sum', zone: '#needs-today' },
    { key: 'due', label: 'due today', from: 'agenda.today', zone: '#agenda-card' }
  ],
  actions: [
    { id: 'newOpportunity', label: 'New opportunity', kind: 'create', module: 'Deals' },
    { id: 'newSolicitation', label: 'New solicitation', kind: 'href', href: '', hideWhenMissing: true },
    { id: 'coldProspects', label: 'Prospects gone cold', kind: 'view', view: 'bdColdProspects', badge: 'tiles.bdColdProspects' },
    { id: 'newMeeting', label: 'New meeting', kind: 'meeting', mode: 'outlook', durationMin: 30 }
  ],
  zones: {
    top: [], main: ['#needs-today', '#z-fu', '#z-boards', '#z-num'], side: ['jpk:calendar', '#agenda-card', '#z-ref'],
    narrowOrder: ['jpk:calendar', '#needs-today', '#agenda-card', '#z-fu', '#z-boards', '#z-num', '#z-ref']
  },
  calendar: { source: 'events', days: 7, owner: 'me', fallback: 'agenda' },
  flow: [
    { n: 1, label: 'Past close', count: 'tiles.bdPastClose', zones: ['#needs-today'] },
    { n: 2, label: 'Needs you today', count: 'tiles.sum', zones: ['#needs-today'] },
    { n: 3, label: 'Meetings and follow-ups', count: 'calendar.open+fu', zones: ['jpk:calendar', '#z-fu'] },
    { n: 4, label: 'Pipeline', count: 'tiles.bdProposals14', zones: ['#z-boards'] }
  ],
  seed: {}
};
