# packet_reader.py
# Vendored from the solicitation-pipeline zip ingest (claude/solicitation-pipeline-catalyst-live-2026-09-25.md)
# with the same limits, so the two pipelines behave identically for the part Beau already trusts.
#
# Opens a packet .zip attached to a Contract (or, for the "new contract from packet" path, an Account)
# and returns one entry per readable file: name, extension, raw bytes, extracted text (for classification
# and no-text-layer detection), page count (PDFs), and a sha1 of the bytes (used as the Contract_Documents
# upsert key together with File_Name).
#
# 28 Sep 2026 (Phase 3b/3c): PDF pages are now joined with a form feed (\f) instead of \n so the rate
# and terms extractors can cite the page a value came from ("packet.zip > Addendum 24.pdf, p.2").
#
# Zips inside the zip are opened (14 Oct 2026: Contractbook downloads are a zip of zips), up to MAX_ZIP_DEPTH.
# Skipped, and named in the caller's summary: duplicate files, password-protected files, file types
# other than pdf/docx/xlsx/xls/csv/txt, __MACOSX entries, and hidden files (dotfiles).
# Limits: 200 files, 60 MB per file, 250 MB unzipped in total. These match the solicitation pipeline's
# limits exactly -- do not diverge without updating both.

import hashlib
import logging
import io
import os
import re
import time
import zipfile

import ocr

for _noisy in ("pdfminer", "pdfplumber", "PIL"):
    logging.getLogger(_noisy).setLevel(logging.WARNING)  # per-token DEBUG logging made big PDFs crawl (20 Oct 2026)
# per file; a PDF that takes longer is reported by name instead of hanging the job. 26 Oct 2026: 120 -> 300. The
# Milwaukee County Pretrial packet has a 414-page PDF that takes ~50 s on a fast machine; Catalyst is slower.
MAX_PDF_SECONDS = int(os.environ.get("CON_PDF_SECONDS", "300"))

# 26 Oct 2026: a page whose text is only "(cid:12)(cid:7)..." is image-only with a stamp. DocuSign stamps every page
# of a printed envelope ("Docusign Envelope ID") in a font with no Unicode map, so pdfplumber returns the glyph ids
# as literal "(cid:N)" strings. Those strings counted as real characters, so 31 of the 56 pages of the Milwaukee
# SOW amendments PDF (Amendment #1 and the certificate of insurance, all scans) passed the text-layer check and
# were never sent to OCR. They are removed from the text before any page is judged.
_CID = re.compile(r"\(cid:\d+\)")

MIN_PAGE_CHARS = 40  # below this a PDF page is treated as image-only (no text layer)

MAX_FILES = 200
MAX_FILE_BYTES = 60 * 1024 * 1024
MAX_TOTAL_BYTES = 250 * 1024 * 1024

READABLE_EXT = {".pdf", ".docx", ".xlsx", ".xls", ".csv", ".txt"}


class PacketEntry:
    def __init__(self, name, ext, raw_bytes, text, pages, sha1, no_text_layer, skip_reason=None,
                 ocr_used=False, ocr_pages=0, ocr_confidence=None, ocr_error=None, unread_pages=None):
        # ocr_used: the text came from OCR (Catalyst Zia). ocr_error: OCR was tried on a scan and failed, so the
        # file stays "No text layer" and the Note tells Beau to OCR it on his PC.
        self.ocr_used = ocr_used
        self.ocr_pages = ocr_pages
        self.ocr_confidence = ocr_confidence
        self.ocr_error = ocr_error
        # PDF pages that are scans nobody could read (OCR off or failed); the rest of the file WAS read.
        self.unread_pages = unread_pages or []
        self.name = name
        self.ext = ext
        self.raw_bytes = raw_bytes
        self.text = text
        self.pages = pages
        self.sha1 = sha1
        self.no_text_layer = no_text_layer
        self.skip_reason = skip_reason

    def to_summary(self):
        if self.skip_reason:
            return "{} (skipped: {})".format(self.name, self.skip_reason)
        if self.no_text_layer:
            return "{} (no text layer -- needs OCR on Beau's PC)".format(self.name)
        return self.name


def _is_hidden_or_system(name):
    base = name.rsplit("/", 1)[-1]
    if base == "":
        return True  # directory entry
    if base.startswith("."):
        return True
    if "__MACOSX" in name:
        return True
    return False

log = logging.getLogger()


def mem_mb():
    """Current memory of this process in MB (Linux /proc; 0 where unavailable). Logged so a killed job shows how far it got."""
    try:
        with open("/proc/self/statm") as f:
            return int(f.read().split()[1]) * os.sysconf("SC_PAGE_SIZE") // 1048576
    except Exception:  # noqa: BLE001
        return 0


