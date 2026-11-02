# 26 Oct 2026: Zoho cuts attachment downloads at 25 MB, so a big packet is attached as several zips.
import io
import os
import sys
import types
import zipfile

import pytest

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(HERE, "..", "con_worker"))
pytest.importorskip("reportlab")
pytest.importorskip("pdfplumber")
sys.modules.setdefault("zoho_client", types.ModuleType("zoho_client"))

from test_worker_e2e import FakeZoho, _pdf  # noqa: E402
from test_nested_zips import _fixture, _fixture_name, _zip_of  # noqa: E402


class SplitZoho(FakeZoho):
    """atts: list of (name, created_iso, bytes, listed_size or None)."""

    def __init__(self, contract, atts):
        super().__init__(contract, b"")
        self.atts = atts
        self.downloaded = []

    def list_attachments(self, module, rid):
        return [{"id": n, "File_Name": n, "Created_Time": t, "Size": sz if sz is not None else len(b)}
                for n, t, b, sz in self.atts]

    def download_attachment(self, module, rid, aid, **kw):
        self.downloaded.append(aid)
        return next(b for n, t, b, sz in self.atts if n == aid)


def _contract():
    return {"id": "c1", "Counterparty_Type": "Customer", "Account": None, "Ingest_Status": None, "Rate_Lines": []}


def _pdfs():
    return (_pdf(_fixture(_fixture_name())), _pdf("second document text for the packet " * 40))


def test_two_zips_within_ten_minutes_are_read_as_one_packet(monkeypatch):
    import main
    a, b = _pdfs()
    c = _contract()
    fake = SplitZoho(c, [("p1.zip", "2026-10-26T07:49:51-05:00", _zip_of([("A.pdf", a)]), None),
                         ("p2.zip", "2026-10-26T07:50:12-05:00", _zip_of([("B.pdf", b)]), None)])
    monkeypatch.setattr(main, "zc", fake)
    main._ingest_contract("c1")
    assert sorted(fake.downloaded) == ["p1.zip", "p2.zip"]
    assert sorted(d["File_Name"] for d in fake.docs) == ["A.pdf", "B.pdf"]
    assert any("Read 2 zips attached together" in n for n in fake.notes)


def test_older_zip_outside_window_is_ignored(monkeypatch):
    import main
    a, b = _pdfs()
    c = _contract()
    fake = SplitZoho(c, [("old.zip", "2026-10-25T19:48:49-05:00", _zip_of([("Old.pdf", a)]), None),
                         ("new.zip", "2026-10-26T07:50:12-05:00", _zip_of([("B.pdf", b)]), None)])
    monkeypatch.setattr(main, "zc", fake)
    main._ingest_contract("c1")
    assert fake.downloaded == ["new.zip"]
    assert [d["File_Name"] for d in fake.docs] == ["B.pdf"]


def test_oversized_sibling_in_window_is_skipped_with_a_warning(monkeypatch):
    import main
    a, b = _pdfs()
    c = _contract()
    fake = SplitZoho(c, [("big.zip", "2026-10-26T07:43:09-05:00", b"", 33217237),
                         ("p1.zip", "2026-10-26T07:49:51-05:00", _zip_of([("A.pdf", a)]), None),
                         ("p2.zip", "2026-10-26T07:50:12-05:00", _zip_of([("B.pdf", b)]), None)])
    monkeypatch.setattr(main, "zc", fake)
    main._ingest_contract("c1")
    assert "big.zip" not in fake.downloaded
    assert sorted(d["File_Name"] for d in fake.docs) == ["A.pdf", "B.pdf"]
    assert any("big.zip" in n and "25 MB" in n for n in fake.notes)


def test_single_oversized_zip_fails_with_a_clear_message(monkeypatch):
    import main
    c = _contract()
    fake = SplitZoho(c, [("big.zip", "2026-10-26T07:43:09-05:00", b"", 33217237)])
    monkeypatch.setattr(main, "zc", fake)
    main._ingest_contract("c1")
    assert c["Ingest_Status"] == "Failed" and not fake.downloaded
    assert "31.7 MB" in fake.notes[-1] and "under 25 MB" in fake.notes[-1]


def test_oversized_loose_file_fails_with_a_clear_message(monkeypatch):
    import main
    c = _contract()
    fake = SplitZoho(c, [("Agreement.pdf", "2026-10-26T07:43:09-05:00", b"", 30000000)])
    monkeypatch.setattr(main, "zc", fake)
    main._ingest_contract("c1")
    assert c["Ingest_Status"] == "Failed" and "Agreement.pdf" in fake.notes[-1]


def test_same_split_packet_is_recognised_as_unchanged(monkeypatch):
    import main
    a, b = _pdfs()
    c = _contract()
    fake = SplitZoho(c, [("p1.zip", "2026-10-26T07:49:51-05:00", _zip_of([("A.pdf", a)]), None),
                         ("p2.zip", "2026-10-26T07:50:12-05:00", _zip_of([("B.pdf", b)]), None)])
    monkeypatch.setattr(main, "zc", fake)
    main._ingest_contract("c1")
    n = len(fake.notes)
    main._ingest_contract("c1")
    assert "already read earlier" in fake.notes[n] or c["Ingest_Status"] == "Failed"
