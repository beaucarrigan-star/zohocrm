import copy
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(__file__))
import zoho_picklists as zp  # noqa: E402

SHAPES = json.load(open(os.path.join(os.path.dirname(__file__), "testdata", "zoho_picklist_shapes.json")))
CC = SHAPES["Cases.Case_Category"]
VS = SHAPES["Pricing_Scenarios.Vendor_Source"]


class FakeZoho:
    """Behaves like Zoho: PATCH replaces the list; label_only=True mimics a rename that keeps the stored value."""

    def __init__(self, label_only=False, held=0, refuse=False):
        self.fields = {("Cases", "Case_Category"): copy.deepcopy(CC),
                       ("Pricing_Scenarios", "Vendor_Source"): copy.deepcopy(VS)}
        self.label_only, self.held, self.refuse = label_only, held, refuse
        self.writes = []

    def get_field(self, module, api_name):
        return copy.deepcopy(self.fields[(module, api_name)])

    def count_records(self, module, field, value):
        return self.held

    def set_values(self, module, field_id, values):
        if self.refuse:
            raise zp.ZohoError("update refused: INVALID_DATA")
        self.writes.append((module, field_id, values))
        f = self.fields[next(k for k, v in self.fields.items() if v["id"] == field_id)]
        old = {v["id"]: v for v in f["pick_list_values"]}
        new = [{"display_value": "-None-", "actual_value": "-None-", "id": "none", "type": "used"}]
        for i, v in enumerate(values):
            row = dict(v)
            row.setdefault("id", f"new{i}")
            if self.label_only and v.get("id") in old:
                row["actual_value"] = old[v["id"]]["actual_value"]
            new.append(row)
        f["pick_list_values"] = new


def lines():
    out = []
    return out, out.append


# ---- planning ----------------------------------------------------------------------------
def test_add_keeps_every_existing_value_with_its_id_and_appends_new():
    payload, missing = zp.plan_add(CC["pick_list_values"], zp.CASE_NEW)
    assert missing == zp.CASE_NEW
    existing = [v for v in CC["pick_list_values"] if v["actual_value"] != "-None-"]
    assert [p.get("id") for p in payload[:len(existing)]] == [v["id"] for v in existing]
    assert payload[-2:] == [{"display_value": n, "actual_value": n} for n in zp.CASE_NEW]
    assert all(p["actual_value"] != "-None-" for p in payload)


def test_add_preserves_display_vs_stored_difference():
    payload, _ = zp.plan_add(CC["pick_list_values"], zp.CASE_NEW)
    row = next(p for p in payload if p["display_value"] == "Device Troubleshooting")
    assert row["actual_value"] == "Device Issue"


def test_add_is_idempotent():
    vals = copy.deepcopy(CC["pick_list_values"]) + [
        {"display_value": n, "actual_value": n, "id": f"x{i}"} for i, n in enumerate(zp.CASE_NEW)]
    payload, missing = zp.plan_add(vals, zp.CASE_NEW)
    assert payload is None and missing == []


def test_rename_keeps_id_and_sets_label_and_stored_value():
    payload, msg = zp.plan_rename(VS["pick_list_values"], zp.VENDOR_OLD, zp.VENDOR_NEW)
    row = next(p for p in payload if p["id"] == "6715134000006337130")
    assert row["display_value"] == row["actual_value"] == zp.VENDOR_NEW
    assert [p["display_value"] for p in payload if p["id"] != row["id"]] == ["Lease from vendor"]
    assert "same id" in msg


def test_rename_done_already_is_a_noop():
    vals = copy.deepcopy(VS["pick_list_values"])
    for v in vals:
        if v["display_value"] == zp.VENDOR_OLD:
            v["display_value"] = v["actual_value"] = zp.VENDOR_NEW
    payload, msg = zp.plan_rename(vals, zp.VENDOR_OLD, zp.VENDOR_NEW)
    assert payload is None and "nothing to do" in msg


def test_rename_refuses_when_both_exist_or_neither():
    both = copy.deepcopy(VS["pick_list_values"]) + [{"display_value": zp.VENDOR_NEW, "actual_value": zp.VENDOR_NEW, "id": "z"}]
    with pytest.raises(zp.PlanError):
        zp.plan_rename(both, zp.VENDOR_OLD, zp.VENDOR_NEW)
    with pytest.raises(zp.PlanError):
        zp.plan_rename([v for v in VS["pick_list_values"] if v["display_value"] != zp.VENDOR_OLD],
                       zp.VENDOR_OLD, zp.VENDOR_NEW)


# ---- run ---------------------------------------------------------------------------------
def test_dry_run_writes_nothing():
    z = FakeZoho()
    out, say = lines()
    assert zp.run(z, "all", apply=False, out=say) == 0
    assert z.writes == []
    text = "\n".join(out)
    assert "Dry run only" in text and "Pricing sign-off" in text and "Purchased Devices" in text


def test_apply_cases_adds_and_verifies():
    z = FakeZoho()
    out, say = lines()
    assert zp.run(z, "cases", apply=True, out=say) == 0
    assert len(z.writes) == 1 and "verified" in "\n".join(out)
    assert zp.run(z, "cases", apply=True, out=say) == 0 and len(z.writes) == 1  # second run: nothing to do


def test_vendor_rename_needs_the_v94_confirmation():
    z = FakeZoho()
    out, say = lines()
    assert zp.run(z, "vendor", apply=True, confirm_v94=False, out=say) == 2
    assert z.writes == [] and "--confirm-v94-ready" in "\n".join(out)


def test_vendor_rename_applies_and_verifies():
    z = FakeZoho()
    out, say = lines()
    assert zp.run(z, "vendor", apply=True, confirm_v94=True, out=say) == 0
    assert "both changed" in "\n".join(out)


def test_label_only_rename_is_caught_by_the_read_back():
    z = FakeZoho(label_only=True)
    out, say = lines()
    assert zp.run(z, "vendor", apply=True, confirm_v94=True, out=say) == 1
    text = "\n".join(out)
    assert "CHECK FAILED" in text and "label only" in text and "Purchased Devices" in text


def test_update_refusal_raises_not_silently_passes():
    with pytest.raises(zp.ZohoError):
        zp.run(FakeZoho(refuse=True), "cases", apply=True, out=lambda s: None)


def test_missing_settings_gives_a_clear_error(monkeypatch):
    for k in ("ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_SETTINGS_REFRESH_TOKEN", "ZOHO_REFRESH_TOKEN"):
        monkeypatch.delenv(k, raising=False)
    with pytest.raises(zp.ZohoError, match="ZOHO_SETTINGS_REFRESH_TOKEN"):
        zp.Zoho(env={})
