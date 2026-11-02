# 14 Oct 2026: Contractbook downloads are a zip of zips; only the first zip attachment was read.
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
from packet_reader import read_packet  # noqa: E402


def _fixture(name):
    with open(os.path.join(HERE, "fixtures", name + ".txt"), encoding="utf-8") as f:
        return f.read()


def _zip_of(files):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, data in files:
            z.writestr(name, data)
    return buf.getvalue()


def _fixture_name():
    d = os.path.join(HERE, "fixtures")
    return sorted(f[:-4] for f in os.listdir(d) if f.endswith(".txt"))[0]


def test_nested_zip_is_opened_and_duplicates_read_once():
    pdf = _pdf(_fixture(_fixture_name()))
    inner = _zip_of([("Agreement.pdf", pdf)])
    outer = _zip_of([("Download.zip", inner), ("Download (1).zip", inner)])
    entries, _, warnings = read_packet(outer)
    read = [e for e in entries if not e.skip_reason]
    assert [e.name for e in read] == ["Agreement.pdf"]
    dups = [e for e in entries if e.skip_reason and e.skip_reason.startswith("same file as")]
    assert len(dups) == 1 and not any("nested zip" in (e.skip_reason or "") for e in entries)


def test_same_name_different_content_in_two_zips_is_kept_apart():
    a = _pdf(_fixture(_fixture_name()))
    b = _pdf("different contract text " * 40)
    outer = _zip_of([("One.zip", _zip_of([("Agreement.pdf", a)])), ("Two.zip", _zip_of([("Agreement.pdf", b)]))])
    entries, _, _ = read_packet(outer)
    assert sorted(e.name for e in entries if not e.skip_reason) == ["Agreement.pdf", "Two/Agreement.pdf"]


def test_zip_depth_is_limited():
    z = _zip_of([("a.pdf", _pdf("x " * 100))])
    for _ in range(4):
        z = _zip_of([("in.zip", z)])
    entries, _, _ = read_packet(z)
    assert any("too deep" in (e.skip_reason or "") for e in entries)


class MultiZipZoho(FakeZoho):
    def __init__(self, contract, atts):
        super().__init__(contract, b"")
        self.atts = atts

    def list_attachments(self, module, rid):
        # Created_Time rises in insertion order, so the last zip added is the newest
        return [{"id": k, "File_Name": k, "Created_Time": "2026-10-21T{:02d}:00:00-05:00".format(i)} for i, k in enumerate(self.atts)]

    def download_attachment(self, module, rid, aid, **kw):
        return self.atts[aid]


def test_newest_zip_is_the_packet_and_failed_run_can_be_rerun(monkeypatch):
    # 21 Oct 2026: merged with the 20 Oct rule -- the NEWEST zip attachment is the packet (a stale zip from an earlier
    # attempt must not be read with it); loose files are bundled only when there is no zip.
    import main
    pdf = _pdf(_fixture(_fixture_name()))
    good = _zip_of([("Download.zip", _zip_of([("Agreement.pdf", pdf)]))])
    contract = {"id": "c1", "Counterparty_Type": "Customer", "Account": None, "Ingest_Status": None, "Rate_Lines": []}
    # first: only a zip with nothing readable in it -> Failed, hash not recorded
    empty = _zip_of([("notes.docm", b"x")])
    fake = MultiZipZoho(contract, {"empty.zip": empty})
    monkeypatch.setattr(main, "zc", fake)
    main._ingest_contract("c1")
    assert contract["Ingest_Status"] == "Failed" and not contract.get("Packet_Hash")
    # then a newer zip is added: it is the packet (nested zips inside it are still opened)
    fake.atts["good.zip"] = good
    main._ingest_contract("c1")
    assert contract["Ingest_Status"] == "Needs Review"
    assert any(d["File_Name"] == "Agreement.pdf" for d in fake.docs)
    # a Failed contract is never short-circuited, even on the same packet hash
    contract["Ingest_Status"] = "Failed"
    n = len(fake.notes)
    main._ingest_contract("c1")
    assert "already read earlier" not in fake.notes[n]
