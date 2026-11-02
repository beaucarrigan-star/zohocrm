#!/usr/bin/env python3
"""
Deterministic parser for Allied Universal Electronic Monitoring invoices.

Handles the three invoice series seen in the billing-pipeline folder:
  R-xxxxx   monitoring invoices (Invoice Summary per sub-contract + Invoice Details)
  AH-xxxx   remote-breath (SCRAM) unit-day invoices (single line table)
  LD-xxxxx  lost/damaged equipment invoices (per-device table)

Usage:
  python3 parse_allied_invoice.py <pdf> [<pdf> ...] [--json out.json] [--csv out.csv] [--pii]

By default participant names are NOT emitted (PII). Pass --pii to include them.
Every invoice gets a `checks` block: items-vs-subtotal and subtotal-vs-grand-total
arithmetic. Anything that fails goes to the exception queue (Claude review), not to Zoho.
"""
import re, sys, json, csv, subprocess, argparse
from pathlib import Path

MONEY = r"\$?\(?-?[\d,]+\.\d{2}\)?"
NUM   = r"[\d,]+"

def money(s):
    s = s.replace("$", "").replace(",", "")
    neg = s.startswith("(") or s.startswith("-")
    v = float(s.strip("()-"))
    return -v if neg else v

def pdftotext(path):
    return subprocess.run(["pdftotext", "-layout", str(path), "-"],
                          capture_output=True, text=True, check=True).stdout

NOISE = re.compile(r"^\s*(R-0\b|Allied Universal Electronic Monitoring US Inc\.|1838 Gunn Hwy|Odessa, Florida|INVOICE\s*$|Thank [Yy]ou [Ff]or [Yy]our [Bb]usiness)")
ITEM  = re.compile(rf"^\s*(?P<desc>\S.*?\S)\s{{2,}}(?P<qty>{NUM})\s+(?P<price>{MONEY})\s+(?P<total>{MONEY})\s*$")
SUBTOTAL = re.compile(rf"^\s*(?P<name>.+?)\s+Subtotal:\s+(?P<total>{MONEY})\s*$")
GRAND = re.compile(rf"^\s*Grand Total:\s+(?P<total>{MONEY})\s*$")
INVSUB = re.compile(rf"^\s*Invoice Subtotal:\s+(?P<total>{MONEY})\s*$")
COLHDR = re.compile(r"^\s*(Invoice )?Description\s+(Qty|Days|Quantity)\s+Price\s+Total\s*$")

def header_fields(text):
    h = {}
    def grab(label, pat=r"([^\n]+?)\s{2,}|([^\n]+)$"):
        m = re.search(rf"{label}\s*:?\s+(\S[^\n]*?)(?:\s{{2,}}|\n)", text)
        return m.group(1).strip() if m else None
    h["invoice_number"] = grab(r"Invoice #")
    h["invoice_date"]   = grab(r"Invoice Date")
    m = re.search(r"Billing Period:?\s+([A-Z][a-z]+,? \d{4})", text)
    h["billing_period"] = m.group(1) if m else None
    h["contract"]       = grab(r"Contract")
    h["customer_number"]= grab(r"Customer #")
    h["po_number"]      = grab(r"PO (?:Number|#)")
    m = re.search(r"Bill To:\s*\n\s*(\S[^\n]*?)\s{2,}", text)
    h["bill_to"] = m.group(1).strip() if m else None
    # the layout sometimes puts label/value on separate lines (AH-series); fall back to loose search
    if not h["invoice_number"]:
        m = re.search(r"Invoice #:\s*([A-Z]+-\d+)", text); h["invoice_number"] = m.group(1) if m else None
    if h["invoice_number"]:
        h["series"] = h["invoice_number"].split("-")[0]
    return h

def parse_summary_block(lines, default_section):
    """Parse an Invoice Summary (R-series) or the single table (AH-series)."""
    sections, cur = [], None
    grand = invsub = None
    i, n = 0, len(lines)
    def new_section(name):
        nonlocal cur
        cur = {"section": name, "items": [], "subtotal": None}
        sections.append(cur)
    while i < n:
        ln = lines[i].rstrip()
        i += 1
        if not ln.strip() or NOISE.match(ln):
            continue
        if GRAND.match(ln):
            grand = money(GRAND.match(ln)["total"]); continue
        if INVSUB.match(ln):
            invsub = money(INVSUB.match(ln)["total"]); continue
        if COLHDR.match(ln):
            if cur is None: new_section(default_section)
            continue
        m = SUBTOTAL.match(ln)
        if m:
            name = m["name"].strip()
            if cur is None or (cur["section"] != name and name not in ("Regional Charges",) and cur["subtotal"] is not None):
                # subtotal for a section we didn't open (shouldn't happen) – open & close it
                new_section(name)
            cur["subtotal"] = money(m["total"]); continue
        m = ITEM.match(ln)
        if m:
            if cur is None: new_section(default_section)
            cur["items"].append({"description": m["desc"].strip(), "qty": int(m["qty"].replace(",", "")),
                                 "unit_price": money(m["price"]), "total": money(m["total"])})
            continue
        # bare text: section header if followed by a column header, else a description continuation
        nxt = next((l for l in lines[i:i+8] if l.strip() and not NOISE.match(l)), "")
        if COLHDR.match(nxt) or re.match(r"^\s*Invoice Details", ln):
            if re.match(r"^\s*Invoice Details", ln): break
            new_section(ln.strip())
        elif cur and cur["items"] and not cur["subtotal"] and re.match(r"^\s*\S", ln):
            cur["items"][-1]["description"] += " " + ln.strip()
    return sections, invsub, grand

