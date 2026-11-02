# claude_extract.py -- Phase 10a (S45, 29 Oct 2026): the Claude API reads the whole packet beside the
# rule-based extractors.
#
# Switch: CON_CLAUDE = off (default) | shadow | on.
#   off     nothing here runs; the worker behaves exactly as before.
#   shadow  after the rule-based ingest, the packet goes to Claude; its answer is compared with the rules and
#           with what the CRM holds now, and posted as a second Note plus a .json attachment. Nothing else is
#           written. This is how 10a starts (handoff, 29 Oct decisions).
#   on      reserved. Write-back from Claude is not built yet, so "on" runs as shadow and the Note says so.
#
# Models are environment variables so a change is an env edit, not a code change:
#   CLAUDE_MODEL_EXTRACT  default extractor (Sonnet)             CLAUDE_MODEL_REVIEW  Opus
#   CLAUDE_WORKSPACE_ID   only for an organization-level key: sent as the anthropic-workspace-id header
#   CON_CLAUDE_MODELS     optional comma list; when set, every model in it reads the packet (golden-set runs,
#                         e.g. "claude-haiku-5-5,claude-sonnet-5-5,claude-opus-5-5")
#   CON_CLAUDE_ESCALATE   "1": when the extract model's answer disagrees with the rules or with the CRM on a term
#                         (or the read failed), the review model reads the packet too. Default "0".
#   CON_CLAUDE_RERUN      "1": an unchanged packet (same Packet_Hash) is still read by Claude, in memory only,
#                         so the golden set can be run without changing a packet. Default "0".
# Limits: CON_CLAUDE_MAX_CHARS (text sent, default 1,500,000), CON_CLAUDE_MAX_PDF_MB (scans sent as PDF, default
# 25), CON_CLAUDE_MAX_TOKENS (answer, default 48000; 16000 cut off 5 of 12 golden runs, 29 Oct), CON_CLAUDE_TIMEOUT (seconds per call, default 600).
#
# Secrets: CLAUDE_API_KEY is read from the environment and sent only in the x-api-key header. It is never
# logged, never put in a Note, an attachment or an error message.
#
# Safe by construction: every failure (no key, HTTP error, refusal, cut-off answer, bad JSON) ends as one
# plain line in the shadow Note. Nothing here raises into the worker, and the rule-based ingest has already
# been written before this runs.

import base64
import datetime as dt
import json
import logging
import os
import re
import time

import requests

log = logging.getLogger()

API_URL = "https://api.anthropic.com/v1/messages"
API_VERSION = "2023-06-01"
MODES = ("off", "shadow", "on")
HERE = os.path.dirname(os.path.abspath(__file__))
RETRY_CODES = (429, 500, 502, 503, 504, 529)

# USD per million tokens (input, output), from platform.claude.com/docs/en/models/overview on 29 Oct 2026.
# Haiku is listed as "from"; the estimate uses that floor. The Console is the real bill.
PRICES = (("claude-opus", 4.0, 20.0), ("claude-sonnet", 2.0, 10.0), ("claude-haiku", 0.10, 0.50),
          ("claude-fable", 10.0, 50.0))

TERM_FIELDS = ("Contract_Start_Date", "Contract_End_Date", "Auto_Renews", "Renewals_Allowed", "Renewal_Options_Left",
               "Renewal_Option_Length_Mo", "Notice_Period_Days", "Termination_Convenience_Days", "Payment_Terms_Days",
               "Invoice_Cadence", "Rate_Basis", "Admin_Rate_Pct", "Not_To_Exceed", "Escalator_Pct", "Governing_State",
               "Insurance_Limit", "Spare_Clause_Detail")

COUNTERPARTY_HINT = {
    "Vendor": "a vendor JusticePoint buys devices and monitoring from; prices are JusticePoint's cost",
    "Customer": "a customer JusticePoint provides EM services to; prices are what the customer pays",
}


def mode():
    v = os.environ.get("CON_CLAUDE", "off").strip().lower()
    return v if v in MODES else "off"


def rerun_unchanged():
    return mode() != "off" and os.environ.get("CON_CLAUDE_RERUN", "0").strip() == "1"


def models():
    listed = [m.strip() for m in os.environ.get("CON_CLAUDE_MODELS", "").split(",") if m.strip()]
    return listed or [os.environ.get("CLAUDE_MODEL_EXTRACT", "claude-sonnet-5-5").strip()]


