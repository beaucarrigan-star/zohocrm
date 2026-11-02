"""Match a lead against Zoho Accounts/Contacts and create what is missing.

Rules (kept deliberately cautious for a first version):
  * An email already on a Contact is a duplicate: nothing is created.
  * Accounts match on company domain (website or work-email domain), then on
    exact organization name. Personal-email domains (gmail etc.) never match.
  * Zero account matches + an organization name -> create the Account.
  * More than one match anywhere -> "review": nothing is written, a person decides.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field

from .normalize import Lead
from .zoho import ZohoClient, ZohoError

CREATED, MATCHED, REVIEW, REJECTED, ERROR = (
    "created", "duplicate", "review", "rejected", "error")


@dataclass
class Result:
    status: str
    reasons: list = field(default_factory=list)
    actions: list = field(default_factory=list)   # what was (or would be) done
    account_id: str = ""
    contact_id: str = ""

    def as_dict(self):
        return self.__dict__.copy()


def esc(value: str) -> str:
    """Escape a value for a Zoho search criteria string."""
    for ch in ("\\", "(", ")", ","):
        value = value.replace(ch, "\\" + ch)
    return value


def find_contacts(zoho: ZohoClient, lead: Lead) -> list[dict]:
    if not lead.email:
        return []
    return zoho.search("Contacts", f"(Email:equals:{esc(lead.email)})", "id,Account_Name")


def find_accounts(zoho: ZohoClient, lead: Lead) -> list[dict]:
    seen: dict[str, dict] = {}
    dom = lead.company_domain
    queries = []
    if dom:
        queries += [f"(Email_Domains:contains:{esc(dom)})", f"(Website:contains:{esc(dom)})"]
    if lead.organization:
        queries.append(f"(Account_Name:equals:{esc(lead.organization)})")
    for crit in queries:
        for row in zoho.search("Accounts", crit, "id,Account_Name"):
            seen[row["id"]] = row
    return list(seen.values())


def _owner() -> dict:
    owner_id = os.environ.get("DEFAULT_OWNER_ID", "").strip()
    return {"Owner": {"id": owner_id}} if owner_id else {}


def account_record(lead: Lead) -> dict:
    rec = {"Account_Name": lead.organization or lead.company_domain}
    if lead.website:
        rec["Website"] = lead.website
    if lead.company_domain:
        rec["Email_Domains"] = lead.company_domain
    if lead.city:
        rec["Billing_City"] = lead.city
    if lead.state:
        rec["Billing_State"] = lead.state
    rec.update(_owner())
    return rec


def contact_record(lead: Lead, account_id: str) -> dict:
    rec = {"Last_Name": lead.last_name, "Account_Name": {"id": account_id}}
    for key, val in (("First_Name", lead.first_name), ("Email", lead.email),
                     ("Phone", lead.phone), ("Title", lead.title)):
        if val:
            rec[key] = val
    rec.update(_owner())
    return rec


def process(lead: Lead, zoho: ZohoClient, dry_run: bool = False) -> Result:
    problems = lead.problems()
    if problems:
        return Result(REJECTED, reasons=problems)

    try:
        contacts = find_contacts(zoho, lead)
        if len(contacts) == 1:
            return Result(MATCHED, reasons=["email already on a Contact"],
                          contact_id=contacts[0]["id"])
        if len(contacts) > 1:
            return Result(REVIEW, reasons=["email matches several Contacts"])

        accounts = find_accounts(zoho, lead)
        if len(accounts) > 1:
            names = ", ".join(a.get("Account_Name", a["id"]) for a in accounts[:5])
            return Result(REVIEW, reasons=[f"several possible Accounts: {names}"])

        res = Result(CREATED)
        if accounts:
            res.account_id = accounts[0]["id"]
            res.actions.append(f"use existing Account {accounts[0].get('Account_Name', res.account_id)}")
        elif lead.organization:
            res.actions.append(f"create Account '{lead.organization}'")
            if not dry_run:
                res.account_id = zoho.create("Accounts", account_record(lead))
        else:
            return Result(REVIEW, reasons=["no matching Account and no organization name to create one"])

        res.actions.append(f"create Contact {lead.first_name} {lead.last_name}".replace("  ", " "))
        if not dry_run:
            res.contact_id = zoho.create("Contacts", contact_record(lead, res.account_id))
            note = f"Source: {lead.source or 'unknown'}"
            if lead.notes:
                note += f"\n\n{lead.notes}"
            zoho.add_note("Contacts", res.contact_id, "Lead intake", note)
        return res
    except ZohoError as exc:
        return Result(ERROR, reasons=[str(exc)])