LD_ROW = re.compile(rf"^\s*(?P<model>AT1[^\s]*(?:\s\S+)*?)\s{{2,}}(?P<serial>\d{{6,}})\s+(?P<name>\S.*?\S)\s{{2,}}(?P<date>\d{{2}}/\d{{2}}/\d{{4}})\s+(?P<rma>\d+)\s+(?P<total>{MONEY})\s*$")

def parse_ld(text, pii):
    rows, grand = [], None
    for ln in text.splitlines():
        m = LD_ROW.match(ln)
        if m:
            r = {"model": m["model"], "serial": m["serial"], "date_reported": m["date"], "rma": m["rma"], "total": money(m["total"])}
            if pii: r["participant"] = m["name"]
            rows.append(r); continue
        g = GRAND.match(ln)
        if g: grand = money(g["total"])
    return rows, grand

def parse(path, pii=False):
    text = pdftotext(path)
    inv = header_fields(text)
    inv["file"] = Path(path).name
    series = inv.get("series")
    checks = []
    if series == "LD":
        rows, grand = parse_ld(text, pii)
        inv["sections"] = [{"section": "Lost/Damaged", "items": rows, "subtotal": round(sum(r["total"] for r in rows), 2)}]
        inv["grand_total"] = grand
        checks.append({"check": "ld_rows_vs_grand_total", "ok": grand is not None and abs(inv["sections"][0]["subtotal"] - grand) < 0.005})
    else:
        lines = text.splitlines()
        # R-series: only the Invoice Summary; AH-series: whole doc (single table)
        start = next((k for k, l in enumerate(lines) if "Invoice Summary" in l), 0)
        sections, invsub, grand = parse_summary_block(lines[start:], inv.get("contract") or "Invoice")
        inv["sections"], inv["invoice_subtotal"], inv["grand_total"] = sections, invsub, grand
        for s in sections:
            item_sum = round(sum(it["total"] for it in s["items"]), 2)
            if s["subtotal"] is None: s["subtotal"] = item_sum  # single-section invoices print no section subtotal
            checks.append({"check": f"items_vs_subtotal[{s['section']}]", "ok": abs(item_sum - s["subtotal"]) < 0.005,
                           "items": item_sum, "subtotal": s["subtotal"]})
            for it in s["items"]:
                exp = round(it["qty"] * it["unit_price"], 2)
                if abs(exp - it["total"]) >= 0.005:
                    checks.append({"check": f"qty*price[{s['section']}/{it['description']}]", "ok": False, "expected": exp, "printed": it["total"]})
        sec_sum = round(sum(s["subtotal"] for s in sections), 2)
        checks.append({"check": "sections_vs_grand_total", "ok": grand is not None and abs(sec_sum - grand) < 0.005, "sections": sec_sum, "grand_total": grand})
    inv["checks"] = checks
    inv["all_checks_pass"] = all(c["ok"] for c in checks)
    return inv

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdfs", nargs="+")
    ap.add_argument("--json"); ap.add_argument("--csv"); ap.add_argument("--pii", action="store_true")
    a = ap.parse_args()
    out = [parse(p, a.pii) for p in a.pdfs]
    if a.json: Path(a.json).write_text(json.dumps(out, indent=2))
    if a.csv:
        with open(a.csv, "w", newline="") as f:
            w = csv.writer(f); w.writerow(["invoice", "series", "invoice_date", "billing_period", "contract", "section", "description", "qty", "unit_price", "total"])
            for inv in out:
                for s in inv["sections"]:
                    for it in s["items"]:
                        w.writerow([inv["invoice_number"], inv["series"], inv["invoice_date"], inv["billing_period"], inv["contract"], s["section"],
                                    it.get("description", it.get("model")), it.get("qty", 1), it.get("unit_price", it["total"]), it["total"]])
    for inv in out:
        flag = "OK " if inv["all_checks_pass"] else "FAIL"
        print(f"{flag} {inv['invoice_number']:<9} {inv.get('billing_period','?'):<16} sections={len(inv['sections']):>2} "
              f"items={sum(len(s['items']) for s in inv['sections']):>3} grand_total={inv.get('grand_total')}")
        for c in inv["checks"]:
            if not c["ok"]: print("     ✗", c)
main()
