# ocr.py -- OCR for scanned PDFs, 14 Oct 2026 (same module as the contract pipeline, SOL_OCR switches).
#
# Until now a scan (no text layer) was marked "No text layer" and had to be OCR'd on your PC. This runs
# Catalyst's built-in OCR (Zia, no extra package -- zcatalyst-sdk is already in requirements.txt) on the
# pages that have no text, so a scanned packet can be read in the same run. A bundled OCR library was tried
# first and rejected: onnxruntime + OpenCV + numpy come to about 345 MB unpacked, too large for the function.
#
# Safe by construction: every failure (SDK not initialised, Zia refuses the page, quota, time budget, too
# little text found) returns ok=False with a plain reason, and the caller leaves the file as "No text layer"
# and writes a Note telling you to OCR it on his PC. OCR never fails the run and never raises.
#
# What OCR cannot promise: it can misread digits ($5.60 as $5.80, 2023 as 2028). Every value read from an
# OCR'd file is still only Proposed, and the Note names the OCR'd files so each rate and date is checked
# against the PDF.
#
# Limits (environment variables override): SOL_OCR=0 turns it off; SOL_OCR_MAX_PAGES (default 60 pages per
# run); SOL_OCR_MAX_SECONDS (default 300 seconds per run).

import io
import logging
import os
import tempfile
import time

log = logging.getLogger()

MIN_PAGE_CHARS = 40  # same rule as rule_ingest: fewer real characters than this = the page is an image
DPI = 200
MAX_IMAGE_BYTES = 4 * 1024 * 1024  # keep each upload well under the service's file-size limit
LOW_CONFIDENCE = 0.80


def enabled():
    return os.environ.get("SOL_OCR", "1") != "0"


class Budget:
    """Pages and seconds left for OCR in one run (shared by every file in the packet)."""

    def __init__(self, max_pages=None, max_seconds=None):
        self.pages_left = int(max_pages if max_pages is not None else os.environ.get("SOL_OCR_MAX_PAGES", "60"))
        self.deadline = time.monotonic() + float(
            max_seconds if max_seconds is not None else os.environ.get("SOL_OCR_MAX_SECONDS", "300"))

    def out_of_time(self):
        return time.monotonic() > self.deadline


class OcrResult:
    def __init__(self, ok, pages_text=None, ocr_pages=0, confidence=None, error=None):
        self.ok = ok
        self.pages_text = pages_text or []
        self.ocr_pages = ocr_pages
        self.confidence = confidence  # lowest page confidence seen, 0..1, or None if the service gave none
        self.error = error


# ---- the engine: png bytes -> (text, confidence 0..1 or None). Tests replace it with set_engine(). ----
_engine = None


def set_engine(fn):
    global _engine
    _engine = fn


def _norm_conf(v):
    try:
        f = float(str(v).strip().rstrip("%"))
    except (TypeError, ValueError):
        return None
    if f > 1.0:
        f = f / 100.0
    return max(0.0, min(f, 1.0))


def _zia_engine():
    """Catalyst Zia OCR, one page image per call. The app is created lazily so importing this module (and
    every local test) never needs Catalyst."""
    holder = {}

    def run(png_bytes):
        if "zia" not in holder:
            import zcatalyst_sdk  # noqa: PLC0415 -- only present on Catalyst
            errors = []
            app = None
            for make in (zcatalyst_sdk.initialize, zcatalyst_sdk.initialize_app):
                try:
                    app = make()
                    break
                except Exception as exc:  # noqa: BLE001
                    errors.append("{}: {}".format(getattr(make, "__name__", "init"), exc))
            if app is None:
                raise RuntimeError("could not start the Catalyst SDK (" + "; ".join(errors) + ")")
            holder["zia"] = app.zia()
        # The SDK only accepts an open file (BufferedReader), and the service wants a file name with an
        # image extension, so the page goes through a real temp file.
        fd, path = tempfile.mkstemp(suffix=".png")
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(png_bytes)
            with open(path, "rb") as f:
                out = holder["zia"].extract_optical_characters(f, {"language": "eng", "model_type": "OCR"})
        finally:
            try:
                os.remove(path)
            except OSError:
                pass
        out = out or {}
        return (out.get("text") or ""), _norm_conf(out.get("confidence"))

    return run


def _get_engine():
    global _engine
    if _engine is None:
        _engine = _zia_engine()
    return _engine


def _page_png(page):
    """Render one pdfplumber page to PNG bytes (grayscale; smaller, and OCR does not need colour)."""
    img = page.to_image(resolution=DPI).original.convert("L")
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    data = buf.getvalue()
    if len(data) > MAX_IMAGE_BYTES:  # a dense scan: fall back to JPEG
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=85)
        data = buf.getvalue()
    return data


def _real_chars(text):
    return len("".join((text or "").split()))


def ocr_pdf(raw_bytes, native_pages, budget):
    """OCR the pages of a PDF whose native text is missing. native_pages = list of per-page native text
    (already extracted). Pages that already have text keep it; only image-only pages are sent to OCR.

    Returns OcrResult. ok=True means at least half the pages now have real text (same rule as a text PDF)."""
    if not enabled():
        return OcrResult(False, error="OCR is switched off (SOL_OCR=0)")
    todo = [i for i, t in enumerate(native_pages) if _real_chars(t) < MIN_PAGE_CHARS]
    if len(todo) > budget.pages_left:
        return OcrResult(False, error="{} pages need OCR but only {} OCR pages are left for this run".format(
            len(todo), budget.pages_left))
    try:
        engine = _get_engine()
        import pdfplumber  # noqa: PLC0415
    except Exception as exc:  # noqa: BLE001
        return OcrResult(False, error="OCR service unavailable: {}".format(exc))

    texts = list(native_pages)
    done, confs = 0, []
    try:
        with pdfplumber.open(io.BytesIO(raw_bytes)) as pdf:
            for i in todo:
                if budget.out_of_time():
                    return OcrResult(False, error="ran out of OCR time after {} of {} pages".format(done, len(todo)))
                text, conf = engine(_page_png(pdf.pages[i]))
                budget.pages_left -= 1
                done += 1
                texts[i] = text.replace("\f", " ")
                if conf is not None:
                    confs.append(conf)
    except Exception as exc:  # noqa: BLE001 -- quota, network, bad page: never fail the run
        log.warning("OCR failed on page %s: %s", done + 1, exc)
        return OcrResult(False, error="OCR stopped on page {} ({})".format(todo[done] + 1 if done < len(todo) else "?",
                                                                       str(exc)[:200]))

    good = sum(1 for t in texts if _real_chars(t) >= MIN_PAGE_CHARS)
    if good * 2 < max(len(texts), 1):
        return OcrResult(False, error="OCR found readable text on only {} of {} pages".format(good, len(texts)))
    return OcrResult(True, pages_text=texts, ocr_pages=done, confidence=min(confs) if confs else None)
