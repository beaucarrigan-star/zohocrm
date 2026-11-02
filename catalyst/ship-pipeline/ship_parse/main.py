# ship_parse -- Advanced I/O function (python_3_9), deployed into the contract-pipeline Catalyst project
# (id 31190000000040038) as its own function, same pattern as scram_parse / col_parse.
#
# Stateless: never talks to Zoho CRM. The Deluge function equipment_shipped_import pulls the "Equipment Shipped*.xlsx"
# attachments Beau emails himself into the Equipment Shipped folder, POSTs each here, and upserts Accessory_Shipments
# rows from the JSON this returns.
#
# Routes (base path /server/ship_parse/):
#   GET  /health -> "equipment shipped parser 1.0.0"
#   POST /parse  -> multipart field "file", a raw .xlsx body, JSON {"file_b64": "<base64 of the .xlsx>"}, or JSON
#                   {"file_url": "<OneDrive @microsoft.graph.downloadUrl>"} (what the Deluge import sends: Graph's
#                   pre-authenticated download link, fetched here so Deluge never has to hold the binary).
#                   Header X-Ship-Token must equal SHIP_PARSE_TOKEN.
#                   200 {"status":"ok","rows":[{row_key,name,allied_customer,ship_date,...}],"warnings":[...],"shipments":n}
#                   422 if the file is not an Equipment Shipped report; an empty report returns ok with rows [].

import base64
import binascii
import hmac
import logging
import os
import urllib.request

from flask import jsonify, make_response

import shipped_parser

VERSION = "1.0.1"
log = logging.getLogger()


def _reply(code, **body):
    return make_response(jsonify(body), code)


def handler(request):
    tail = (request.path or "/").rstrip("/").rsplit("/", 1)[-1]
    if tail in ("", "ship_parse", "health") and request.method == "GET":
        return make_response("equipment shipped parser " + VERSION, 200)
    if tail != "parse" or request.method != "POST":
        return _reply(404, status="error", message="not found")

    expected = os.environ.get("SHIP_PARSE_TOKEN", "").strip()
    got = (request.headers.get("X-Ship-Token") or "").strip()
    if not expected or not hmac.compare_digest(expected, got):
        reason = ("SHIP_PARSE_TOKEN is not set on ship_parse" if not expected else
                  "no X-Ship-Token header reached ship_parse" if not got else "token mismatch")
        return _reply(401, status="error", message="unauthorized: " + reason)

    data = None
    if request.files:
        f = request.files.get("file") or next(iter(request.files.values()))
        data = f.read()
    if not data:
        data = request.get_data()
    if data and data[:1] == b"{":
        body = request.get_json(force=True, silent=True) or {}
        if body.get("file_url"):                     # OneDrive @microsoft.graph.downloadUrl (pre-authenticated, short-lived)
            url = str(body["file_url"])
            if not url.startswith("https://"):
                return _reply(400, status="error", message="file_url must be https")
            try:
                with urllib.request.urlopen(url, timeout=60) as r:
                    data = r.read()
            except Exception as e:  # noqa: BLE001
                return _reply(502, status="error", message="could not download file_url: " + str(e)[:200])
        else:
            try:
                data = base64.b64decode(body.get("file_b64", ""), validate=False)
            except (binascii.Error, ValueError):
                data = b""
    if not data or not data[:2] == b"PK":
        return _reply(400, status="error", message="send the Equipment Shipped .xlsx as multipart field 'file'")
    try:
        result = shipped_parser.parse_xlsx(data)
    except ValueError as e:
        return _reply(422, status="error", message=str(e))
    except Exception as e:  # noqa: BLE001
        log.exception("parse failed")
        return _reply(500, status="error", message="could not read the workbook: " + str(e)[:400])
    # An empty per-contract report (header, no shipments) is normal: report it as ok with zero rows.
    result["status"] = "ok"
    result["parser_version"] = VERSION
    return _reply(200, **result)
