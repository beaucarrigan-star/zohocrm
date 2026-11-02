import io, os, sys
from datetime import datetime
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "ship_parse"))
from openpyxl import Workbook
import shipped_parser as sp

HEAD = ["Date", None, "Customer", None, None, None, None, "Order", "Packing Slip", "Shipping Days",
        "1 Piece AT1 VZ (MTD)", "AMS Remote Breath (AMS Remote Breath)", "Accessories", "No. of Boxes", "Tracking Number"]


def book(shipments):
    """shipments: list of (date, customer, order, slip, tracking, [(hardware, serial), ...])"""
    wb = Workbook(); ws = wb.active; ws.title = "EquipmentShipped"
    ws.append([None, "Equipment Shipped"]); ws.append([None, "Justice Point (WI)"])
    ws.append([None, "Date Range: 10/1/2026 through 10/12/2026"]); ws.append(HEAD)
    last = None
    for d, cust, order, slip, trk, items in shipments:
        if last and last != cust:
            ws.append(["Subtotal - " + last] + [None] * 8 + [1, 0])
        ws.append([d, None, cust, None, None, None, None, order, slip, 1, 0, 0, "Yes", 1, trk])
        ws.append(["Detail", None, None, "Hardware Type", None, "Serial Number"])
        for hw, sn in items:
            ws.append([None, None, None, hw, None, sn])
        last = cust
    ws.append(["Subtotal - " + last] + [None] * 8 + [1, 0])
    ws.append(["Grand Total"] + [None] * 8 + [23, 2])
    b = io.BytesIO(); wb.save(b); return b.getvalue()


ADAMS = [("1 Piece AT1 VZ (MTD)", "34549369"),
         ("Charger- (AT1/TD4) Device Charging Cord  qty-1", "n/a"),
         ("Pin Tray (BTX/AT1/TD4)- Regular Strength- Gray w/silicone  qty-2", "n/a"),
         ("Strap with Copper- Regular  qty-1", "n/a"),
         ("Charger- (AT1/TD4/RTC) Wall Plug  qty-1", "n/a"),
         ("Tamper Plug - Gray US  qty-2", "n/a")]


def test_mixed_slip_and_devices_only():
    data = book([
        (datetime(2026, 10, 8), "Justice Point - Adams County HHS", "253371", "252953", "878381111435", ADAMS),
        (datetime(2026, 10, 2), "Justice Point - Menominee Co Sheriff, MI", "253163", "252686", "878107791607",
         [("AMS Remote Breath (AMS Remote Breath)", "RB212DM"), ("AMS Remote Breath (AMS Remote Breath)", "RB234W8")]),
        (datetime(2026, 10, 5), "Justice Point - Sheboygan County HHSD", "253205", "252695", "878186066994",
         [("Strap - Standard - Regular  qty-90", "n/a"), ("Strap - Standard - Large  qty-10", "n/a")]),
        ("10/8/2026", "Professional Services Group (lease)", "253372", "252963", "878390544307",
         [("Pin Tray (BTX/AT1/TD4)- Regular Strength- Gray w/silicone  qty-100", "n/a"), ("Strap with Copper- Regular  qty-50", "n/a")]),
    ])
    r = sp.parse_xlsx(data)
    assert r["warnings"] == [] and r["shipments"] == 4 and r["range"].startswith("Date Range: 10/1/2026")
    a, m, s, p = r["rows"]
    assert a == {"name": "Adams County HHS 2026-10-08 #252953", "row_key": "252953",
                 "allied_customer": "Justice Point - Adams County HHS", "ship_date": "2026-10-08", "month": "2026-10",
                 "order_number": "253371", "packing_slip": "252953", "tracking_number": "878381111435",
                 "devices": 1, "straps": 1, "pin_trays": 2, "tamper_plugs": 2, "chargers": 2, "tools": 0,
                 "quantity": 7, "is_accessory": True}
    assert (m["devices"], m["quantity"], m["is_accessory"], m["name"]) == (2, 0, False, "Menominee Co Sheriff, MI 2026-10-02 #252686")
    assert (s["straps"], s["quantity"], s["devices"]) == (100, 100, 0)
    assert p["name"] == "Professional Services Group (lease) 2026-10-08 #252963" and p["pin_trays"] == 100


def test_screwdriver_is_a_tool_and_empty_report_is_ok():
    data = book([(datetime(2026, 10, 8), "Justice Point - Sheboygan County Sheriff Huber", "1", "252955", "t",
                  [("Screwdriver  qty-3", "n/a"), ("Tamper Plug - Gray US  qty-400", "n/a")])])
    r = sp.parse_xlsx(data)
    assert r["warnings"] == [] and r["rows"][0]["tools"] == 3 and r["rows"][0]["quantity"] == 403
    wb = Workbook(); ws = wb.active; ws.append([None, "Equipment Shipped"]); ws.append([None, "Date Range: x"]); ws.append(HEAD); ws.append(["Grand Total"])
    b = io.BytesIO(); wb.save(b); assert sp.parse_xlsx(b.getvalue())["rows"] == []


def test_unknown_accessory_warns_and_counts():
    data = book([(datetime(2026, 10, 1), "Justice Point - X", "1", "9", "t", [("Belt Clip  qty-3", "n/a")])])
    r = sp.parse_xlsx(data)
    assert r["rows"][0]["quantity"] == 3 and r["rows"][0]["is_accessory"] and "Belt Clip" in r["warnings"][0]


def test_not_a_report():
    wb = Workbook(); wb.active.append(["a", "b"]); b = io.BytesIO(); wb.save(b)
    try:
        sp.parse_xlsx(b.getvalue()); assert False
    except ValueError:
        pass
