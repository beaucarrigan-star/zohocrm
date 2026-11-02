import base64, io, json, os, sys
from datetime import datetime
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "ship_parse"))
os.environ["SHIP_PARSE_TOKEN"] = "tok"
from flask import Flask, request
import main
from test_parser import book, ADAMS

app = Flask(__name__)
app.add_url_rule("/<path:p>", "h", lambda p: main.handler(request), methods=["GET", "POST"])
c = app.test_client()
SHIP = [(datetime(2026, 10, 8), "Justice Point - Adams County HHS", "253371", "252953", "t", ADAMS)]


def test_health_auth_parse():
    assert c.get("/server/ship_parse/health").status_code == 200
    assert c.post("/server/ship_parse/parse", data=book(SHIP), headers={}).status_code == 401
    r = c.post("/server/ship_parse/parse", data=json.dumps({"file_b64": base64.b64encode(book(SHIP)).decode()}),
               content_type="application/json", headers={"X-Ship-Token": "tok"})
    assert r.status_code == 200 and r.get_json()["rows"][0]["row_key"] == "252953"
    assert c.post("/server/ship_parse/parse", data=b"notzip", headers={"X-Ship-Token": "tok"}).status_code == 400


def test_file_url(monkeypatch):
    import io as _io
    class R:
        def __init__(self, b): self.b = b
        def __enter__(self): return self
        def __exit__(self, *a): pass
        def read(self): return self.b
    monkeypatch.setattr(main.urllib.request, "urlopen", lambda url, timeout=60: R(book(SHIP)))
    r = c.post("/server/ship_parse/parse", data=json.dumps({"file_url": "https://x/y"}),
               content_type="application/json", headers={"X-Ship-Token": "tok"})
    assert r.status_code == 200 and r.get_json()["shipments"] == 1
    assert c.post("/server/ship_parse/parse", data=json.dumps({"file_url": "http://x"}),
                  content_type="application/json", headers={"X-Ship-Token": "tok"}).status_code == 400