def _int_env(name, default):
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


def load_prompt(counterparty_type, contract_name):
    with open(os.path.join(HERE, "claude_prompt.md"), encoding="utf-8") as f:
        text = f.read()
    return (text.replace("{counterparty_type}", counterparty_type or "Unknown")
                .replace("{counterparty_hint}", COUNTERPARTY_HINT.get(counterparty_type, "type not set"))
                .replace("{contract_name}", contract_name or "(no name)"))


def load_schema():
    with open(os.path.join(HERE, "claude_schema.json"), encoding="utf-8") as f:
        return json.load(f)


# ---------------------------------------------------------------------------------------------
# Packet -> content blocks
# ---------------------------------------------------------------------------------------------

def _clean(text):
    # pdfplumber turns some ligatures ("ff", "fi") into NUL; Claude reads around a gap better than a control char.
    return (text or "").replace("\x00", "")


def build_content(entries):
    """entries: packet_reader.PacketEntry list. Returns (content_blocks, sent_files, not_sent_lines).
    Text files go as text with page markers; PDF scans (no text layer, or pages nobody could read) go as PDF
    document blocks so Claude reads the image itself."""
    max_chars = _int_env("CON_CLAUDE_MAX_CHARS", 1500000)
    max_pdf = _int_env("CON_CLAUDE_MAX_PDF_MB", 25) * 1024 * 1024
    blocks, sent, not_sent = [], [], []
    chars = pdf_bytes = 0
    for e in entries:
        if getattr(e, "skip_reason", None):
            continue
        is_pdf = (e.ext or "").lower() == ".pdf"
        needs_pdf = is_pdf and e.raw_bytes and (e.no_text_layer or getattr(e, "unread_pages", None))
        if e.text and not e.no_text_layer:
            pages = _clean(e.text).split("\f")
            body = "\n".join("--- page {} ---\n{}".format(i, p.strip()) for i, p in enumerate(pages, start=1))
            head = "=== FILE: {} ({} page{}{}) ===\n".format(
                e.name, len(pages), "" if len(pages) == 1 else "s",
                ", text read by OCR -- digits may be misread" if getattr(e, "ocr_used", False) else "")
            if chars + len(body) > max_chars:
                not_sent.append("{}: not sent to Claude (text over the CON_CLAUDE_MAX_CHARS cap)".format(e.name))
                continue
            chars += len(body)
            blocks.append({"type": "text", "text": head + body})
            sent.append(e.name)
        if needs_pdf:
            if pdf_bytes + len(e.raw_bytes) > max_pdf:
                not_sent.append("{}: scan not sent to Claude (over the CON_CLAUDE_MAX_PDF_MB cap)".format(e.name))
                continue
            pdf_bytes += len(e.raw_bytes)
            why = "no text layer" if e.no_text_layer else "pages {} could not be read as text".format(
                ", ".join(str(p) for p in e.unread_pages[:20]))
            blocks.append({"type": "text", "text": "=== FILE: {} (PDF scan, {}; the PDF follows) ===".format(e.name, why)})
            blocks.append({"type": "document", "source": {"type": "base64", "media_type": "application/pdf",
                                                          "data": base64.b64encode(e.raw_bytes).decode("ascii")}})
            if e.name not in sent:
                sent.append(e.name)
        elif not e.text and not is_pdf:
            not_sent.append("{}: no text to send".format(e.name))
    return blocks, sent, not_sent


# ---------------------------------------------------------------------------------------------
# API call
# ---------------------------------------------------------------------------------------------

