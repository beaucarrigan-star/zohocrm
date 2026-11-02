#!/usr/bin/env python3
"""
Reconcile parsed Allied invoice GPS days (from parse_allied_invoice.py JSON) against
Allied System Usage Report exports. Vendor section names != usage 'Customer' names, so
matching goes through SECTION_TO_CUSTOMERS below (fill from Zoho Accounts once; the
pipeline should maintain this table, not re-guess it every month).

Usage: python3 reconcile_usage.py sept2026_invoices.json "../*System Usage Report*.xlsx"
Exit code 1 if any exception rows exist (feed those to the Claude review step).
"""
import sys, json, glob, re, warnings, openpyxl
warnings.filterwarnings("ignore")

# invoice section -> list of usage-report Customer names (exact). Unlisted sections fall back to exact-name match.
SECTION_TO_CUSTOMERS = {
    # "Justice Point - Sheboygan County Sheriff Pretrial": ["Justice Point - Sheboygan County Sheriff"],
}

def load_usage(patterns):
    usage = {}
    for pat in patterns:
        for f in glob.glob(pat):
            wb = openpyxl.load_workbook(f, read_only=True, data_only=True)
            for ws in wb.worksheets:
                for row in ws.iter_rows(values_only=True):
                    if not row or row[0] in (None, "", "Customer"): continue
                    if str(row[0]).startswith(("System Usage", "Supervision", "Date Range")): continue
                    try: days = int(row[6])
                    except (TypeError, ValueError): continue
                    key = (str(row[0]).strip(), str(row[7]).strip())
                    usage[key] = usage.get(key, 0) + days
    return usage

def device_of(desc):
    return "2 Piece" if "2 Piece" in desc else "1 Piece GPS (AT1)"

def main(inv_json, *patterns):
    usage = load_usage(patterns)
    invoices = json.load(open(inv_json))
    exceptions, matched = [], set()
    for inv in invoices:
        if inv.get("series") != "R": continue
        for s in inv["sections"]:
            for it in s["items"]:
                d = it["description"]
                if "GPS" not in d and "Piece" not in d: continue
                custs = SECTION_TO_CUSTOMERS.get(s["section"], [s["section"]])
                keys = [(c, device_of(d)) for c in custs if (c, device_of(d)) in usage]
                u = sum(usage[k] for k in keys); matched.update(keys)
                if not keys:
                    exceptions.append({"type": "billed_no_usage_report", "invoice": inv["invoice_number"], "section": s["section"], "invoice_days": it["qty"], "amount": it["total"]})
                elif u != it["qty"]:
                    exceptions.append({"type": "day_count_mismatch", "invoice": inv["invoice_number"], "section": s["section"], "invoice_days": it["qty"], "usage_days": u, "unit_price": it["unit_price"], "dollar_delta": round((it["qty"] - u) * it["unit_price"], 2)})
    for k, v in usage.items():
        if k not in matched and v:
            exceptions.append({"type": "usage_not_billed", "customer": k[0], "device": k[1], "usage_days": v})
    print(json.dumps(exceptions, indent=2))
    print(f"\n{len(exceptions)} exception(s)", file=sys.stderr)
    sys.exit(1 if exceptions else 0)

if __name__ == "__main__":
    main(*sys.argv[1:])
