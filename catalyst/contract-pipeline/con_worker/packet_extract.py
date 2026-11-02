# packet_extract.py -- runs the Phase 3b (rates) and 3c (terms) extractors over a whole packet and
# applies later-document-wins. No Zoho calls: main.py feeds it the packet and hands the result to
# writeback.py. The golden tests call it directly.

from dataclasses import dataclass, field
from typing import List

from doc_classifier import classify
from rate_extractor import extract_rates, packet_pricing, program_fees, resolve_current, resolve_program_fees
from terms_extractor import extract_terms, resolve_terms
from text_norm import document_effective_date, split_pages

EXTRACT_TYPES = ("Base agreement", "Amendment", "Addendum", "Rate sheet")


@dataclass
class PacketDoc:
    name: str
    text: str                 # packet_reader text: PDF pages joined with \f
    doc_type: str = ""
    effective_date: str = None
    date_rule: str = ""
    upload_order: int = 0


@dataclass
class PacketResult:
    docs: List[PacketDoc]
    rate_rows: list
    superseded: list
    pricing: dict
    terms: dict
    notes: List[str] = field(default_factory=list)
    program_fees: list = field(default_factory=list)  # fixed monthly fee per program (own programs)


def extract_packet(docs, counterparty_type, contract_has_account, packet_name="packet.zip"):
    """docs: list[PacketDoc] (text filled, doc_type optional). contract_has_account: the Contract's
    Account lookup is set -- i.e. it's a program/customer-specific record (Allied Sheboygan) rather than
    a vendor's standard pricing record."""
    notes = []
    for i, d in enumerate(docs):
        d.upload_order = i
        if not d.doc_type:
            d.doc_type = classify(d.name, d.text)
        d.effective_date, d.date_rule = document_effective_date(d.name, d.text)
    # later-document-wins ordering: effective date, then upload order (Phase 0 fallback chain)
    ordered = sorted(docs, key=lambda d: (d.effective_date or "", d.upload_order))

    all_lines, doc_rates, doc_terms, all_fees = [], [], [], []
    for d in ordered:
        if d.doc_type not in EXTRACT_TYPES:
            continue
        pages = split_pages(d.text)
        dr = extract_rates(d.name, pages, d.effective_date, packet_name, counterparty_type)
        if dr.program and not contract_has_account:
            if dr.lines:
                notes.append("{}: pricing is specific to the program '{}' -- {} line(s) not applied to this "
                             "standard contract (they belong on that program's own Contract record)".format(
                                 d.name, dr.program, len(dr.lines)))
            dr.lines = []
        all_lines.extend(dr.lines)
        doc_rates.append((d.effective_date, d.name, dr))
        all_fees.extend(program_fees(d.name, pages, d.effective_date, packet_name))
        doc_terms.append((d.effective_date, d.doc_type,
                          extract_terms(d.name, pages, d.doc_type, d.effective_date, packet_name)))
        if not d.effective_date:
            notes.append("{}: no effective date found -- ordered by upload position".format(d.name))

    rows, superseded = resolve_current(all_lines)
    pricing = packet_pricing(doc_rates)
    notes.extend(pricing.pop("notes"))
    terms = resolve_terms(doc_terms)
    # Evergreen (Beau, 26 Oct 2026): renews until canceled, with no limit on renewals. Renewals_Allowed and
    # Renewal_Options_Left are whole-number fields, so they stay empty (a count read from one SOW, such as "up to four
    # extension terms", would be wrong for the contract). Contract_End_Date stays the end of the current term.
    ar = terms.get("Auto_Renews")
    if ar is not None and str(getattr(ar, "rule", "")).startswith("evergreen"):
        dropped = [k for k in ("Renewals_Allowed", "Renewal_Options_Left") if terms.pop(k, None) is not None]
        notes.append("Evergreen contract: renews until canceled, no limit on renewals. Renewals_Allowed and "
                     "Renewal_Options_Left are left empty{}. Contract_End_Date is the end of the current term.".format(
                         " (a count read from the paper was dropped: {})".format(", ".join(dropped)) if dropped else ""))
    return PacketResult(docs=ordered, rate_rows=rows, superseded=superseded, pricing=pricing,
                        terms=terms, notes=notes, program_fees=resolve_program_fees(all_fees))