def call(model, content, prompt, schema, post=None, sleep=time.sleep):
    """One Messages API call with a fixed JSON schema. Returns a dict:
    ok, data, model, usage {input_tokens, output_tokens}, cost_usd, seconds, stop_reason, error."""
    post = post or requests.post
    key = os.environ.get("CLAUDE_API_KEY", "").strip()
    out = {"ok": False, "data": None, "model": model, "usage": {}, "cost_usd": None, "seconds": 0,
           "stop_reason": None, "error": None}
    if not key:
        out["error"] = "CLAUDE_API_KEY is not set on con_worker"
        return out
    body = {
        "model": model,
        "max_tokens": _int_env("CON_CLAUDE_MAX_TOKENS", 48000),
        "messages": [{"role": "user", "content": list(content) + [{"type": "text", "text": prompt}]}],
        "output_config": {"format": {"type": "json_schema", "schema": schema}},
    }
    headers = {"x-api-key": key, "anthropic-version": API_VERSION, "content-type": "application/json"}
    workspace = os.environ.get("CLAUDE_WORKSPACE_ID", "").strip()
    if workspace:  # needed when the key is organization-level, not scoped to a workspace
        headers["anthropic-workspace-id"] = workspace
    timeout = (15, _int_env("CON_CLAUDE_TIMEOUT", 600))
    started = time.time()
    resp = None
    for attempt in range(3):
        try:
            resp = post(API_URL, headers=headers, data=json.dumps(body), timeout=timeout)
        except requests.RequestException as exc:
            resp = None
            out["error"] = "could not reach the Claude API: {}".format(type(exc).__name__)
        if resp is not None and resp.status_code not in RETRY_CODES:
            break
        if attempt < 2:
            wait = 5 * (2 ** attempt)
            try:
                wait = max(wait, int(resp.headers.get("retry-after", 0))) if resp is not None else wait
            except (ValueError, AttributeError):
                pass
            sleep(min(wait, 60))
    out["seconds"] = round(time.time() - started, 1)
    if resp is None:
        return out
    if resp.status_code != 200:
        out["error"] = "Claude API answered {}: {}".format(resp.status_code, _api_error(resp))
        return out
    payload = resp.json()
    usage = payload.get("usage") or {}
    out["usage"] = {"input_tokens": usage.get("input_tokens", 0), "output_tokens": usage.get("output_tokens", 0)}
    out["cost_usd"] = cost(model, out["usage"])
    out["model"] = payload.get("model", model)
    out["stop_reason"] = payload.get("stop_reason")
    if out["stop_reason"] == "max_tokens":
        out["error"] = "the answer was cut off (raise CON_CLAUDE_MAX_TOKENS)"
        return out
    if out["stop_reason"] == "refusal":
        out["error"] = "Claude declined to answer this packet"
        return out
    text = "".join(b.get("text", "") for b in payload.get("content", []) if b.get("type") == "text")
    try:
        out["data"] = json.loads(text)
    except ValueError:
        out["error"] = "the answer was not valid JSON"
        return out
    out["ok"] = True
    out["error"] = None
    return out


def _api_error(resp):
    try:
        err = resp.json().get("error") or {}
        return "{} {}".format(err.get("type", ""), err.get("message", ""))[:300].strip()
    except ValueError:
        return (resp.text or "")[:300]


def cost(model, usage):
    for prefix, pin, pout in PRICES:
        if (model or "").startswith(prefix):
            return round((usage.get("input_tokens", 0) * pin + usage.get("output_tokens", 0) * pout) / 1e6, 4)
    return None


# ---------------------------------------------------------------------------------------------
# Citations: a value without one is a proposal only
# ---------------------------------------------------------------------------------------------

def split_cited(data, sent_files):
    """Returns (cited, uncited_count). An item is cited when it names a file that was sent, a page >= 1 and a
    source sentence of at least 8 characters."""
    names = set(sent_files)
    base = {n.rsplit("/", 1)[-1] for n in names}
    cited, uncited = {}, 0
    for key in ("documents", "terms", "rate_lines", "clauses"):
        keep = []
        for item in data.get(key) or []:
            f = (item.get("file") or "").strip()
            ok = ((f in names or f.rsplit("/", 1)[-1] in base) and (item.get("page") or 0) >= 1
                  and len((item.get("source_sentence") or "").strip()) >= 8)
            if ok:
                keep.append(item)
            else:
                uncited += 1
        cited[key] = keep
    cited["conflicts"] = data.get("conflicts") or []
    cited["summary"] = data.get("summary") or ""
    return cited, uncited


# ---------------------------------------------------------------------------------------------
# Compare with the rules and with the CRM
# ---------------------------------------------------------------------------------------------

def _norm(v):
    if v is None:
        return ""
    if hasattr(v, "value"):
        v = v.value
    if isinstance(v, dict) and "value" in v:
        v = v["value"]
    s = str(v).strip()
    if s.lower() in ("", "none", "null"):
        return ""
    s = s.replace("$", "").replace(",", "")
    try:
        f = float(s)
        return ("%.4f" % f).rstrip("0").rstrip(".")
    except ValueError:
        return s.lower()


