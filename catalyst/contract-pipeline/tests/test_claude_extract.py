# Phase 10a (29 Oct 2026): claude_extract.py and its wiring in main.py. No network: the Messages API is faked.
import json
import os
import sys
import types

import pytest

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(HERE, "..", "con_worker"))

import claude_extract as ce  # noqa: E402

KEY = "sk-ant-TEST-never-show-this-0123456789"
CLAUDE_ENV = ("CLAUDE_WORKSPACE_ID", "CON_CLAUDE", "CON_CLAUDE_MODELS", "CON_CLAUDE_ESCALATE", "CON_CLAUDE_RERUN", "CLAUDE_API_KEY",
              "CLAUDE_MODEL_EXTRACT", "CLAUDE_MODEL_REVIEW", "CON_CLAUDE_MAX_CHARS", "CON_CLAUDE_MAX_PDF_MB")


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for k in CLAUDE_ENV:
        monkeypatch.delenv(k, raising=False)


class Entry:
    def __init__(self, name, text="", ext=".pdf", raw=b"%PDF-1.4 fake", no_text=False, unread=None, ocr=False):
        self.name, self.text, self.ext, self.raw_bytes = name, text, ext, raw
        self.no_text_layer, self.unread_pages, self.ocr_used = no_text, unread or [], ocr
        self.skip_reason = None


class Resp:
    def __init__(self, code, payload=None, headers=None):
        self.status_code, self._p, self.headers = code, payload or {}, headers or {}
        self.text = json.dumps(self._p)

    def json(self):
        return self._p


def answer(data, model="claude-sonnet-5-5", stop="end_turn", out_tokens=900):
    return Resp(200, {"model": model, "stop_reason": stop, "usage": {"input_tokens": 12000, "output_tokens": out_tokens},
                      "content": [{"type": "text", "text": json.dumps(data)}]})


GOOD = {
    "documents": [{"file": "Base.pdf", "doc_type": "Base agreement", "effective_date": "2024-01-10", "governs": True,
                   "page": 1, "source_sentence": "This Agreement is effective as of January 10, 2024."}],
    "terms": [
        {"field": "Contract_End_Date", "value": "2027-01-09", "confidence": "High", "file": "Base.pdf", "page": 2,
         "source_sentence": "The initial term ends January 9, 2027."},
        {"field": "Notice_Period_Days", "value": "30", "confidence": "High", "file": "Base.pdf", "page": 3,
         "source_sentence": "Either party may give thirty (30) days written notice."},
        {"field": "Payment_Terms_Days", "value": "45", "confidence": "Medium", "file": "Nowhere.pdf", "page": 1,
         "source_sentence": "Payment is due within 45 days."},
    ],
    "rate_lines": [
        {"device": "CAM", "amount": 6.94, "unit": "day", "ownership": "Leased", "tier_min": None, "tier_max": None,
         "effective_date": "2024-01-10", "current": True, "confidence": "High", "file": "Base.pdf", "page": 4,
         "source_sentence": "SCRAM CAM ... $6.94 per unit per day"},
        {"device": "GPS", "amount": 850.0, "unit": "replacement", "ownership": "n/a", "tier_min": None,
         "tier_max": None, "effective_date": "", "current": True, "confidence": "High", "file": "Base.pdf",
         "page": 5, "source_sentence": "Lost or damaged units are billed at $850.00"},
    ],
    "clauses": [
        {"clause_type": "Reporting", "title": "Monthly violation report", "obligation": "Send a monthly report",
         "is_boilerplate": False, "file": "Base.pdf", "page": 6,
         "source_sentence": "Provider shall submit a monthly report of all violations."},
        {"clause_type": "Staffing", "title": "Equipment and support", "obligation": "Provide equipment",
         "is_boilerplate": True, "file": "Base.pdf", "page": 1,
         "source_sentence": "JusticePoint will provide EM equipment, software, training and support."},
    ],
    "conflicts": [],
    "summary": "SCRAM master agreement, one schedule.",
}


# ---- switch and models ----

def test_mode_defaults_off_and_unknown_is_off(monkeypatch):
    assert ce.mode() == "off" and not ce.rerun_unchanged()
    monkeypatch.setenv("CON_CLAUDE", "Shadow")
    assert ce.mode() == "shadow"
    monkeypatch.setenv("CON_CLAUDE", "yes please")
    assert ce.mode() == "off"


def test_models_default_and_list(monkeypatch):
    assert ce.models() == ["claude-sonnet-5-5"]
    monkeypatch.setenv("CLAUDE_MODEL_EXTRACT", "claude-opus-5-5")
    assert ce.models() == ["claude-opus-5-5"]
    monkeypatch.setenv("CON_CLAUDE_MODELS", "claude-haiku-5-5, claude-sonnet-5-5,")
    assert ce.models() == ["claude-haiku-5-5", "claude-sonnet-5-5"]


