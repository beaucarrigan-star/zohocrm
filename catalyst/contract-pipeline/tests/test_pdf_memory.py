# 26 Oct 2026: a 640-page packet peaked at 2.6 GB and the Catalyst job was killed silently.
import os
import sys
import types

import pytest

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(HERE, "..", "con_worker"))
pytest.importorskip("reportlab")
pytest.importorskip("pdfplumber")
sys.modules.setdefault("zoho_client", types.ModuleType("zoho_client"))

from test_worker_e2e import _pdf  # noqa: E402
import packet_reader  # noqa: E402


def test_every_page_is_freed_after_its_text_is_read(monkeypatch):
    import pdfplumber.page
    freed = []
    real = pdfplumber.page.Page.flush_cache

    def spy(self, *a, **k):
        freed.append(self.page_number)
        return real(self, *a, **k)

    monkeypatch.setattr(pdfplumber.page.Page, "flush_cache", spy)
    raw = _pdf(("A clause about the term of this agreement. " * 60 + "\n") * 6)
    pages = packet_reader._extract_pdf_pages(raw)
    assert len(pages) >= 2 and pages[0].strip()
    assert sorted(set(freed)) == list(range(1, len(pages) + 1))


def test_freeing_a_page_never_fails_the_read():
    class Bad:
        def flush_cache(self):
            raise RuntimeError("boom")

    packet_reader._free_page(Bad())
    packet_reader._free_page(object())