def _extract_pdf_pages(raw_bytes):
    """Per-page native text (form feeds removed) and the page count."""
    # pdfplumber is the project's standard PDF reader (see the solicitation and billing pipelines).
    import pdfplumber

    pages_text = []
    started = time.monotonic()
    with pdfplumber.open(io.BytesIO(raw_bytes)) as pdf:
        for n, page in enumerate(pdf.pages, 1):
            if n % 50 == 0:
                log.info("  page %s read, %ss, mem %s MB", n, int(time.monotonic() - started), mem_mb())
            if time.monotonic() - started > MAX_PDF_SECONDS:
                raise RuntimeError("took over {}s to read (vector-heavy or very large PDF) -- flatten or OCR it on Beau's PC and re-upload".format(MAX_PDF_SECONDS))
            pages_text.append(_CID.sub(" ", page.extract_text() or "").replace("\f", " "))
            # 26 Oct 2026: pdfplumber keeps every page's layout objects for the life of the PDF. A 640-page packet
            # (Milwaukee) peaked at 2.6 GB and the Catalyst job was killed with no Note. Freeing each page after its
            # text is read brings the same packet to 0.4 GB.
            _free_page(page)
    return pages_text


def _free_page(page):
    for name in ("flush_cache", "close"):
        fn = getattr(page, name, None)
        if fn:
            try:
                fn()
            except Exception:  # noqa: BLE001 -- freeing memory must never fail a read
                pass


def _text_layer_ok(pages_text):
    # A page counts as having a text layer only with MIN_PAGE_CHARS+ real characters: a scan whose only
    # text is a date stamp or Bates number (Monroe County OH, 27 Sep 2026: 7 chars over 7 pages) is still
    # a scan. The file needs OCR when fewer than half its pages have text.
    text_pages = sum(1 for t in pages_text if len("".join(t.split())) >= MIN_PAGE_CHARS)
    return not (text_pages * 2 < max(len(pages_text), 1))


def _extract_pdf_text(raw_bytes):
    pages_text = _extract_pdf_pages(raw_bytes)
    return "\f".join(pages_text), len(pages_text), (not _text_layer_ok(pages_text))


def _extract_docx_text(raw_bytes):
    import docx

    d = docx.Document(io.BytesIO(raw_bytes))
    paras = [p.text for p in d.paragraphs]
    for table in d.tables:
        for row in table.rows:
            paras.append("  ".join(cell.text for cell in row.cells))  # keep a row's cells together
    text = "\n".join(paras)
    return text, None, (len(text.strip()) == 0)


def _extract_xlsx_text(raw_bytes):
    import openpyxl

    wb = openpyxl.load_workbook(io.BytesIO(raw_bytes), data_only=True, read_only=True)
    rows_text = []
    for ws in wb.worksheets:
        for row in ws.iter_rows(values_only=True):
            rows_text.append("\t".join("" if v is None else str(v) for v in row))
    text = "\n".join(rows_text)
    return text, None, (len(text.strip()) == 0)


def _extract_plain_text(raw_bytes):
    try:
        text = raw_bytes.decode("utf-8")
    except UnicodeDecodeError:
        text = raw_bytes.decode("latin-1", errors="replace")
    return text, None, (len(text.strip()) == 0)


MAX_ZIP_DEPTH = 3  # the packet itself plus up to two levels of zips inside it (Contractbook = zip of zips)


def read_packet(zip_bytes, ocr_pages=None):
    """Returns (entries: list[PacketEntry], packet_sha256: str, warnings: list[str]).

    Zips inside the packet are opened (up to MAX_ZIP_DEPTH levels). A file that appears twice (same sha1,
    e.g. "Download (1).zip" next to "Download.zip") is read once; the copy is listed as skipped."""
    warnings = []
    entries = []
    # ocr_pages=0 (S45, 29 Oct 2026): no OCR at all -- used when Claude re-reads an unchanged packet and reads the
    # scans itself. OCR of Milwaukee's 31 scanned pages kills the Catalyst job (no error, the job is retried).
    state = {"files": 0, "total": 0, "seen": {}, "names": set(), "ocr_budget": ocr.Budget(max_pages=ocr_pages)}
    packet_sha256 = hashlib.sha256(zip_bytes).hexdigest()
    _read_zip(zip_bytes, "", 1, entries, warnings, state)
    return entries, packet_sha256, warnings


def _unique_name(name, label, state):
    """A file inside a nested zip keeps its own name; if another zip already gave that name, the inner
    zip's name is put in front so Contract_Documents (keyed by File_Name + sha1) stays unambiguous."""
    if name not in state["names"]:
        return name
    stem = label.rsplit("/", 1)[-1]
    if stem.lower().endswith(".zip"):
        stem = stem[:-4]
    candidate = "{}/{}".format(stem, name)
    n = 2
    while candidate in state["names"]:
        candidate = "{}/{} ({})".format(stem, name, n)
        n += 1
    return candidate


