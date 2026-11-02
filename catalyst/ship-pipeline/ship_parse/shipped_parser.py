"""Parser for Allied Universal SmartView's "Equipment Shipped" report (.xlsx, one file per contract).

Layout (sheet "EquipmentShipped"):
  title rows, then a header row: Date | Customer | Order | Packing Slip | Shipping Days | <one column per device
  model> | Accessories | No. of Boxes | Tracking Number. Each shipment is one row whose first cell is a date,
  followed by a "Detail" header row and one line per item: Hardware Type | Serial Number. Devices carry a real
  serial; accessories carry "n/a" and a "qty-N" suffix on the hardware type. "Subtotal - <customer>" and
  "Grand Total" rows are skipped.

Output: one row per packing slip, the same shape as the Accessory_Shipments module rows loaded by hand on
Sep 29 2026 (Row_Key = packing slip number; Quantity = accessory units; Devices = serialised units).
"""
import io
import re
from collections import OrderedDict
from datetime import date, datetime

from openpyxl import load_workbook

STRIP_PREFIX = "Justice Point - "
QTY_RX = re.compile(r"\bqty-(\d+)\s*$", re.I)
# accessory group by hardware-type keyword, first match wins
GROUPS = [
    ("pin tray", "pin_trays"),
    ("tamper plug", "tamper_plugs"),
    ("strap", "straps"),
    ("charg", "chargers"),      # Charger, charging cord, wall plug
    ("wall plug", "chargers"),
    ("tool", "tools"),
    ("screwdriver", "tools"),
]
EMPTY = {"devices": 0, "straps": 0, "pin_trays": 0, "tamper_plugs": 0, "chargers": 0, "tools": 0, "other": 0}


def _norm(v):
    if v is None:
        return ""
    if isinstance(v, (datetime, date)):
        return v.strftime("%m/%d/%Y")
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return " ".join(str(v).split()).strip()


def _as_date(v):
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    s = _norm(v)
    for fmt in ("%m/%d/%Y", "%m/%d/%y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    return None


def _group(hw):
    h = hw.lower()
    for key, g in GROUPS:
        if key in h:
            return g
    return "other"


def parse_xlsx(data):
    """Returns {"rows": [...], "warnings": [...], "range": "<report date range line>", "shipments": n}.
    Raises ValueError if the workbook is not an Equipment Shipped report."""
    wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    ws = wb.worksheets[0]
    header, hidx, rng = None, {}, ""
    slips = OrderedDict()
    warnings = []
    cur = None
    detail_hw, detail_sn = None, None
    for row in ws.iter_rows(values_only=True):
        cells = list(row)
        text = [_norm(c) for c in cells]
        joined = " ".join(t for t in text if t)
        if not joined:
            continue
        if header is None:
            if joined.lower().startswith("date range"):
                rng = joined
            if "Customer" in text and "Packing Slip" in text and "Date" in text:
                header = text
                hidx = {name: i for i, name in enumerate(text) if name}
            continue
        first = text[0]
        if first.lower().startswith("subtotal") or first.lower().startswith("grand total"):
            cur = None
            continue
        if first == "Detail":
            detail_hw = next((i for i, t in enumerate(text) if t == "Hardware Type"), None)
            detail_sn = next((i for i, t in enumerate(text) if t == "Serial Number"), None)
            continue
        d = _as_date(cells[0]) if cells[0] is not None else None
        if d is not None:
            get = lambda name: text[hidx[name]] if name in hidx and hidx[name] < len(text) else ""
            slip = get("Packing Slip")
            if not slip:
                warnings.append("Shipment on %s for %r has no packing slip; skipped." % (d, get("Customer")))
                cur = None
                continue
            if slip in slips:
                warnings.append("Packing slip %s appears more than once; items merged." % slip)
                cur = slips[slip]
            else:
                cur = dict(EMPTY)
                cur.update({"allied_customer": get("Customer"), "ship_date": d.isoformat(),
                            "order_number": get("Order"), "packing_slip": slip,
                            "tracking_number": get("Tracking Number"), "items": []})
                slips[slip] = cur
            continue
        if cur is None or detail_hw is None:
            continue
        hw = text[detail_hw] if detail_hw < len(text) else ""
        sn = text[detail_sn] if detail_sn is not None and detail_sn < len(text) else ""
        if not hw:
            continue
        m = QTY_RX.search(hw)
        if sn and sn.lower() != "n/a" and not m:
            cur["devices"] += 1
            cur["items"].append(hw)
            continue
        qty = int(m.group(1)) if m else 1
        g = _group(hw)
        if g == "other":
            warnings.append("Unrecognised accessory %r on packing slip %s counted in Quantity only." % (hw, cur["packing_slip"]))
        cur[g] += qty
        cur["items"].append(hw)
    if header is None:
        raise ValueError("No header row with Date / Customer / Packing Slip - is this the Allied Equipment Shipped report?")

    rows = []
    for s in slips.values():
        qty = s["straps"] + s["pin_trays"] + s["tamper_plugs"] + s["chargers"] + s["tools"] + s["other"]
        cust = s["allied_customer"]
        short = cust[len(STRIP_PREFIX):] if cust.startswith(STRIP_PREFIX) else cust
        rows.append({
            "name": "%s %s #%s" % (short, s["ship_date"], s["packing_slip"]),
            "row_key": s["packing_slip"],
            "allied_customer": cust,
            "ship_date": s["ship_date"],
            "month": s["ship_date"][:7],
            "order_number": s["order_number"],
            "packing_slip": s["packing_slip"],
            "tracking_number": s["tracking_number"],
            "devices": s["devices"],
            "straps": s["straps"], "pin_trays": s["pin_trays"], "tamper_plugs": s["tamper_plugs"],
            "chargers": s["chargers"], "tools": s["tools"],
            "quantity": qty,
            "is_accessory": qty > 0,
        })
    return {"rows": rows, "warnings": warnings, "range": rng, "shipments": len(rows)}
