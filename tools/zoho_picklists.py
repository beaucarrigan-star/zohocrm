#!/usr/bin/env python3
"""Zoho picklist changes for the S52 pricing sign-off.

  1. Cases > Case_Category: add "Pricing sign-off" and "Deal review".
  2. Pricing Scenarios > Vendor_Source: rename "JP-owned fleet" to "Purchased Devices".

DRY RUN BY DEFAULT. It reads Zoho, prints exactly what it would change, and writes nothing
unless you pass --apply. After a write it reads the field back and checks the result.

  python tools/zoho_picklists.py                       # show the plan for both
  python tools/zoho_picklists.py --only cases --apply  # add the two Case Category values
  python tools/zoho_picklists.py --only vendor --apply --confirm-v94-ready

The Vendor Source rename is order-sensitive: do it right before uploading Pricing Studio v94.
Until both are done, a Studio save would write a value Zoho lacks and drop Vendor_Source from
that save. --confirm-v94-ready is the gate that makes you say so.

UNTESTED against live Zoho. The write call follows Zoho CRM's field-metadata update API, but it
has only been tested here against fake responses. The read-back check exists so a surprise shows up
immediately. If a write fails, nothing is lost: fix the value by hand in Setup > Modules and Fields.

Settings (environment variables, or a KEY=VALUE file passed with --env-file; never commit them):
  ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET
  ZOHO_SETTINGS_REFRESH_TOKEN   a refresh token created with the scope ZohoCRM.settings.fields.ALL
                                (falls back to ZOHO_REFRESH_TOKEN, which usually lacks that scope)
  ZOHO_ACCOUNTS_URL, ZOHO_API_URL   only if your data center is not US
"""
from __future__ import annotations

import argparse
import os
import sys
import time

CASE_NEW = ["Pricing sign-off", "Deal review"]
VENDOR_OLD, VENDOR_NEW = "JP-owned fleet", "Purchased Devices"


class PlanError(RuntimeError):
    pass


class ZohoError(RuntimeError):
    pass


# ---- pure planning (no network) -----------------------------------------------------------
def norm(s) -> str:
    return (s or "").strip().lower()


def has(values, name) -> bool:
    return any(norm(v.get("display_value")) == norm(name) or norm(v.get("actual_value")) == norm(name)
               for v in values)


def keep(values) -> list[dict]:
    """Existing values in the shape the update call takes. Zoho adds '-None-' itself."""
    return [{"id": v["id"], "display_value": v["display_value"], "actual_value": v["actual_value"]}
            for v in values if v.get("actual_value") != "-None-"]


def plan_add(values, names):
    """Return (payload or None, list of names being added)."""
    missing = [n for n in names if not has(values, n)]
    if not missing:
        return None, []
    payload = keep(values) + [{"display_value": n, "actual_value": n} for n in missing]
    return payload, missing


def plan_rename(values, old, new):
    """Return (payload or None, description). Both the label and the stored value become `new`,
    because the Studio writes the stored value; a label-only rename would leave 'JP-owned fleet'
    as the value Zoho accepts."""
    if has(values, new) and not has(values, old):
        return None, f"'{new}' already exists and '{old}' is gone: nothing to do"
    if has(values, new) and has(values, old):
        raise PlanError(f"both '{old}' and '{new}' exist; resolve by hand in Zoho first")
    if not has(values, old):
        raise PlanError(f"neither '{old}' nor '{new}' found on the field")
    payload = []
    for v in keep(values):
        if norm(v["display_value"]) == norm(old) or norm(v["actual_value"]) == norm(old):
            v = {**v, "display_value": new, "actual_value": new}
        payload.append(v)
    return payload, f"rename '{old}' to '{new}' (same id, so records holding it follow)"


def verify_add(values, names) -> list[str]:
    return [n for n in names if not any(v.get("display_value") == n and v.get("actual_value") == n for v in values)]


def verify_rename(values, old_id, new) -> str | None:
    row = next((v for v in values if v.get("id") == old_id), None)
    if row is None:
        return "the renamed value is no longer on the field"
    if row.get("display_value") != new:
        return f"label is '{row.get('display_value')}', expected '{new}'"
    if row.get("actual_value") != new:
        return (f"stored value is still '{row.get('actual_value')}': Zoho changed the label only. "
                f"Studio v94 writes '{new}', which Zoho would reject. Fix by hand: add '{new}' as a new value "
                f"and delete the old one (safe only while no Pricing Scenario holds the old value)")
    return None


