"""Parse the weekly QuickBooks "Collections Report (with contact)" into customers and open invoices.

Rule-based, no AI at runtime. Works on the text of the PDF with all whitespace collapsed, so it does not
depend on how the PDF reader breaks lines:

  * the "Total for <Customer> $amount $open" line closes each customer block and is the authoritative
    customer name;
  * every invoice row inside the block looks like
      <Type> <Num> <MM/DD/YYYY> [<MM/DD/YYYY>] [<days past due>] <amount> <open balance>
    (QuickBooks calls JusticePoint's invoices "Pledge" because it is the nonprofit edition);
  * every e-mail address inside the block is a billing contact for that customer (a customer can list
    two, e.g. "GBlosch@lafcoso.org, billing@lafcoso.org");
  * the page header, the title block and the grand TOTAL are removed/checked.

Each customer's rows are summed and checked against its Total line, and the grand total against TOTAL;
any mismatch is reported in `warnings` rather than silently accepted.
"""

import re
from datetime import datetime

MONEY = r"-?\$?-?[\d,]+\.\d\d"
DATE = r"\d{1,2}/\d{1,2}/\d{4}"

PAGE_HEADER = re.compile(
    r"(?:\w{3}, \w{3} \d{1,2} \d{1,2}:\d{2} ?[AP]M(?: GMT[+-]\d{1,2}(?::?\d\d)?)?\s+)?"
    r"Billing Address\s+Email\s+Transaction Type\s+Num\s+Date\s+Due Date\s+Past Due\s+Amount\s+Open Balance",
    re.I)
STRAY_TIMESTAMP = re.compile(r"\w{3}, \w{3} \d{1,2} \d{1,2}:\d{2} ?[AP]M(?: GMT[+-]\d{1,2}(?::?\d\d)?)?", re.I)
TITLE = re.compile(r"(?:\bJusticePoint\s+)?COLLECTIONS REPORT\s+As of\s+([A-Z][a-z]+\.? \d{1,2}, \d{4})", re.I)
TOTAL_FOR = re.compile(r"Total for\s+(.+?)\s+(" + MONEY + r")\s+(" + MONEY + r")")
GRAND_TOTAL = re.compile(r"(?<![A-Za-z])TOTAL\s+(" + MONEY + r")\s+(" + MONEY + r")\s*$")
ROW = re.compile(
    r"(?P<type>Pledge|Invoice|Credit Memo|Journal Entry|Payment|Statement Charge|Sales Receipt|Refund)\s+"
    r"(?P<num>[A-Za-z0-9\-]+)\s+"
    r"(?P<date>" + DATE + r")\s+"
    r"(?:(?P<due>" + DATE + r")\s+)?"
    r"(?:(?P<past>-?\d{1,5})\s+)?"
    r"(?P<amt>" + MONEY + r")\s+"
    r"(?P<bal>" + MONEY + r")",
    re.I)
EMAIL = re.compile(r"[A-Za-z0-9._%+\-']+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")


def _money(s):
    s = s.replace("$", "").replace(",", "")
    neg = s.count("-") % 2 == 1
    v = round(float(s.replace("-", "")), 2)
    return -v if neg else v


def _iso(d):
    return datetime.strptime(d, "%m/%d/%Y").strftime("%Y-%m-%d") if d else None


def _detail(invoices, total_amt, total_open):
    """Invoice lines as stored on the CRM Collection Request (Invoice Detail); the Deluge draft builder
    reads them back by splitting on ' | '. Last line is the customer total."""
    lines = ["{} | {} | {} | {} | {} | {}".format(i["num"], i["date_us"], i["due_us"], i["days_past_due"],
                                                i["amount_fmt"], i["open_fmt"]) for i in invoices]
    lines.append("TOTAL | | | | {:,.2f} | {:,.2f}".format(total_amt, total_open))
    return "\n".join(lines)


def normalise(text):
    return re.sub(r"\s+", " ", text or "").strip()


