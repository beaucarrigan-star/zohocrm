# test_own_programs.py -- 26 Oct 2026. JusticePoint's OWN programs (Milwaukee County Pretrial: a master agreement plus
# four SOWs, paid as a fixed monthly fee per program) read differently from the EM device contracts. Every case below
# failed or gave a wrong value on the real Milwaukee packet before this change. The fixture text is short excerpts of
# the packet's wording, not the signed documents.
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "con_worker"))

import pytest

import packet_reader
import rate_extractor as rx
import terms_extractor as te
import text_norm as tn
import zoho_client as zc
from packet_extract import PacketDoc, extract_packet

SOW1 = ("MILWAUKEE COUNTY COURTS SOW #1 to the Master Agreement 2 PREAMBLE This STATEMENT OF WORK # 1 to the Master Service "
        "Agreement (the “MSA”), dated January 1, 2024, is between Milwaukee County and JusticePoint, Inc. 3 TERM "
        "3.1 INITIAL TERM The Initial Term of SOW 1 shall commence on January 1, 2024 (the “Effective Date”) and "
        "continue in full force and effect until December 31, 2024, unless terminated in accordance with the MSA. "
        "3.2 EXTENSION TERMS The Parties may enter into up to four (4) additional twelve (12) month Extension Terms (2025, "
        "2026, 2027, and 2028) under the same terms and conditions of this SOW 1 and the MSA. To exercise the option to "
        "enter an Extension Term, the County must provide the Contractor with written notice of intent no less than thirty "
        "(30) days from the date of expiration of the Initial Term.")

AMEND2 = ("AMENDMENT #2 TO SOW #1 This AMENDMENT # 2 to SOW #1 of the Master Service Agreement (the “MSA”), dated "
          "January 1, 2026 (the “Effective Date”), is between Milwaukee County and JusticePoint, Inc. "
          "3.1 EXTENSION; DEFINITIONS The Parties hereby extend the term of SOW #1 through December 31, 2026. The period from "
          "the Effective Date through December 31, 2026 shall be referred to herein as the “Amendment #2 Term.” "
          "Section 5: Compensation is amended to read as follows: The County shall compensate the Contractor for all Services "
          "in this SOW #1 as a fixed monthly fee following Figure 5-2: Amendment #2 Term Fixed Fees. The Contractor may not "
          "charge more than 12% of the value of the total direct costs for the program in administrative costs. "
          "Figure 5-2: Amendment #2 Term Fixed Fees Program Monthly Fee Annual Spend Universal Screening $94,528.20 "
          "$1,134,338.45 Release Preparation $11,676.88 $140,122.53 Assessments $18,982.30 $227,787.62 "
          "GRAND TOTAL: $1,502,248.60 The total compensation due to the Contractor under this SOW #1 shall not exceed "
          "$1,502,248.60 throughout the Amendment #2 Term unless expressly authorized by the County in writing.")

AMEND2_SOW2 = ("AMENDMENT # 2 to SOW #2 of the Master Service Agreement dated January 1, 2026 (the “Effective Date”). "
               "The Parties hereby extend the term of SOW #2 through December 31, 2026. "
               "Figure 4-2: Amendment #2 Term Pretrial Supervision Compensation Program Monthly Fee Annual Spend "
               "Court Reminders $5,409.04 $64,908.48 Pretrial Case Management $173, 318.14 $2,079,817.64 "
               "GRAND TOTAL: $2,144,726.12 The total compensation due to the Contractor under this SOW #2 shall not exceed "
               "$2,144,726.12 throughout the Amendment #2 Term unless expressly authorized by the County in writing.")


def pages(txt):
    return tn.split_pages(txt)


# ---- dates ----------------------------------------------------------------------------------------------------
def test_effective_date_is_the_date_before_the_label_not_an_end_date():
    iso, how = tn.document_effective_date("MKE_Courts_SOW_Amendments_2026.pdf", AMEND2)
    assert iso == "2026-01-01", (iso, how)  # was 2026-12-31: "from the Effective Date through December 31, 2026"


def test_msa_effective_date_not_the_file_name_date():
    iso, _ = tn.document_effective_date("2023_01_09_Master_Agreement.pdf", SOW1)
    assert iso == "2024-01-01"


def test_effective_date_label_still_works_when_a_date_follows_it():
    iso, how = tn.document_effective_date("x.pdf", "This Agreement. Effective Date: March 3, 2025. More text follows here.")
    assert iso == "2025-03-03" and how == "Effective Date label"


# ---- terms ----------------------------------------------------------------------------------------------------
def terms_of(txt, doc_type="Base agreement"):
    return {f.field: f for f in te.extract_terms("d.pdf", pages(txt), doc_type, None)}


