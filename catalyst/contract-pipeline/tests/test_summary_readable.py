# The Note / Ingest_Summary text must be readable: short file names, a headline, one file per line,
# duplicate skips collapsed (21 Oct 2026, Polk Co Sheriff).
import os
import sys
from types import SimpleNamespace as NS

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(HERE, "..", "con_worker"))

import main  # noqa: E402

UUID = "09bbb495-02da-4c43-a55e-0076280610da-"
NAME = "Amendment_2_to_Electronic_Monitoring_Agreement_Polk_County_JusticePoint_Inc..pdf"


def _summary(skipped):
    f = NS(field="Contract_End_Date", value="2027-02-28", as_note=lambda: "Contract_End_Date = 2027-02-28 (High, Polk.zip > %s%s, p.1; extended through)" % (UUID, NAME))
    result = NS(rate_rows=[], notes=[], terms={"Contract_End_Date": f})
    plan = {"insert": [], "update": [], "supersede": []}
    return main._build_summary(
        ["%s%s -> Amendment, eff. 2026-04-21 (audit trail signature date)" % (UUID, NAME)], skipped, [], [], result, plan, [],
        {"Contract_End_Date": "2027-02-28"}, [], clause_props=[], packet_name="Polk.zip")


def test_headline_and_short_names():
    s = _summary([])
    first = s.splitlines()[0]
    assert first.startswith("SUMMARY: 1 file(s) read | packet end date 2027-02-28")
    assert UUID not in s and "Polk.zip > " not in s
    assert "  1. " + NAME + " - Amendment, eff. 2026-04-21" in s


def test_duplicate_skips_collapse_to_one_line():
    dup = "folder/%s%s (skipped: same file as %s%s, read once)" % (UUID, NAME, UUID, NAME)
    s = _summary([dup, dup, dup, "notes.zip (skipped: zips inside the zip are not read)"])
    assert s.count("Skipped 3 duplicate copy(ies)") == 1
    assert "Skipped: notes.zip (skipped: zips inside the zip are not read)" in s
    assert "same file as" not in s