# ---- content ----

def test_build_content_text_pages_and_scans():
    entries = [Entry("A.pdf", "first page\fsecond\x00page"), Entry("Scan.pdf", "", no_text=True),
               Entry("Mixed.pdf", "p1\fp2", unread=[2]), Entry("notes.docx", "hello", ext=".docx", raw=b"x")]
    blocks, sent, not_sent = ce.build_content(entries)
    texts = [b["text"] for b in blocks if b["type"] == "text"]
    assert "--- page 2 ---\nsecondpage" in texts[0] and "=== FILE: A.pdf (2 pages) ===" in texts[0]
    docs = [b for b in blocks if b["type"] == "document"]
    assert len(docs) == 2 and docs[0]["source"]["media_type"] == "application/pdf"
    assert sent == ["A.pdf", "Scan.pdf", "Mixed.pdf", "notes.docx"] and not not_sent


def test_build_content_caps(monkeypatch):
    monkeypatch.setenv("CON_CLAUDE_MAX_CHARS", "20")
    monkeypatch.setenv("CON_CLAUDE_MAX_PDF_MB", "0")
    blocks, sent, not_sent = ce.build_content([Entry("Long.pdf", "x" * 50), Entry("Scan.pdf", no_text=True)])
    assert blocks == [] and sent == [] and len(not_sent) == 2


def test_prompt_and_schema_load():
    p = ce.load_prompt("Vendor", "SCRAM - vendor pricing")
    assert "{counterparty_type}" not in p and "SCRAM - vendor pricing" in p and "Vendor" in p
    s = ce.load_schema()
    assert s["additionalProperties"] is False
    assert set(s["properties"]["terms"]["items"]["properties"]["field"]["enum"]) == set(ce.TERM_FIELDS)


# ---- API call ----

def test_call_success_parses_and_costs(monkeypatch):
    monkeypatch.setenv("CLAUDE_API_KEY", KEY)
    seen = {}

    def post(url, headers, data, timeout):
        seen.update(url=url, headers=headers, body=json.loads(data))
        return answer(GOOD)
    r = ce.call("claude-sonnet-5-5", [{"type": "text", "text": "x"}], "PROMPT", {"type": "object"}, post=post)
    assert r["ok"] and r["data"]["summary"].startswith("SCRAM")
    assert seen["headers"]["x-api-key"] == KEY and seen["headers"]["anthropic-version"] == "2023-06-01"
    assert seen["body"]["output_config"]["format"]["type"] == "json_schema"
    assert seen["body"]["messages"][0]["content"][-1] == {"type": "text", "text": "PROMPT"}
    assert r["cost_usd"] == round((12000 * 2 + 900 * 10) / 1e6, 4)


def test_call_retries_overload_then_succeeds(monkeypatch):
    monkeypatch.setenv("CLAUDE_API_KEY", KEY)
    replies = [Resp(529), answer(GOOD)]
    waits = []
    r = ce.call("claude-sonnet-5-5", [], "P", {}, post=lambda *a, **k: replies.pop(0), sleep=waits.append)
    assert r["ok"] and waits == [5]


def test_call_errors_never_show_the_key(monkeypatch):
    monkeypatch.setenv("CLAUDE_API_KEY", KEY)
    r = ce.call("m", [], "P", {}, post=lambda *a, **k: Resp(401, {"error": {"type": "authentication_error",
                                                                            "message": "invalid x-api-key"}}))
    assert not r["ok"] and "401" in r["error"] and KEY not in json.dumps(r)
    r = ce.call("claude-sonnet-5-5", [], "P", {}, post=lambda *a, **k: answer(GOOD, stop="max_tokens"))
    assert not r["ok"] and "cut off" in r["error"]
    r = ce.call("claude-sonnet-5-5", [], "P", {}, post=lambda *a, **k: Resp(200, {
        "stop_reason": "end_turn", "usage": {}, "content": [{"type": "text", "text": "not json"}]}))
    assert not r["ok"] and "JSON" in r["error"]


def test_call_without_key():
    r = ce.call("m", [], "P", {}, post=lambda *a, **k: pytest.fail("must not call"))
    assert not r["ok"] and "CLAUDE_API_KEY" in r["error"]


# ---- citations and comparison ----