def test_initial_term_start_and_end_in_one_sentence():
    t = terms_of(SOW1)
    assert t["Contract_Start_Date"].value == "2024-01-01"
    assert t["Contract_End_Date"].value == "2024-12-31"
    assert t["Original_End_Date"].value == "2024-12-31"
    assert t["Renewals_Allowed"].value == 4 and t["Renewal_Option_Length_Mo"].value == 12
    assert t["Auto_Renews"].value == "No"            # extension terms are by the County's written notice
    assert t["Notice_Period_Days"].value == 30


def test_amendment_extends_the_term_with_words_between_term_and_date():
    t = terms_of(AMEND2, "Amendment")
    assert t["Contract_End_Date"].value == "2026-12-31"
    assert "Contract_Start_Date" not in t              # an amendment's own dates never move the start


def test_evergreen_cover_sheet_is_automatic_renewal_until_canceled():
    # Beau, 26 Oct 2026: Evergreen means it auto renews unless canceled, even when the sheet says "Renewable: No"
    cover = "Executed on: January 1, 2024 Renewable: No - Evergreen Expires on: N/A - Evergreen Renewal Process: Evergreen"
    assert terms_of(cover)["Auto_Renews"].value == "Yes"


def test_not_renewable_without_evergreen_is_not_automatic():
    assert terms_of("Renewable: No Expires on: December 31, 2026")["Auto_Renews"].value == "No"


def test_evergreen_alone_still_means_auto_renew():
    assert terms_of("This Agreement shall be evergreen and renew each year.")["Auto_Renews"].value == "Yes"


def test_insurance_budget_line_is_not_a_limit():
    budget = ("Liability Insurance JusticePoint estimates that it will incur $6,776.25 in Liability Insurance expenses in "
              "2024 and subsequent years. This amount represents $325 in Liability Insurance costs per FTE.")
    assert "Insurance_Limit" not in terms_of(budget)


def test_insurance_limit_from_the_standard_requirements_form():
    form = ("1. Commercial General Liability Insurance, including contractual coverage: The Vendor shall maintain Commercial "
            "General Liability insurance with the following minimum limits for bodily injury and property damage combined: "
            "Each Occurrence Limit $1,000,000 General Aggregate Limit $2,000,000 Products Completed Operations Limit $2,000,000.")
    assert terms_of(budget_then(form))["Insurance_Limit"].value == 1000000.0


def budget_then(form):
    return ("JusticePoint estimates that it will incur $6,776.25 in Liability Insurance expenses in 2024. ") + form


def test_budget_table_dump_is_not_an_escalator():
    dump = ("Proliant $680.00 Software Name $ - Software Name $ - Vehicle Expenses Fuel Costs $ - Bus Passes Client "
            "Transportation $600.00 annual increase rate fee 2% " + "x " * 20)
    assert "Escalator_Pct" not in terms_of(dump)


def test_escalator_still_read_from_a_real_clause():
    assert terms_of("Prices will increase by 3% each year on the anniversary of this Agreement.")["Escalator_Pct"].value == 3.0


def test_one_cap_per_sow_is_summed():
    t = terms_of(AMEND2 + " " + AMEND2_SOW2, "Amendment")
    f = t["Not_To_Exceed"]
    assert f.value == round(1502248.60 + 2144726.12, 2) and f.confidence == "Medium"
    assert "SOW 1 $1,502,248.60" in f.rule and "SOW 2 $2,144,726.12" in f.rule


def test_single_cap_unchanged():
    f = terms_of("The total compensation shall not exceed $250,000.00 for the term of this Agreement.")["Not_To_Exceed"]
    assert f.value == 250000.0 and f.confidence == "High"


# ---- fixed monthly fees per program ---------------------------------------------------------------------------
def test_program_fee_table_is_read_with_sow_and_checks():
    fees = rx.program_fees("a.pdf", pages(AMEND2), "2026-01-01", "p.zip")
    assert [(f.sow, f.program, f.monthly, f.annual) for f in fees] == [
        (1, "Universal Screening", 94528.20, 1134338.45), (1, "Release Preparation", 11676.88, 140122.53),
        (1, "Assessments", 18982.30, 227787.62)]
    assert all(f.check == "" for f in fees)
    assert fees[0].caption.startswith("Figure 5-2: Amendment #2 Term Fixed Fees")


def test_program_fee_with_a_stray_space_after_the_comma():
    fees = rx.program_fees("a.pdf", pages(AMEND2_SOW2), None)
    assert {f.program: f.monthly for f in fees}["Pretrial Case Management"] == 173318.14


def test_a_table_that_does_not_add_up_says_so():
    bad = AMEND2.replace("GRAND TOTAL: $1,502,248.60", "GRAND TOTAL: $9,999,999.00")
    assert all("rows add to" in f.check for f in rx.program_fees("a.pdf", pages(bad), None))