def parse_text(text):
    t = normalise(text)
    warnings = []

    report_date = None
    m = TITLE.search(t)
    if m:
        raw = m.group(1).replace(".", "")
        for fmt in ("%B %d, %Y", "%b %d, %Y"):
            try:
                report_date = datetime.strptime(raw, fmt).strftime("%Y-%m-%d")
                break
            except ValueError:
                pass
    else:
        warnings.append("Report date ('As of ...') not found.")
    t = TITLE.sub(" ", t)
    t = PAGE_HEADER.sub(" ", t)
    t = STRAY_TIMESTAMP.sub(" ", t)
    t = normalise(t)

    grand = None
    g = GRAND_TOTAL.search(t)
    if g:
        grand = (_money(g.group(1)), _money(g.group(2)))
        t = t[:g.start()].strip()
    else:
        warnings.append("Grand TOTAL line not found.")

    customers = []
    pos = 0
    for tm in TOTAL_FOR.finditer(t):
        block = t[pos:tm.start()]
        pos = tm.end()
        name = tm.group(1).strip()
        invoices = []
        for r in ROW.finditer(block):
            invoices.append({
                "type": r.group("type").title(),
                "num": r.group("num"),
                "date": _iso(r.group("date")),
                "due_date": _iso(r.group("due")),
                "days_past_due": int(r.group("past")) if r.group("past") else 0,
                "amount": _money(r.group("amt")),
                "open_balance": _money(r.group("bal")),
                "date_us": r.group("date"),
                "due_us": r.group("due") or "",
                "amount_fmt": "{:,.2f}".format(_money(r.group("amt"))),
                "open_fmt": "{:,.2f}".format(_money(r.group("bal"))),
            })
        emails, seen = [], set()
        for e in EMAIL.findall(block):
            e = e.strip(".,;")
            if e.lower() not in seen:
                seen.add(e.lower())
                emails.append(e)
        total_amt, total_open = _money(tm.group(2)), _money(tm.group(3))
        sum_amt = round(sum(i["amount"] for i in invoices), 2)
        sum_open = round(sum(i["open_balance"] for i in invoices), 2)
        ok = abs(sum_amt - total_amt) < 0.005 and abs(sum_open - total_open) < 0.005
        if not invoices:
            warnings.append("{}: no invoice rows could be read.".format(name))
        elif not ok:
            warnings.append("{}: rows add to {:.2f}/{:.2f} but Total line says {:.2f}/{:.2f}.".format(
                name, sum_amt, sum_open, total_amt, total_open))
        if not emails:
            warnings.append("{}: no e-mail address on the report.".format(name))
        customers.append({
            "name": name,
            "emails": emails,
            "invoices": invoices,
            "total_amount": total_amt,
            "total_open": total_open,
            "total_amount_fmt": "{:,.2f}".format(total_amt),
            "total_open_fmt": "{:,.2f}".format(total_open),
            "detail": _detail(invoices, total_amt, total_open),
            "oldest_days_past_due": max([i["days_past_due"] for i in invoices] or [0]),
            "rows_match_total": ok,
        })
    tail = t[pos:].strip()
    if ROW.search(tail):
        warnings.append("Invoice rows found after the last 'Total for' line were ignored: " + tail[:200])

    s_amt = round(sum(c["total_amount"] for c in customers), 2)
    s_open = round(sum(c["total_open"] for c in customers), 2)
    if grand and (abs(s_amt - grand[0]) >= 0.005 or abs(s_open - grand[1]) >= 0.005):
        warnings.append("Customer totals add to {:.2f}/{:.2f} but report TOTAL says {:.2f}/{:.2f}.".format(
            s_amt, s_open, grand[0], grand[1]))
    return {
        "report_date": report_date,
        "customers": customers,
        "customer_count": len(customers),
        "invoice_count": sum(len(c["invoices"]) for c in customers),
        "grand_total_amount": grand[0] if grand else s_amt,
        "grand_total_open": grand[1] if grand else s_open,
        "warnings": warnings,
    }


def pdf_text(data):
    """Text of every page, joined. Raises ValueError if the PDF has no text layer."""
    import io
    import pdfplumber
    parts = []
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        for page in pdf.pages:
            parts.append(page.extract_text() or "")
    text = "\n".join(parts)
    if not text.strip():
        raise ValueError("The PDF has no text layer (scanned image?) - cannot read it.")
    return text


def parse_pdf(data):
    return parse_text(pdf_text(data))
