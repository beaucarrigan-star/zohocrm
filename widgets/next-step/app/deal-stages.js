/* Next step v1.2.0 (S64, 2 Nov 2026): stage list for each Deals pipeline, in path order.
   Source: the S55 table, checked against the live Deals layout (Pipeline > Stage map) on 2 Nov 2026 (S64), same order.
   Used when the widget cannot read the pipelines live (ZOHO.CRM.META.getLayouts). Change both places together. */
(function (root) {
  var STAGES = {
    'JusticePoint EM': ['Prospecting', 'Discovery', 'Demo/Pilot Approved', 'Pilot Running', 'Proposal Submitted', 'Contract Negotiation', 'Closed Won', 'Closed Lost'],
    'JusticePoint Programs': ['Prospecting', 'Discovery', 'Program Design/Scoping', 'Budget Proposal', 'Contract Negotiation', 'County/Board Approval', 'Closed Won', 'Closed Lost'],
    'Sirona Programs': ['Prospecting', 'Discovery', 'Site Visit / Capacity Review', 'RFP/Procurement Event', 'Budget Proposal', 'Contract and Credentialing', 'Closed Won', 'Closed Lost'],
    'TDP Pipeline': ['Prospecting', 'Discovery', 'Solution Development', 'Proposal Submitted', 'Contract Negotiation', 'Closed Won', 'Closed Lost'],
    'Standard Pipeline': ['Prospecting', 'Discovery', 'Proposal Submitted', 'Contract Negotiation', 'Closed Won', 'Closed Lost']
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = STAGES; else root.NS_DEAL_STAGES = STAGES;
})(typeof window !== 'undefined' ? window : this);
