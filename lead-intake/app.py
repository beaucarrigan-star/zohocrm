"""HTTP entry point (Flask, which Catalyst Advanced I/O functions can run).

POST /lead         JSON body from a web form or manual entry
POST /leads/csv    CSV text in the body (or multipart field "file")
POST /leads/email  raw email text in the body
Add ?dry_run=1 to any of them to see what would happen without writing to Zoho.
Every request needs the header  X-Intake-Key: <INTAKE_API_KEY>.
"""
from __future__ import annotations

import hmac
import os

from flask import Flask, jsonify, request

from lead_intake import adapters
from lead_intake.pipeline import process
from lead_intake.zoho import ZohoClient

app = Flask(__name__)
_zoho = None


def zoho() -> ZohoClient:
    global _zoho
    if _zoho is None:
        _zoho = ZohoClient()
    return _zoho


@app.before_request
def check_key():
    expected = os.environ.get("INTAKE_API_KEY", "")
    sent = request.headers.get("X-Intake-Key", "")
    if not expected or not hmac.compare_digest(expected, sent):
        return jsonify(error="unauthorized"), 401


def _dry() -> bool:
    return request.args.get("dry_run", "").lower() in ("1", "true", "yes")


@app.post("/lead")
def lead():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify(error="expected a JSON object"), 400
    return jsonify(process(adapters.from_form(payload), zoho(), _dry()).as_dict())


@app.post("/leads/csv")
def leads_csv():
    if "file" in request.files:
        text = request.files["file"].read().decode("utf-8-sig", errors="replace")
    else:
        text = request.get_data(as_text=True)
    rows = []
    for row_no, lead_obj in adapters.from_csv(text):
        out = process(lead_obj, zoho(), _dry()).as_dict()
        out["row"] = row_no
        rows.append(out)
    counts: dict = {}
    for r in rows:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    return jsonify(summary=counts, rows=rows)


@app.post("/leads/email")
def leads_email():
    raw = request.get_data(as_text=True)
    return jsonify(process(adapters.from_email(raw), zoho(), _dry()).as_dict())


if __name__ == "__main__":
    app.run(port=int(os.environ.get("PORT", "9000")))
