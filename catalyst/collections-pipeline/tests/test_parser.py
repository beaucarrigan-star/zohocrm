"""Golden tests for the collections report parser. Run: python -m pytest tests -q"""
import os
import sys

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(HERE, "..", "col_parse"))

import report_parser as rp  # noqa: E402


def _golden():
    with open(os.path.join(HERE, "fixtures", "report_2026-09-28.txt"), encoding="utf-8") as f:
        return rp.parse_text(f.read())


def test_golden_totals_and_date():
    r = _golden()
    assert r["report_date"] == "2026-09-28"
    assert r["customer_count"] == 6
    assert r["invoice_count"] == 9
    assert r["grand_total_amount"] == 4296.50
    assert r["grand_total_open"] == 3296.50
    assert r["warnings"] == []


def test_golden_customers():
    by = {c["name"]: c for c in _golden()["customers"]}
    assert list(by) == ["Clay Co Sheriff", "Crawford Co Sheriff's Dept", "Grant Co Dept of Social Services",
                        "Iowa Co Dept of Social Services", "Lafayette Co Sheriffs Dept",
                        "Ozaukee Co Human Services"]
    craw = by["Crawford Co Sheriff's Dept"]
    assert craw["emails"] == ["rwittrig@crawfordcountywi.org"]
    assert [i["num"] for i in craw["invoices"]] == ["5841", "5895", "6009"]
    assert craw["total_open"] == 1647.00 and craw["oldest_days_past_due"] == 136
    assert by["Lafayette Co Sheriffs Dept"]["emails"] == ["GBlosch@lafcoso.org", "billing@lafcoso.org"]
    iowa = by["Iowa Co Dept of Social Services"]  # header split across the page break
    assert {k: iowa["invoices"][0][k] for k in ("type","num","date","due_date","days_past_due","amount","open_balance")} == {"type": "Pledge", "num": "5680", "date": "2025-12-31",
                                   "due_date": "2026-02-14", "days_past_due": 226,
                                   "amount": 124.50, "open_balance": 124.50}
    assert by["Clay Co Sheriff"]["total_open"] == 0.50
    assert all(c["rows_match_total"] for c in by.values())


def test_mismatch_is_warned():
    t = ("Acme Co  a@b.gov  Invoice 1 01/01/2026 02/01/2026 10 100.00 100.00  "
         "Total for Acme Co $100.00 $90.00  TOTAL $100.00 $90.00")
    r = rp.parse_text(t)
    assert r["customer_count"] == 1
    assert any("Acme Co: rows add to" in w for w in r["warnings"])


def test_not_yet_due_row_without_past_due():
    t = ("Beta  x@y.org  Pledge 77 09/01/2026 10/15/2026 50.00 50.00  Total for Beta $50.00 $50.00  "
         "TOTAL $50.00 $50.00")
    c = rp.parse_text(t)["customers"][0]
    assert c["invoices"][0]["days_past_due"] == 0 and c["rows_match_total"]


def _make_pdf(path):
    """Rebuild the Sep 28 report as a real two-page table PDF so the pdfplumber path is exercised."""
    from reportlab.lib.pagesizes import landscape, letter
    from reportlab.pdfgen import canvas
    rows = []
    for c in _golden()["customers"]:
        rows.append([c["name"]])
        for i in c["invoices"]:
            rows.append(["123 Street", ", ".join(c["emails"]), i["type"], i["num"],
                         _us(i["date"]), _us(i["due_date"]), str(i["days_past_due"]),
                         "{:,.2f}".format(i["amount"]), "{:,.2f}".format(i["open_balance"])])
        rows.append(["Total for " + c["name"], "", "", "", "", "", "",
                     "${:,.2f}".format(c["total_amount"]), "${:,.2f}".format(c["total_open"])])
    rows.append(["TOTAL", "", "", "", "", "", "", "$4,296.50", "$3,296.50"])
    xs = [20, 110, 300, 360, 400, 470, 540, 600, 680]
    cv = canvas.Canvas(path, pagesize=landscape(letter))
    per_page = 12
    for p in range(0, len(rows), per_page):
        cv.setFont("Helvetica", 8)
        cv.drawString(20, 590, "Mon, Sep 28 1:19AM GMT-7")
        cv.drawString(330, 590, "JusticePoint")
        cv.drawString(310, 578, "COLLECTIONS REPORT")
        cv.drawString(320, 566, "As of September 28, 2026")
        hdr = ["Billing Address", "Email", "Transaction Type", "Num", "Date", "Due Date", "Past Due",
               "Amount", "Open Balance"]
        for x, h in zip(xs, hdr):
            cv.drawString(x, 545, h)
        y = 525
        for r in rows[p:p + per_page]:
            for x, v in zip(xs, r):
                cv.drawString(x, y, v)
            y -= 16
        cv.showPage()
    cv.save()


def _us(iso):
    y, m, d = iso.split("-")
    return "{}/{}/{}".format(m, d, y)


def test_pdf_roundtrip(tmp_path):
    p = str(tmp_path / "r.pdf")
    _make_pdf(p)
    with open(p, "rb") as f:
        r = rp.parse_pdf(f.read())
    g = _golden()
    assert r["warnings"] == [], r["warnings"]
    assert r["report_date"] == g["report_date"]
    assert [c["name"] for c in r["customers"]] == [c["name"] for c in g["customers"]]
    assert [c["emails"] for c in r["customers"]] == [c["emails"] for c in g["customers"]]
    assert r["grand_total_open"] == 3296.50


REAL = os.path.join(HERE, "fixtures", "Collections_Report_With_Contact.pdf")


def test_real_pdf_if_present():
    """Drop the real Monday PDF in tests/fixtures to check it before deploying."""
    if not os.path.exists(REAL):
        return
    with open(REAL, "rb") as f:
        r = rp.parse_pdf(f.read())
    assert r["customer_count"] > 0
    assert r["warnings"] == [], r["warnings"]


def test_detail_lines():
    c = {x["name"]: x for x in _golden()["customers"]}["Lafayette Co Sheriffs Dept"]
    assert c["detail"] == "5999 | 06/30/2026 | 08/14/2026 | 45 | 1,208.50 | 1,208.50\nTOTAL | | | | 1,208.50 | 1,208.50"