def _rule_terms(result):
    out = {}
    for k, f in (getattr(result, "terms", None) or {}).items():
        out[k] = getattr(f, "value", f)
    for k, v in (getattr(result, "pricing", None) or {}).items():
        if k in TERM_FIELDS and k not in out:
            out[k] = getattr(v, "value", v)
    return out


def _dev(s):
    """Canonical device for matching: "GPS Ankle Bracelet", "AT1 One-Piece GPS Tracking Device" -> gps;
    "CAM with Landline Base Station" -> cam landline; "SCRAM Remote Breath Pro" -> remote breath."""
    t = re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()
    if "breath" in t or re.search(r"\brb\b", t):
        return "remote breath"
    if re.search(r"\bcam\b", t) or "transdermal" in t:
        return "cam landline" if "landline" in t else "cam"
    if "gps" in t or "tracking" in t or re.search(r"\bat1\b", t):
        return "gps"
    return t


def compare(cited, result, contract):
    """Returns a dict with term rows, rate matches and counts -- the same shape goes into the Note and the
    .json attachment, so the golden-set table can be built from the attachments."""
    rules = _rule_terms(result)
    crm = contract or {}
    claude_terms = {}
    for t in cited.get("terms", []):
        claude_terms.setdefault(t["field"], t)
    term_rows = []
    for fld in TERM_FIELDS:
        c = claude_terms.get(fld)
        r = rules.get(fld)
        now = crm.get(fld)
        if c is None and r is None and now in (None, ""):
            continue
        cv, rv, nv = _norm(c["value"] if c else None), _norm(r), _norm(now)
        if cv and cv == nv:
            verdict = "matches CRM"
        elif not cv:
            verdict = "Claude did not find it"
        elif nv and cv != nv:
            verdict = "DIFFERS from CRM"
        else:
            verdict = "new (CRM empty)"
        term_rows.append({"field": fld, "claude": c["value"] if c else None, "rules": None if r is None else str(r),
                          "crm": None if now in (None, "") else str(now), "verdict": verdict,
                          "rules_agree": bool(cv) and cv == rv,
                          "cite": "{} p.{}".format(c["file"], c["page"]) if c else "",
                          "confidence": c["confidence"] if c else ""})

    # Rate lines: Claude's current per-day lines against the CRM's Rate_Lines and the rules' proposals.
    crm_rows = crm.get("Rate_Lines") or []
    rule_rows = getattr(result, "rate_rows", None) or []

    def key(dev, amt, tmin):
        return (_dev(dev), _norm(amt), int(tmin or 0))

    crm_keys = {key(r.get("Rate_Device"), r.get("Rate_Daily_Amount"), r.get("Tier_Min_Units")): r for r in crm_rows
                if (r.get("Superseded_By") or "") != "Rejected in review"}
    rule_keys = {key(getattr(r, "device", ""), getattr(r, "amount", None), getattr(r, "tier_min", None))
                 for r in rule_rows if getattr(r, "unit", "day") == "day"}
    rates = []
    for ln in cited.get("rate_lines", []):
        k = key(ln["device"], ln["amount"], ln["tier_min"])
        in_crm = crm_keys.get(k)
        rates.append({"device": ln["device"], "amount": ln["amount"], "unit": ln["unit"], "ownership": ln["ownership"],
                      "tier": _tier(ln), "current": ln["current"], "effective_date": ln["effective_date"],
                      "confidence": ln["confidence"], "cite": "{} p.{}".format(ln["file"], ln["page"]),
                      "in_crm": bool(in_crm), "crm_verified": bool(in_crm and in_crm.get("Line_Verified")),
                      "rules_found": k in rule_keys})
    claude_day = {key(x["device"], x["amount"], x["tier_min"]) for x in cited.get("rate_lines", [])
                  if x["unit"] == "day" and x["current"]}
    missed_by_claude = [r for k, r in crm_keys.items() if r.get("Line_Verified") and k not in claude_day]
    return {
        "terms": term_rows,
        "rates": rates,
        "crm_verified_lines_not_found": [{"device": r.get("Rate_Device"), "amount": r.get("Rate_Daily_Amount"),
                                          "tier_min": r.get("Tier_Min_Units")} for r in missed_by_claude],
        "documents": cited.get("documents", []),
        "clauses": [{"type": c["clause_type"], "title": c["title"], "boilerplate": c["is_boilerplate"],
                     "cite": "{} p.{}".format(c["file"], c["page"])} for c in cited.get("clauses", [])],
        "conflicts": cited.get("conflicts", []),
        "summary": cited.get("summary", ""),
    }