def test_uncited_values_are_dropped():
    cited, uncited = ce.split_cited(GOOD, ["Base.pdf"])
    assert uncited == 1  # Payment_Terms_Days names a file that was not in the packet
    assert [t["field"] for t in cited["terms"]] == ["Contract_End_Date", "Notice_Period_Days"]


class Finding:
    def __init__(self, v):
        self.value = v


class RP:
    def __init__(self, device, amount, unit="day", tier_min=None):
        self.device, self.amount, self.unit, self.tier_min = device, amount, unit, tier_min


def test_compare_three_way():
    cited, _ = ce.split_cited(GOOD, ["Base.pdf"])
    result = types.SimpleNamespace(terms={"Contract_End_Date": Finding("2027-01-09"), "Notice_Period_Days": Finding(60)},
                                   pricing={}, rate_rows=[RP("CAM", 6.94)])
    contract = {"Contract_End_Date": "2026-01-09", "Notice_Period_Days": 30,
                "Rate_Lines": [{"Rate_Device": "CAM", "Rate_Daily_Amount": 6.94, "Line_Verified": True},
                               {"Rate_Device": "CAM Landline", "Rate_Daily_Amount": 6.27, "Line_Verified": True}]}
    c = ce.compare(cited, result, contract)
    t = {r["field"]: r for r in c["terms"]}
    assert t["Contract_End_Date"]["verdict"] == "DIFFERS from CRM" and t["Contract_End_Date"]["rules_agree"]
    assert t["Notice_Period_Days"]["verdict"] == "matches CRM" and not t["Notice_Period_Days"]["rules_agree"]
    cam = next(r for r in c["rates"] if r["device"] == "CAM")
    assert cam["crm_verified"] and cam["rules_found"]
    assert c["crm_verified_lines_not_found"] == [{"device": "CAM Landline", "amount": 6.27, "tier_min": None}]
    text = ce.note_text({"model": "claude-sonnet-5-5", "ok": True, "usage": {"input_tokens": 1, "output_tokens": 2},
                         "cost_usd": 0.01, "seconds": 3, "error": None}, c, 1, [], "shadow")
    assert "SHADOW" in text and "1 obligation(s), 1 boilerplate" in text and "Monthly violation report" in text
    assert "GPS $850.0 /replacement" in text


def _cmp(**rows):
    return {"terms": [dict(field=k, claude=v[0], rules=v[1], crm=v[2]) for k, v in rows.items()]}


def test_escalation_reasons():
    ok = {"ok": True}
    assert ce.escalation_reasons(ok, _cmp(Notice_Period_Days=("90", "90", None), Contract_End_Date=("2026-04-30", "2026-04-30", "2026-04-30"))) == []
    assert ce.escalation_reasons(ok, _cmp(Spare_Clause_Detail=("a", "b", "c"))) == []          # free text never triggers
    r = ce.escalation_reasons(ok, _cmp(Notice_Period_Days=(None, "90", "90")))
    assert r == ["Notice_Period_Days: rules found 90, model found nothing"]                    # Haiku on Muscatine
    r = ce.escalation_reasons(ok, _cmp(Payment_Terms_Days=("45", "30", "30")))
    assert r == ["Payment_Terms_Days: model 45 vs rules 30"]                                   # Haiku on SCRAM
    r = ce.escalation_reasons(ok, _cmp(Contract_End_Date=("2025-12-31", None, "2023-03-25")))
    assert r == ["Contract_End_Date: model 2025-12-31 vs CRM 2023-03-25"]                      # Vernon
    assert ce.escalation_reasons({"ok": False, "error": "cut off"}, None) == ["the first read failed (cut off)"]


# ---- run_shadow ----

def _run(monkeypatch, replies, **env):
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    notes, files, calls = [], [], []

    def post(url, headers, data, timeout):
        calls.append(json.loads(data)["model"])
        return replies.pop(0)
    result = types.SimpleNamespace(terms={}, pricing={}, rate_rows=[])
    status = ce.run_shadow([Entry("Base.pdf", "text")], result, {"Name": "X"}, "Vendor",
                           lambda t, c: notes.append((t, c)), lambda n, b: files.append((n, b)), post=post)
    return notes, files, calls, status


def test_run_shadow_off_does_nothing(monkeypatch):
    notes, files, calls, status = _run(monkeypatch, [])
    assert notes == files == calls == status == []


def test_run_shadow_posts_note_and_json(monkeypatch):
    notes, files, calls, status = _run(monkeypatch, [answer(GOOD)], CON_CLAUDE="shadow", CLAUDE_API_KEY=KEY)
    assert calls == ["claude-sonnet-5-5"] and len(notes) == 1 and len(files) == 1
    assert notes[0][0] == "Contract ingest - Claude (claude-sonnet-5-5, shadow)"
    name, raw = files[0]
    assert name.startswith("claude-shadow-claude-sonnet-5-5-") and name.endswith(".json")
    rec = json.loads(raw)
    assert rec["comparison"]["summary"].startswith("SCRAM") and rec["uncited_dropped"] == 1
    assert KEY not in notes[0][1] and KEY not in raw.decode()