# ---- Zoho client ---------------------------------------------------------------------------
class Zoho:
    def __init__(self, env=None, session=None):
        import requests
        e = env if env is not None else os.environ
        self.cid, self.secret = e.get("ZOHO_CLIENT_ID", ""), e.get("ZOHO_CLIENT_SECRET", "")
        self.refresh = e.get("ZOHO_SETTINGS_REFRESH_TOKEN") or e.get("ZOHO_REFRESH_TOKEN", "")
        self.accounts = e.get("ZOHO_ACCOUNTS_URL", "https://accounts.zoho.com").rstrip("/")
        self.api = e.get("ZOHO_API_URL", "https://www.zohoapis.com").rstrip("/")
        self.http = session or requests.Session()
        self._tok, self._exp = "", 0.0
        if not (self.cid and self.secret and self.refresh):
            raise ZohoError("set ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET and ZOHO_SETTINGS_REFRESH_TOKEN")

    def token(self) -> str:
        if self._tok and time.time() < self._exp - 60:
            return self._tok
        r = self.http.post(f"{self.accounts}/oauth/v2/token", timeout=20, data={
            "grant_type": "refresh_token", "client_id": self.cid,
            "client_secret": self.secret, "refresh_token": self.refresh})
        body = r.json()
        if "access_token" not in body:
            raise ZohoError(f"token refresh failed: {body.get('error', r.status_code)}")
        self._tok, self._exp = body["access_token"], time.time() + int(body.get("expires_in", 3600))
        return self._tok

    def _req(self, method, path, **kw):
        r = self.http.request(method, f"{self.api}/crm/v7/{path}", timeout=30,
                              headers={"Authorization": f"Zoho-oauthtoken {self.token()}"}, **kw)
        if r.status_code == 204:
            return {}
        try:
            body = r.json()
        except ValueError:
            raise ZohoError(f"{method} {path.split('?')[0]}: HTTP {r.status_code}, not JSON")
        if r.status_code >= 400:
            raise ZohoError(f"{method} {path.split('?')[0]}: HTTP {r.status_code} {body.get('code', '')} {body.get('message', '')}".strip())
        return body

    def get_field(self, module, api_name) -> dict:
        for f in self._req("GET", f"settings/fields?module={module}").get("fields", []):
            if f.get("api_name") == api_name:
                return f
        raise ZohoError(f"field {module}.{api_name} not found")

    def set_values(self, module, field_id, values) -> None:
        body = self._req("PATCH", f"settings/fields/{field_id}?module={module}",
                         json={"fields": [{"pick_list_values": values}]})
        res = (body.get("fields") or [{}])[0]
        if res.get("status") != "success":
            raise ZohoError(f"update refused: {res.get('code', '')} {res.get('message', '')}".strip())

    def count_records(self, module, field, value) -> int:
        safe = value.replace("\\", "\\\\").replace("'", "\\'")
        body = self._req("POST", "coql", json={"select_query":
                         f"select id from {module} where {field} = '{safe}' limit 200"})
        return len(body.get("data", []))


# ---- run ----------------------------------------------------------------------------------
def run(zoho, only="all", apply=False, confirm_v94=False, out=print) -> int:
    status = 0
    if only in ("all", "cases"):
        f = zoho.get_field("Cases", "Case_Category")
        payload, missing = plan_add(f["pick_list_values"], CASE_NEW)
        if not payload:
            out("Cases > Case_Category: both values already exist. Nothing to do.")
        else:
            out(f"Cases > Case_Category: add {', '.join(repr(m) for m in missing)} "
                f"(existing {len(f['pick_list_values']) - 1} values kept, ids unchanged)")
            if apply:
                zoho.set_values("Cases", f["id"], payload)
                bad = verify_add(zoho.get_field("Cases", "Case_Category")["pick_list_values"], CASE_NEW)
                if bad:
                    out(f"  CHECK FAILED: not found after update: {bad}")
                    status = 1
                else:
                    out("  done and verified")
    if only in ("all", "vendor"):
        f = zoho.get_field("Pricing_Scenarios", "Vendor_Source")
        vals = f["pick_list_values"]
        payload, msg = plan_rename(vals, VENDOR_OLD, VENDOR_NEW)
        out(f"Pricing Scenarios > Vendor_Source: {msg}")
        if payload:
            held = zoho.count_records("Pricing_Scenarios", "Vendor_Source", VENDOR_OLD)
            out(f"  Pricing Scenarios holding the old value now: {held}")
            if not apply:
                out("  Order matters: run this right before uploading Pricing Studio v94.")
            elif not confirm_v94:
                out("  NOT APPLIED: add --confirm-v94-ready to say Studio v94 is about to be uploaded.")
                status = 2
            else:
                old_id = next(v["id"] for v in vals if has([v], VENDOR_OLD))
                zoho.set_values("Pricing_Scenarios", f["id"], payload)
                problem = verify_rename(zoho.get_field("Pricing_Scenarios", "Vendor_Source")["pick_list_values"],
                                        old_id, VENDOR_NEW)
                if problem:
                    out(f"  CHECK FAILED: {problem}")
                    status = 1
                else:
                    out("  done and verified (label and stored value both changed)")
    if not apply:
        out("\nDry run only. Nothing was changed. Add --apply to make the changes.")
    return status


def load_env_file(path):
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--only", choices=["all", "cases", "vendor"], default="all")
    ap.add_argument("--apply", action="store_true", help="make the changes (default is a dry run)")
    ap.add_argument("--confirm-v94-ready", action="store_true",
                    help="required with --apply for the Vendor Source rename")
    ap.add_argument("--env-file", help="KEY=VALUE file with the Zoho settings")
    a = ap.parse_args(argv)
    if a.env_file:
        load_env_file(a.env_file)
    try:
        return run(Zoho(), a.only, a.apply, a.confirm_v94_ready)
    except (ZohoError, PlanError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