def _tier(ln):
    lo, hi = ln.get("tier_min"), ln.get("tier_max")
    if lo is None and hi is None:
        return ""
    return "{}-{}".format(lo or 0, hi) if hi is not None else "{}+".format(lo)


# ---------------------------------------------------------------------------------------------
# Note text
# ---------------------------------------------------------------------------------------------

def note_text(run, cmp_, uncited, not_sent, current_mode):
    lines = []
    head = "Claude read this packet ({}) -- SHADOW: nothing below was written to the record.".format(run["model"])
    if current_mode == "on":
        head += " (CON_CLAUDE = on, but write-back from Claude is not built yet, so this ran as shadow.)"
    lines.append(head)
    u = run.get("usage") or {}
    lines.append("Tokens: {} in, {} out; about ${} (estimate, the Console is the bill); {} s.".format(
        u.get("input_tokens", 0), u.get("output_tokens", 0),
        run["cost_usd"] if run["cost_usd"] is not None else "?", run["seconds"]))
    if not run["ok"]:
        lines.append("Claude run failed: {}".format(run["error"]))
        return "\n".join(lines)
    if not_sent:
        lines.append("Not sent: " + "; ".join(not_sent))
    if uncited:
        lines.append("{} item(s) had no file/page/source sentence and were dropped (a value without a citation "
                     "is never used).".format(uncited))
    if cmp_["summary"]:
        lines.append("")
        lines.append("Summary: " + cmp_["summary"])

    lines.append("")
    lines.append("Documents (as Claude ordered them; * = governs today):")
    for d in cmp_["documents"]:
        lines.append("  {}{} -- {}{}".format("* " if d["governs"] else "  ", d["file"], d["doc_type"],
                                            ", eff. " + d["effective_date"] if d["effective_date"] else ", no date"))

    lines.append("")
    lines.append("Terms (Claude | rules | CRM before this run):")
    for t in cmp_["terms"]:
        lines.append("  {}: {} | {} | {} -- {}{}{}".format(
            t["field"], t["claude"] or "-", t["rules"] or "-", t["crm"] or "-", t["verdict"],
            "; " + t["confidence"] if t["confidence"] else "", "; " + t["cite"] if t["cite"] else ""))

    lines.append("")
    lines.append("Rate lines from Claude:")
    for r in cmp_["rates"]:
        flags = []
        if r["crm_verified"]:
            flags.append("= verified CRM line")
        elif r["in_crm"]:
            flags.append("in CRM, unverified")
        if r["rules_found"]:
            flags.append("rules found it")
        lines.append("  {}{}{} ${} /{} ({}, eff. {}; {}; {}){}".format(
            "" if r["current"] else "[superseded] ", r["device"], " " + r["tier"] if r["tier"] else "", r["amount"],
            r["unit"], r["ownership"], r["effective_date"] or "?", r["confidence"], r["cite"],
            " -- " + ", ".join(flags) if flags else ""))
    if cmp_["crm_verified_lines_not_found"]:
        lines.append("  Verified CRM lines Claude did not report as current: " + "; ".join(
            "{} ${} (tier {})".format(x["device"], x["amount"], x["tier_min"] or 0)
            for x in cmp_["crm_verified_lines_not_found"]))

    lines.append("")
    real = [c for c in cmp_["clauses"] if not c["boilerplate"]]
    lines.append("Clauses: {} obligation(s), {} boilerplate.".format(len(real), len(cmp_["clauses"]) - len(real)))
    for c in real:
        lines.append("  {}: {} ({})".format(c["type"], c["title"], c["cite"]))

    if cmp_["conflicts"]:
        lines.append("")
        lines.append("Conflicts and doubts:")
        for c in cmp_["conflicts"]:
            lines.append("  {}: {} [{}]".format(c["topic"], c["detail"], ", ".join(c.get("files") or [])))
    return "\n".join(lines)