def _read_zip(zip_bytes, label, depth, entries, warnings, state):
    try:
        zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
    except zipfile.BadZipFile:
        if depth == 1:
            warnings.append("packet.zip is not a valid zip file")
        else:
            entries.append(PacketEntry(label, ".zip", None, "", None, None, False, "not a valid zip, not opened"))
        return

    names = zf.namelist()
    room = MAX_FILES - state["files"]
    if len(names) > room:
        warnings.append(
            "{} has {} files, only the first {} were read".format(label or "packet.zip", len(names), max(room, 0))
        )
        names = names[:max(room, 0)]
    state["files"] += len(names)

    for name in names:
        if _is_hidden_or_system(name):
            continue
        ext = ("." + name.rsplit(".", 1)[-1].lower()) if "." in name else ""
        shown = name if depth == 1 else _unique_name(name, label, state)

        if ext == ".zip":
            if depth >= MAX_ZIP_DEPTH:
                entries.append(PacketEntry(shown, ext, None, "", None, None, False, "zip nested too deep, not opened"))
                continue
            info = zf.getinfo(name)
            if info.file_size > MAX_FILE_BYTES:
                entries.append(PacketEntry(shown, ext, None, "", None, None, False, "over 60 MB, not read"))
                continue
            try:
                inner = zf.read(name)
            except RuntimeError as e:
                why = "password protected" if "password" in str(e).lower() else "could not read: " + str(e)
                entries.append(PacketEntry(shown, ext, None, "", None, None, False, why))
                continue
            state["total"] += len(inner)
            if state["total"] > MAX_TOTAL_BYTES:
                entries.append(PacketEntry(shown, ext, None, "", None, None, False, "over the 250 MB packet total, not read"))
                continue
            _read_zip(inner, shown, depth + 1, entries, warnings, state)
            continue

        info = zf.getinfo(name)
        if info.file_size > MAX_FILE_BYTES:
            entries.append(PacketEntry(shown, ext, None, "", None, None, False, "over 60 MB, not read"))
            continue

        if ext not in READABLE_EXT:
            entries.append(PacketEntry(shown, ext, None, "", None, None, False, "unsupported file type"))
            continue

        try:
            raw = zf.read(name)
        except RuntimeError as e:
            # zipfile raises RuntimeError for password-protected entries
            if "password" in str(e).lower():
                entries.append(PacketEntry(shown, ext, None, "", None, None, False, "password protected"))
                continue
            entries.append(PacketEntry(shown, ext, None, "", None, None, False, "could not read: " + str(e)))
            continue

        state["total"] += len(raw)
        if state["total"] > MAX_TOTAL_BYTES:
            entries.append(PacketEntry(shown, ext, None, "", None, None, False, "over the 250 MB packet total, not read"))
            continue

        sha1 = hashlib.sha1(raw).hexdigest()
        if sha1 in state["seen"]:
            entries.append(PacketEntry(shown, ext, None, "", None, sha1, False,
                                       "same file as {}, read once".format(state["seen"][sha1])))
            continue
        state["seen"][sha1] = shown
        state["names"].add(shown)

        ocr_info = {}
        log.info("reading %s (%s KB), mem %s MB", shown, len(raw) // 1024, mem_mb())
        try:
            if ext == ".pdf":
                pages_text = _extract_pdf_pages(raw)
                text, pages, no_text = "\f".join(pages_text), len(pages_text), (not _text_layer_ok(pages_text))
                if no_text:
                    # A scan. Try Catalyst OCR on the image-only pages; if it cannot, the file stays
                    # "No text layer" and the Note says to OCR it on the PC.
                    res = ocr.ocr_pdf(raw, pages_text, state["ocr_budget"])
                    if res.ok:
                        text, no_text = "\f".join(res.pages_text), False
                        ocr_info = {"ocr_used": True, "ocr_pages": res.ocr_pages, "ocr_confidence": res.confidence}
                    else:
                        ocr_info = {"ocr_error": res.error}
                        # 26 Oct 2026: a PDF with SOME text pages (e.g. 25 of 56) is read from those pages; only a
                        # PDF with no text at all is "No text layer". The unread pages are named in the Note.
                        blank = [i + 1 for i, t in enumerate(pages_text) if len("".join(t.split())) < MIN_PAGE_CHARS]
                        if len(blank) < len(pages_text):
                            no_text = False
                            ocr_info["unread_pages"] = blank
            elif ext == ".docx":
                text, pages, no_text = _extract_docx_text(raw)
            elif ext in (".xlsx", ".xls"):
                text, pages, no_text = _extract_xlsx_text(raw)
            else:  # .csv, .txt
                text, pages, no_text = _extract_plain_text(raw)
        except Exception as e:  # noqa: BLE001 -- a single bad file must not fail the whole packet
            entries.append(PacketEntry(shown, ext, raw, "", None, sha1, False, "could not parse: " + str(e)))
            continue

        log.info("read %s: %s pages, text layer %s, mem %s MB", shown, pages, "no" if no_text else "yes", mem_mb())
        entries.append(PacketEntry(shown, ext, raw, text, pages, sha1, no_text, **ocr_info))
