# 14 Oct 2026: OCR for scanned PDFs (Catalyst Zia). The Zia service itself cannot be called from tests, so a
# fake engine stands in; everything around it (page selection, budget, fallbacks, Note wording, rerun) is real.
import io
import os
import sys
import types

import pytest

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(HERE, "..", "con_worker"))
pytest.importorskip("reportlab")
pytest.importorskip("pdfplumber")
sys.modules.setdefault("zoho_client", types.ModuleType("zoho_client"))

from PIL import Image, ImageDraw  # noqa: E402
from reportlab.lib.utils import ImageReader  # noqa: E402
from reportlab.pdfgen import canvas  # noqa: E402

import ocr  # noqa: E402
import packet_reader as pr  # noqa: E402
from test_nested_zips import MultiZipZoho, _fixture, _fixture_name, _zip_of  # noqa: E402

BODY = "This Agreement is entered into by Polk County and JusticePoint for electronic monitoring services."


def _scan_pdf(n_pages=1, text_pages=()):
    """A PDF whose pages are images (a scan); pages listed in text_pages carry real text instead."""
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    for i in range(n_pages):
        if i in text_pages:
            c.drawString(72, 720, BODY)
        else:
            img = Image.new("L", (400, 200), 255)
            ImageDraw.Draw(img).text((10, 10), "scan page", fill=0)
            c.drawImage(ImageReader(img), 72, 500, width=300, height=150)
        c.showPage()
    c.save()
    return buf.getvalue()


@pytest.fixture(autouse=True)
def _reset_engine():
    ocr.set_engine(None)
    yield
    ocr.set_engine(None)


def test_scan_is_read_by_ocr():
    calls = []
    ocr.set_engine(lambda png: (calls.append(len(png)) or BODY * 2, 0.97))
    entries, _, _ = pr.read_packet(_zip_of([("scan.pdf", _scan_pdf(2))]))
    e = entries[0]
    assert not e.no_text_layer and e.ocr_used and e.ocr_pages == 2 and len(calls) == 2
    assert BODY in e.text and abs(e.ocr_confidence - 0.97) < 1e-9


def test_only_image_pages_are_sent_to_ocr():
    calls = []
    ocr.set_engine(lambda png: (calls.append(1) or BODY * 2, None))
    # 4 pages, 2 with real text: that is half, so the file is a text PDF and is NOT a scan at all
    entries, _, _ = pr.read_packet(_zip_of([("mixed.pdf", _scan_pdf(4, text_pages=(0, 1)))]))
    assert not entries[0].ocr_used and calls == []
    # 5 pages, 1 with text: a scan; only the 4 image pages go to OCR
    entries, _, _ = pr.read_packet(_zip_of([("mixed2.pdf", _scan_pdf(5, text_pages=(0,)))]))
    assert entries[0].ocr_used and len(calls) == 4 and entries[0].ocr_pages == 4


def test_ocr_failure_leaves_a_scan_with_a_reason():
    def boom(png):
        raise RuntimeError("quota exceeded")
    ocr.set_engine(boom)
    entries, _, _ = pr.read_packet(_zip_of([("scan.pdf", _scan_pdf(1))]))
    e = entries[0]
    assert e.no_text_layer and not e.ocr_used and "quota exceeded" in e.ocr_error


def test_ocr_that_finds_nothing_is_a_failure():
    ocr.set_engine(lambda png: ("", 0.1))
    entries, _, _ = pr.read_packet(_zip_of([("scan.pdf", _scan_pdf(2))]))
    assert entries[0].no_text_layer and "only 0 of 2 pages" in entries[0].ocr_error