FREE_TEXT = ("Spare_Clause_Detail",)  # wording never matches exactly, so it never triggers a second read


def escalation_reasons(run, cmp_):
    """Why the review model should read this packet too (S45, 29 Oct 2026, Beau: "Haiku, then Sonnet if there are
    slips"). Haiku does not flag its own slips, and its conflicts list is non-empty on nearly every packet, so the
    trigger is a check against what the code already holds: the rules' value and the CRM's value.
    Returns a list of short reasons; empty = no second read."""
    if not run.get("ok"):
        return ["the first read failed ({})".format(run.get("error"))]
    reasons = []
    for t in (cmp_ or {}).get("terms", []):
        if t["field"] in FREE_TEXT:
            continue
        c, r, n = _norm(t["claude"]), _norm(t["rules"]), _norm(t["crm"])
        if r and not c:
            reasons.append("{}: rules found {}, model found nothing".format(t["field"], t["rules"]))
        elif r and c != r:
            reasons.append("{}: model {} vs rules {}".format(t["field"], t["claude"], t["rules"]))
        elif n and c and c != n:
            reasons.append("{}: model {} vs CRM {}".format(t["field"], t["claude"], t["crm"]))
    return reasons


# ---------------------------------------------------------------------------------------------
# Entry point used by main.py
# ---------------------------------------------------------------------------------------------

def run_shadow(entries, result, contract, counterparty_type, post_note, upload_attachment, post=None):
    """Runs every configured model over the packet and posts one Note (+ one .json attachment) per model.
    post_note(title, content) and upload_attachment(file_name, raw_bytes) are bound to the Contract by the
    caller. Returns a list of short status lines for the main summary. Never raises."""
    status = []
    try:
        current = mode()
        if current == "off":
            return status
        content, sent, not_sent = build_content(entries)
        if not content:
            post_note("Contract ingest - Claude (shadow)", "Claude was not run: no readable file in the packet.")
            return ["Claude: not run (nothing readable)"]
        prompt = load_prompt(counterparty_type, (contract or {}).get("Name"))
        schema = load_schema()
        todo = models()
        review = os.environ.get("CLAUDE_MODEL_REVIEW", "").strip()
        done = set()
        while todo:
            model = todo.pop(0)
            if model in done:
                continue
            done.add(model)
            run = call(model, content, prompt, schema, post=post)
            cited, uncited = split_cited(run["data"], sent) if run["ok"] else ({}, 0)
            cmp_ = compare(cited, result, contract) if run["ok"] else None
            text = note_text(run, cmp_, uncited, not_sent, current)
            reasons = escalation_reasons(run, cmp_)
            escalate = (os.environ.get("CON_CLAUDE_ESCALATE", "0").strip() == "1" and review and review not in done
                        and review not in todo and bool(reasons))
            if escalate:
                text = "Second read by {} because: {}.\n".format(review, "; ".join(reasons[:8])) + text
            post_note("Contract ingest - Claude ({}, shadow)".format(run["model"]), text[:30000])
            stamp = dt.datetime.utcnow().strftime("%Y%m%d-%H%M")
            record = {"model": run["model"], "mode": current, "usage": run["usage"], "cost_usd": run["cost_usd"],
                      "seconds": run["seconds"], "error": run["error"], "sent_files": sent, "not_sent": not_sent,
                      "uncited_dropped": uncited, "escalation_reasons": reasons, "comparison": cmp_, "raw": run["data"]}
            try:
                upload_attachment("claude-shadow-{}-{}.json".format(run["model"], stamp),
                                  json.dumps(record, indent=1, default=str).encode("utf-8"))
            except Exception as exc:  # noqa: BLE001 -- the Note already carries the result
                log.warning("could not attach the Claude json: %s", type(exc).__name__)
            status.append("Claude {}: {}".format(run["model"], "read, see its Note" if run["ok"] else run["error"]))
            if escalate:
                todo.append(review)
    except Exception as exc:  # noqa: BLE001 -- shadow must never break the ingest
        log.exception("claude shadow run failed")
        msg = "Claude shadow run failed: {}".format(type(exc).__name__)
        try:
            post_note("Contract ingest - Claude (shadow)", msg)
        except Exception:  # noqa: BLE001
            pass
        status.append(msg)
    return status
