# col_parse -- Advanced I/O function (python_3_9), deployed into the existing contract-pipeline Catalyst
# project (id 31190000000040038) as its own function; it touches nothing else there.
#
# Stateless: it never talks to Zoho CRM and holds no Zoho credentials. The Deluge helper
# collections_parse_report downloads the PDF attached to a Collections Report record, POSTs it here, and
# writes the CRM records itself from the JSON this returns.
#
# Routes (base path /server/col_parse/):
#   GET  /health -> "collections report parser 1.0.0"
#   POST /parse  -> multipart form, file field "file" (or a raw application/pdf body).
#                   Header X-Col-Token must equal COL_PARSE_TOKEN.
#                   200 {"status":"ok", "report_date", "customers":[...], "warnings":[...], ...}
#                   422 if the PDF has no text layer or is not a collections report.

import hmac
import logging
import os

from flask import jsonify, make_response

import report_parser

VERSION = "1.0.0"
log = logging.getLogger()


def _reply(code, **body):
    return make_response(jsonify(body), code)


def handler(request):
    tail = (request.path or "/").rstrip("/").rsplit("/", 1)[-1]
    if tail in ("", "col_parse", "health") and request.method == "GET":
        return make_response("collections report parser " + VERSION, 200)
    if tail != "parse" or request.method != "POST":
        return _reply(404, status="error", message="not found")

    expected = os.environ.get("COL_PARSE_TOKEN", "").strip()
    got = (request.headers.get("X-Col-Token") or "").strip()
    if not expected or not hmac.compare_digest(expected, got):
        reason = ("COL_PARSE_TOKEN is not set on col_parse" if not expected else
                  "no X-Col-Token header reached col_parse" if not got else
                  "token mismatch (expected {} chars, got {})".format(len(expected), len(got)))
        return _reply(401, status="error", message="unauthorized: " + reason)

    data = None
    if request.files:
        f = request.files.get("file") or next(iter(request.files.values()))
        data = f.read()
    if not data:
        data = request.get_data()
    if not data or not data[:5].startswith(b"%PDF"):
        return _reply(400, status="error", message="send the report PDF as multipart field 'file'")
    try:
        result = report_parser.parse_pdf(data)
    except ValueError as e:
        return _reply(422, status="error", message=str(e))
    except Exception as e:  # noqa: BLE001
        log.exception("parse failed")
        return _reply(500, status="error", message="could not read the PDF: " + str(e)[:400])
    if result["customer_count"] == 0:
        return _reply(422, status="error", message="No 'Total for ...' customer blocks found - is this the "
                      "Collections Report (with contact)?", warnings=result["warnings"])
    result["status"] = "ok"
    result["parser_version"] = VERSION
    return _reply(200, **result)