def test_page_budget_and_switch(monkeypatch):
    ocr.set_engine(lambda png: (BODY, None))
    monkeypatch.setenv("CON_OCR_MAX_PAGES", "1")
    entries, _, _ = pr.read_packet(_zip_of([("scan.pdf", _scan_pdf(3))]))
    assert entries[0].no_text_layer and "OCR pages are left" in entries[0].ocr_error
    monkeypatch.delenv("CON_OCR_MAX_PAGES")
    monkeypatch.setenv("CON_OCR", "0")
    entries, _, _ = pr.read_packet(_zip_of([("scan.pdf", _scan_pdf(1))]))
    assert entries[0].no_text_layer and "switched off" in entries[0].ocr_error


def test_time_budget(monkeypatch):
    ocr.set_engine(lambda png: (BODY, None))
    monkeypatch.setenv("CON_OCR_MAX_SECONDS", "-1")
    entries, _, _ = pr.read_packet(_zip_of([("scan.pdf", _scan_pdf(2))]))
    assert entries[0].no_text_layer and "ran out of OCR time" in entries[0].ocr_error


def test_no_catalyst_means_a_reason_not_a_crash():
    entries, _, _ = pr.read_packet(_zip_of([("scan.pdf", _scan_pdf(1))]))  # real engine, no zcatalyst_sdk here
    assert entries[0].no_text_layer and "zcatalyst_sdk" in entries[0].ocr_error


def _contract():
    return {"id": "c1", "Counterparty_Type": "Customer", "Account": None, "Ingest_Status": None, "Rate_Lines": []}


def _fixture_pdf():
    from test_worker_e2e import _pdf
    return _pdf(_fixture(_fixture_name()))


def test_ingest_reads_a_scan_and_flags_it(monkeypatch):
    import main
    ocr.set_engine(lambda png: (_fixture(_fixture_name()), 0.91))
    contract = _contract()
    fake = MultiZipZoho(contract, {"price.pdf": _scan_pdf(1)})
    monkeypatch.setattr(main, "zc", fake)
    main._ingest_contract("c1")
    assert contract["Ingest_Status"] == "Needs Review"
    assert any(d["File_Name"] == "price.pdf" and d["Parse_Status"] == "Parsed" for d in fake.docs)
    note = fake.notes[-1]
    assert "price.pdf is a scan and was read by OCR" in note and "check every rate" in note


def test_ingest_tells_beau_to_use_the_pc_when_ocr_fails(monkeypatch):
    import main

    def boom(png):
        raise RuntimeError("Zia is not enabled")
    ocr.set_engine(boom)
    contract = _contract()
    fake = MultiZipZoho(contract, {"price.pdf": _scan_pdf(1)})
    monkeypatch.setattr(main, "zc", fake)
    main._ingest_contract("c1")
    note = fake.notes[-1]
    assert contract["Ingest_Status"] == "Failed"
    assert "OCR in Catalyst could not read price.pdf" in note and "Zia is not enabled" in note
    assert "Run OCR on your PC" in note and "attach the searchable copy under a new file name" in note
    assert any(d["File_Name"] == "price.pdf" and d["Parse_Status"] == "No text layer" for d in fake.docs)


def test_unread_scan_is_not_short_circuited(monkeypatch):
    import main
    contract = _contract()
    fake = MultiZipZoho(contract, {"a.pdf": _fixture_pdf(), "price.pdf": _scan_pdf(1)})
    monkeypatch.setattr(main, "zc", fake)
    ocr.set_engine(lambda png: (_ for _ in ()).throw(RuntimeError("down")))
    main._ingest_contract("c1")
    assert contract["Ingest_Status"] == "Needs Review" and contract["Packet_Hash"]
    # same packet again, OCR still down but a 'No text layer' row exists: it must be read again, not skipped
    real = fake.coql
    fake.coql = lambda q: [{"id": "d9"}] if "Parse_Status = 'No text layer'" in q else real(q)
    n = len(fake.notes)
    main._ingest_contract("c1")
    assert "already read earlier" not in fake.notes[n]
    # with no scan left, the same packet is a no-op as before
    fake.coql = real
    n = len(fake.notes)
    main._ingest_contract("c1")
    assert "already read earlier" in fake.notes[n]
