import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from lead_intake import adapters
from lead_intake.normalize import build_lead, normalize_phone
from lead_intake.pipeline import CREATED, ERROR, MATCHED, REJECTED, REVIEW, esc, process
from lead_intake.zoho import ZohoError


class FakeZoho:
    def __init__(self, contacts=None, accounts=None, fail_on=None):
        self.contacts = contacts or []
        self.accounts = accounts or []
        self.created = []
        self.notes = []
        self.fail_on = fail_on

    def search(self, module, criteria, fields="id"):
        return list(self.contacts if module == "Contacts" else self.accounts)

    def create(self, module, record):
        if self.fail_on == module:
            raise ZohoError("boom")
        self.created.append((module, record))
        return f"{module[:3].lower()}-{len(self.created)}"

    def add_note(self, module, rid, title, content):
        self.notes.append((module, rid, content))


def lead(**kw):
    base = dict(first_name="Ana", last_name="Ruiz", email="ana@county.gov",
                organization="Travis County", source="web_form")
    base.update(kw)
    return build_lead(**base)


def test_creates_account_and_contact_when_nothing_matches():
    z = FakeZoho()
    r = process(lead(), z)
    assert r.status == CREATED
    assert [m for m, _ in z.created] == ["Accounts", "Contacts"]
    assert z.created[1][1]["Account_Name"] == {"id": r.account_id}
    assert z.notes and "web_form" in z.notes[0][2]


def test_existing_account_is_reused():
    z = FakeZoho(accounts=[{"id": "A1", "Account_Name": "Travis County"}])
    r = process(lead(), z)
    assert r.status == CREATED and r.account_id == "A1"
    assert [m for m, _ in z.created] == ["Contacts"]


def test_duplicate_contact_creates_nothing():
    z = FakeZoho(contacts=[{"id": "C1"}])
    r = process(lead(), z)
    assert r.status == MATCHED and r.contact_id == "C1" and not z.created


def test_ambiguous_accounts_go_to_review():
    z = FakeZoho(accounts=[{"id": "A1", "Account_Name": "X"}, {"id": "A2", "Account_Name": "Y"}])
    r = process(lead(), z)
    assert r.status == REVIEW and not z.created


def test_missing_last_name_rejected():
    assert process(lead(last_name="", full_name=""), FakeZoho()).status == REJECTED


def test_free_email_without_org_is_rejected():
    r = process(lead(email="ana@gmail.com", organization=""), FakeZoho())
    assert r.status == REJECTED


def test_dry_run_writes_nothing():
    z = FakeZoho()
    r = process(lead(), z, dry_run=True)
    assert r.status == CREATED and not z.created and len(r.actions) == 2


def test_zoho_failure_reported_not_raised():
    r = process(lead(), FakeZoho(fail_on="Accounts"))
    assert r.status == ERROR


def test_criteria_escaping():
    assert esc("Smith, Jones (LLC)") == "Smith\\, Jones \\(LLC\\)"


def test_phone_format():
    assert normalize_phone("1-512-555-0100") == "(512) 555-0100"


def test_csv_aliases_and_blank_rows():
    text = "Company,Contact Name,E-mail,Phone\nTravis County,Ana Ruiz,ANA@county.gov,512.555.0100\n,,,\n"
    rows = adapters.from_csv(text)
    assert len(rows) == 1
    row_no, l = rows[0]
    assert row_no == 2 and l.organization == "Travis County"
    assert (l.first_name, l.last_name, l.email) == ("Ana", "Ruiz", "ana@county.gov")


def test_form_synonyms_and_extra():
    l = adapters.from_form({"company": "Travis County", "full_name": "Ana Ruiz",
                            "email": "ana@county.gov", "utm": "x"})
    assert l.organization == "Travis County" and l.last_name == "Ruiz"
    assert l.extra == {"utm": "x"} and l.source == "web_form"


def test_email_labeled_body():
    raw = ("From: \"Ana Ruiz\" <ana@county.gov>\nSubject: Interested\n\n"
           "Company: Travis County\nPhone: 512-555-0100\n")
    l = adapters.from_email(raw)
    assert l.email == "ana@county.gov" and l.organization == "Travis County"
    assert l.last_name == "Ruiz" and l.source == "email"
