/* Demo data for the briefing steps widget (no Zoho). ?sol=new | drafted | reviewed | ready | briefed . Synthetic. */
(function (root) {
  'use strict';
  var USERS = [
    { id: 'u1', full_name: 'Beau Carrigan', status: 'active', profile: { name: 'Administrator' } },
    { id: 'u2', full_name: 'Dana Whitfield', status: 'active', profile: { name: 'Business Development' } },
    { id: 'u3', full_name: 'Priya Nair', status: 'active', profile: { name: 'Business Development' } },
    { id: 'u9', full_name: 'Former Employee', status: 'inactive', profile: { name: 'Business Development' } }
  ];
  var BASE = { id: 's1', Name: 'Charlotte CCPA EM Services 2026-09', Solicitation_Number: 'RFP-2026-114', Issuing_Agency: { id: 'a1', name: 'Charlotte CCPA' }, Proposal_Due: '2026-10-30T14:00:00-05:00', Release_Date: '2026-09-15', Questions_Round_1_Due: '2026-10-05T09:00:00-05:00', Anticipated_Award: '2026-12-01', Anticipated_Start: '2027-01-15',
    Briefing_Status: 'Not started', Bid_Decision: '-None-', Owner: { id: 'u1', name: 'Beau Carrigan' }, Created_By: { id: 'u1', name: 'Beau Carrigan' },
    Scope_of_Work: null, Submission_Requirements: null, Evaluation_Criteria: null, Key_Requirements_Summary: null };
  function mk(o) { return Object.assign(JSON.parse(JSON.stringify(BASE)), o); }
  var DRAFT = { Scope_of_Work: 'Supply and monitor GPS ankle devices for pretrial release for up to 120 participants. (Packet p. 4)', Submission_Requirements: 'One signed original and three copies. Price proposal in a separate sealed envelope. (Packet p. 9)', Evaluation_Criteria: 'Technical approach 40, Experience 25, Price 25, References 10. (Packet p. 11)', Key_Requirements_Summary: '42 device requirements; 12 are mandatory. (Requirements table)' };
  root.BRIEF_DEMO = {
    users: USERS, me: 'u1', attachments: { 'new': 0, drafted: 1, reviewed: 1, ready: 1, briefed: 1 },
    sols: {
      'new': mk({ Issuing_Agency: null, Issuing_Agency_Text: null, Proposal_Due: null, Release_Date: null, Questions_Round_1_Due: null, Anticipated_Award: null, Anticipated_Start: null }),
      drafted: mk(Object.assign({ Briefing_Status: 'Drafted from packet' }, DRAFT)),
      reviewed: mk(Object.assign({ Briefing_Status: 'Reviewed by RFP team' }, DRAFT)),
      ready: mk(Object.assign({ Briefing_Status: 'Reviewed by RFP team', Bid_Decision: 'Prime', Decision_Rationale: 'Fits our GPS lineup and the county renews in 2027.', Owner: { id: 'u2', name: 'Dana Whitfield' } }, DRAFT)),
      briefed: mk(Object.assign({ Briefing_Status: 'Briefed to leadership', Briefed_On: '2026-10-14', Bid_Decision: 'Prime', Decision_Rationale: 'Fits our GPS lineup.', Owner: { id: 'u2', name: 'Dana Whitfield' } }, DRAFT))
    }
  };
})(typeof window !== 'undefined' ? window : this);
