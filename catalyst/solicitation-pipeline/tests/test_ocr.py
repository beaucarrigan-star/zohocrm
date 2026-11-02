"""OCR for scanned solicitation PDFs, with a fake engine (no Catalyst, no network)."""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from solpipe import extract, ingest, ocr  # noqa: E402
import test_ingest_flow as flow  # noqa: E402

OCR_TEXT = "\n".join(flow.RFP_LINES[0])


def _engine_ok(png):
    assert png[:4] in (b"\x89PNG", b"\xff\xd8\xff\xe0", b"\xff\xd8\xff\xdb") or png[:2] == b"\xff\xd8"
    return OCR_TEXT, 0.93


def _engine_boom(png):
    raise RuntimeError("quota exceeded")


def _scan_crm():
    return flow.FakeCrm({"s1": ("scan.pdf", flow.scanned_pdf())})


def test_scan_read_by_ocr():
    ocr.set_engine(_engine_ok)
    doc = extract.to_document("scan.pdf", flow.scanned_pdf())
    assert doc.get("ocr_used") and doc["ocr_pages"] == 1 and abs(doc["ocr_confidence"] - 0.93) < 1e-9, doc
    res = extract.parse_document(doc)
    assert not res["needs_manual"] and len(res["rows"]) >= 2, res


def test_text_pdf_not_ocrd():
    ocr.set_engine(_engine_boom)  # would fail loudly if called
    doc = extract.to_document("rfp.pdf", flow.text_pdf())
    assert not doc.get("ocr_used") and not doc.get("ocr_error")


def test_ocr_failure_leaves_reason_and_pc_note():
    ocr.set_engine(_engine_boom)
    doc = extract.to_document("scan.pdf", flow.scanned_pdf())
    assert "quota exceeded" in doc["ocr_error"] and not doc.get("ocr_used"), doc
    crm = _scan_crm()
    msg = ingest.run(crm, "1", budget_s=600)
    assert "OCR in Catalyst could not read" in msg and "Run OCR on your PC" in msg, msg
    q = {l[0]: l for l in ingest.parse_queue(crm.sol["Ingest_Queue"])}
    assert q["s1"][2] == "MANUAL" and "OCR on your PC" in q["s1"][3], q["s1"]


def test_ingest_flags_ocr_read():
    ocr.set_engine(_engine_ok)
    crm = _scan_crm()
    msg = ingest.run(crm, "1", budget_s=600)
    assert "Scans read by OCR: scan.pdf" in msg and "check every requirement" in msg, msg
    assert len(crm.reqs) >= 2


def test_budget_and_switch():
    ocr.set_engine(_engine_ok)
    doc = extract.to_document("scan.pdf", flow.scanned_pdf(), ocr.Budget(max_pages=0))
    assert "OCR pages are left" in doc["ocr_error"], doc
    os.environ["SOL_OCR"] = "0"
    try:
        doc = extract.to_document("scan.pdf", flow.scanned_pdf())
        assert "switched off" in doc["ocr_error"], doc
    finally:
        del os.environ["SOL_OCR"]


def test_no_catalyst_is_a_reason_not_a_crash():
    ocr.set_engine(None)
    doc = extract.to_document("scan.pdf", flow.scanned_pdf())
    assert "zcatalyst_sdk" in doc["ocr_error"], doc


if __name__ == "__main__":
    for k, fn in list(globals().items()):
        if k.startswith("test_") and callable(fn):
            fn()
            print("ok  ", k)
    print("ok")