def test_run_shadow_on_says_not_built(monkeypatch):
    notes, _, _, _ = _run(monkeypatch, [answer(GOOD)], CON_CLAUDE="on", CLAUDE_API_KEY=KEY)
    assert "write-back from Claude is not built yet" in notes[0][1]


def test_run_shadow_models_list_and_escalation(monkeypatch):
    # rules found Notice 90 but the first model did not -> the review model reads it too
    result = types.SimpleNamespace(terms={"Notice_Period_Days": Finding(90)}, pricing={}, rate_rows=[])
    notes, files, calls = [], [], []

    def post(url, headers, data, timeout):
        calls.append(json.loads(data)["model"])
        return answer(GOOD if len(calls) == 1 else GOOD)
    for k, v in dict(CON_CLAUDE="shadow", CLAUDE_API_KEY=KEY, CON_CLAUDE_ESCALATE="1",
                     CLAUDE_MODEL_EXTRACT="claude-haiku-5-5", CLAUDE_MODEL_REVIEW="claude-sonnet-5-5").items():
        monkeypatch.setenv(k, v)
    good_no_notice = dict(GOOD, terms=[t for t in GOOD["terms"] if t["field"] != "Notice_Period_Days"])
    replies = [answer(good_no_notice), answer(GOOD)]
    post2 = lambda url, headers, data, timeout: calls.append(json.loads(data)["model"]) or replies.pop(0)
    ce.run_shadow([Entry("Base.pdf", "t")], result, {}, "Vendor", lambda t, c: notes.append((t, c)),
                  lambda n, b: files.append((n, b)), post=post2)
    assert calls == ["claude-haiku-5-5", "claude-sonnet-5-5"] and len(notes) == 2
    assert notes[0][1].startswith("Second read by claude-sonnet-5-5 because: Notice_Period_Days: rules found 90")
    assert json.loads(files[0][1])["escalation_reasons"]
    # agreement -> one read only
    calls.clear(); notes.clear()
    replies = [answer(GOOD)]
    post3 = lambda url, headers, data, timeout: calls.append(json.loads(data)["model"]) or replies.pop(0)
    agree = types.SimpleNamespace(terms={"Notice_Period_Days": Finding(30)}, pricing={}, rate_rows=[])
    ce.run_shadow([Entry("Base.pdf", "t")], agree, {}, "Vendor", lambda t, c: notes.append((t, c)),
                  lambda n, b: None, post=post3)
    assert calls == ["claude-haiku-5-5"] and not notes[0][1].startswith("Second read")
    # golden-set list mode still runs every model
    calls.clear()
    monkeypatch.setenv("CON_CLAUDE_ESCALATE", "0")
    monkeypatch.setenv("CON_CLAUDE_MODELS", "claude-haiku-5-5,claude-sonnet-5-5,claude-opus-5-5")
    replies = [answer(GOOD) for _ in range(3)]
    ce.run_shadow([Entry("Base.pdf", "t")], result, {}, "Vendor", lambda t, c: None, lambda n, b: None,
                  post=lambda url, headers, data, timeout: calls.append(json.loads(data)["model"]) or replies.pop(0))
    assert calls == ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"]


def test_run_shadow_never_raises(monkeypatch):
    monkeypatch.setenv("CON_CLAUDE", "shadow")
    monkeypatch.setattr(ce, "load_schema", lambda: (_ for _ in ()).throw(OSError("disk")))
    notes = []
    status = ce.run_shadow([Entry("Base.pdf", "t")], None, {}, "Vendor", lambda t, c: notes.append(c),
                           lambda n, b: None)
    assert status == ["Claude shadow run failed: OSError"] and notes == ["Claude shadow run failed: OSError"]


def test_failed_call_still_posts_a_note(monkeypatch):
    notes, files, _, status = _run(monkeypatch, [Resp(400, {"error": {"type": "invalid_request_error",
                                                                       "message": "bad schema"}})],
                                   CON_CLAUDE="shadow", CLAUDE_API_KEY=KEY)
    assert "Claude run failed: Claude API answered 400" in notes[0][1] and "bad schema" in notes[0][1]
    assert json.loads(files[0][1])["error"].startswith("Claude API answered 400")


# ---- main.py wiring (fake Zoho, real PDFs) ----