def test_packet_gives_fixed_basis_fees_and_no_rate_lines():
    docs = [PacketDoc("sow1.pdf", SOW1), PacketDoc("amend2_sow1.pdf", AMEND2)]
    res = extract_packet(docs, "Customer", True, "p.zip")
    assert res.pricing["rate_basis"] == "Fixed"
    assert res.pricing["admin_rate_pct"] is None            # the 12% is a cap, not a cost-plus mark-up
    assert any("Administrative cost cap: 12%" in n for n in res.notes)
    assert res.rate_rows == []                               # monthly program fees are never Rate Lines
    assert len(res.program_fees) == 3
    assert res.terms["Contract_End_Date"].value == "2026-12-31" and res.terms["Original_End_Date"].value == "2024-12-31"


def test_later_document_wins_per_program():
    old = AMEND2.replace("$94,528.20 $1,134,338.45", "$90,000.00 $1,080,000.00").replace("$1,502,248.60", "$1,447,910.15")
    docs = [PacketDoc("old.pdf", old), PacketDoc("new.pdf", AMEND2)]
    docs[0].effective_date = None
    res = extract_packet(docs, "Customer", True, "p.zip")
    assert {f.program: f.monthly for f in res.program_fees}["Universal Screening"] == 94528.20


# ---- reader ---------------------------------------------------------------------------------------------------
def test_cid_stamp_only_page_is_not_a_text_page():
    stamp = "(cid:14)(cid:16)(cid:24)(cid:26)(cid:18)(cid:20)(cid:27)(cid:29)(cid:26)(cid:28)(cid:21)(cid:23)(cid:20)(cid:22)"
    cleaned = packet_reader._CID.sub(" ", stamp)
    assert len("".join(cleaned.split())) == 0
    body = "Section 5 Compensation is amended as follows. " * 3
    assert packet_reader._text_layer_ok([body, cleaned, cleaned]) is False   # 1 of 3 pages has text
    assert packet_reader._text_layer_ok([body, body, cleaned]) is True


def test_page_list_collapses_runs():
    import main
    assert main._page_list([21, 22, 23, 45, 50, 51]) == "21-23, 45, 50-51"


# ---- download check -------------------------------------------------------------------------------------------
class FakeResp:
    def __init__(self, body, status=200):
        self.content, self.status_code, self.reason, self.url = body, status, "OK", "https://x/Attachments/1"
        self.headers = {"Content-Type": "application/zip", "Content-Length": str(len(body))}
        self.text = ""


def _download(monkeypatch, bodies, size, name="Packet.zip"):
    calls = iter(bodies)
    monkeypatch.setattr(zc.requests, "get", lambda *a, **k: FakeResp(next(calls)))
    monkeypatch.setattr(zc, "_headers", lambda: {})
    monkeypatch.setattr(zc.time, "sleep", lambda s: None)
    return zc.download_attachment("Contracts", "1", "2", expected_size=size, file_name=name)


def test_download_retries_a_short_body(monkeypatch):
    good = b"PK" + b"\0" * 98
    assert _download(monkeypatch, [good[:40], good], "100") == good


def test_download_that_stays_damaged_says_what_arrived(monkeypatch):
    with pytest.raises(IOError) as e:
        _download(monkeypatch, [b"<html>error</html>"] * 3, "100")
    assert "got 18 bytes, Zoho lists 100" in str(e.value) and "zip signature" in str(e.value)


def test_download_without_a_listed_size_only_checks_the_signature(monkeypatch):
    assert _download(monkeypatch, [b"PKabc"], None) == b"PKabc"


def test_evergreen_leaves_renewal_counts_empty_and_says_no_limit():
    from packet_extract import PacketDoc, extract_packet
    cover = ("Master Agreement. Executed on: January 1, 2024 Renewable: No - Evergreen Expires on: N/A - Evergreen "
             "Renewal Process: Evergreen. The Parties may enter into up to four (4) additional twelve (12) month "
             "Extension Terms (2025, 2026, 2027, and 2028) under the same terms.")
    r = extract_packet([PacketDoc("Agreement.pdf", cover)], "Customer", True, "p")
    assert r.terms["Auto_Renews"].value == "Yes"
    assert "Renewals_Allowed" not in r.terms and "Renewal_Options_Left" not in r.terms
    assert any("no limit on renewals" in n for n in r.notes)


def test_non_evergreen_keeps_renewal_counts():
    from packet_extract import PacketDoc, extract_packet
    t = ("Agreement. The Parties may enter into up to two (2) additional twelve (12) month Extension Terms under the "
         "same terms.")
    r = extract_packet([PacketDoc("Agreement.pdf", t)], "Customer", True, "p")
    assert r.terms.get("Renewals_Allowed") is not None and r.terms["Renewals_Allowed"].value == 2