def test_worker_shadow_and_rerun(monkeypatch):
    pytest.importorskip("reportlab")
    pytest.importorskip("pdfplumber")
    import main
    from test_worker_e2e import FakeZoho, _zip
    from test_golden_3b_3c import EXISTING_SCRAM

    class Fake(FakeZoho):
        def __init__(self, *a):
            super().__init__(*a)
            self.uploads, self.titles = [], []

        def post_note(self, module, rid, title, content):
            self.titles.append(title)
            super().post_note(module, rid, title, content)

        def upload_attachment(self, module, rid, name, raw):
            self.uploads.append(name)

    contract = {"id": "c2", "Name": "SCRAM - vendor pricing", "Counterparty_Type": "Vendor", "Account": None,
                "Ingest_Status": None, "Rate_Lines": [dict(r) for r in EXISTING_SCRAM]}
    fake = Fake(contract, _zip([("Justice Point_Master SP Agreement_Expires 20270109.pdf", "ams_master")]))
    monkeypatch.setattr(main, "zc", fake)
    calls = []
    monkeypatch.setattr(ce.requests, "post", lambda *a, **k: calls.append(1) or answer(GOOD))

    main._ingest_contract("c2")                    # CON_CLAUDE unset: exactly the old behaviour
    assert calls == [] and fake.uploads == [] and fake.titles == ["Contract ingest"]

    monkeypatch.setenv("CON_CLAUDE", "shadow")
    monkeypatch.setenv("CLAUDE_API_KEY", KEY)
    main._ingest_contract("c2")                    # same packet, rerun off: short-circuit, no Claude
    assert calls == [] and "already read earlier" in fake.notes[-1]

    n_updates = len(fake.updates)
    monkeypatch.setenv("CON_CLAUDE_RERUN", "1")
    main._ingest_contract("c2")                    # same packet, rerun on: Claude reads, nothing else written
    assert calls == [1] and len(fake.updates) == n_updates
    assert fake.titles[-1] == "Contract ingest - Claude (claude-sonnet-5-5, shadow)" and len(fake.uploads) == 1

    contract["Packet_Hash"] = "changed"            # changed packet: rules write, then Claude runs once
    main._ingest_contract("c2")
    assert calls == [1, 1] and len(fake.updates) > n_updates and len(fake.uploads) == 2


def test_workspace_header_only_when_set(monkeypatch):
    monkeypatch.setenv("CLAUDE_API_KEY", KEY)
    seen = []
    post = lambda url, headers, data, timeout: seen.append(dict(headers)) or answer(GOOD)
    ce.call("claude-sonnet-5-5", [], "P", {}, post=post)
    monkeypatch.setenv("CLAUDE_WORKSPACE_ID", "wrkspc_test")
    ce.call("claude-sonnet-5-5", [], "P", {}, post=post)
    assert "anthropic-workspace-id" not in seen[0] and seen[1]["anthropic-workspace-id"] == "wrkspc_test"


def test_device_matching_is_canonical():
    assert ce._dev("GPS Ankle Bracelet") == ce._dev("GPS") == ce._dev("AT1 One-Piece GPS Tracking Device") == "gps"
    assert ce._dev("CAM with Landline Base Station") == "cam landline" and ce._dev("SCRAM CAM Wireless") == "cam"
    assert ce._dev("SCRAM Remote Breath Pro") == ce._dev("RB") == "remote breath"


def test_unchanged_packet_is_not_read(monkeypatch):
    pytest.importorskip("reportlab")
    pytest.importorskip("pdfplumber")
    import main
    from test_worker_e2e import FakeZoho, _zip
    contract = {"id": "c3", "Name": "X", "Counterparty_Type": "Vendor", "Account": None, "Ingest_Status": None,
                "Rate_Lines": []}
    fake = FakeZoho(contract, _zip([("Justice Point_Master SP Agreement_Expires 20270109.pdf", "ams_master")]))
    monkeypatch.setattr(main, "zc", fake)
    main._ingest_contract("c3")
    reads = []
    real = main.read_packet
    monkeypatch.setattr(main, "read_packet", lambda b, **k: reads.append(k) or real(b, **k))
    main._ingest_contract("c3")                     # unchanged, Claude off: no read at all
    assert reads == [] and "already read earlier" in fake.notes[-1]
    monkeypatch.setenv("CON_CLAUDE", "shadow")
    monkeypatch.setenv("CON_CLAUDE_RERUN", "1")
    monkeypatch.setattr(main, "_claude_shadow", lambda *a: [])
    main._ingest_contract("c3")                     # unchanged, rerun on: read once, OCR off
    assert reads == [{"ocr_pages": 0}]
