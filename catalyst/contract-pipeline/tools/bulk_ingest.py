"""Bulk contract ingest -- run on Beau's PC from the "EM contracts\\_ingest" folder.

Reads manifest.csv (one row per file, already matched to a Contract or an Account), builds one zip per
packet, attaches it to the record in Zoho, and asks con_api to ingest it -- exactly what pressing
"Ingest Contract Packet" / "New Contract from Packet" does, just for all packets in a row.

    python bulk_ingest.py              # dry run: shows what would happen, touches nothing
    python bulk_ingest.py --pilot 3    # really do the first 3 packets, then stop
    python bulk_ingest.py --go         # do everything not already done (safe to re-run)

Credentials come from the same files the pipeline already uses:
    %USERPROFILE%\\.solpipe.env   ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN (+ optional domains)
    %USERPROFILE%\\.conpipe.env   CON_PIPELINE_TOKEN
Scanned files use the OCR'd copy in _ingest\\ocr\\ when there is one.
Progress is kept in _ingest\\bulk_state.json, so a stopped run picks up where it left off.
Only rows whose decision is "attach to Contract" or "new Contract on Account" are sent; SKIP / HOLD /
EXCLUDE / UNMATCHED rows are left alone. Change a row in manifest.csv to change what happens to it.
"""
import argparse, csv, io, json, os, sys, time, zipfile
import urllib.request, urllib.parse, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.dirname(HERE)                      # the "EM contracts" folder
OCR = os.path.join(HERE, "ocr")
STATE = os.path.join(HERE, "bulk_state.json")
CON_API = "https://contract-pipeline-911327312.development.catalystserverless.com/server/con_api/ingest"
SEND = {"attach to Contract": ("Contracts", "ingest_contract"),
        "new Contract on Account": ("Accounts", "new_contract_from_packet")}
WAIT_SECONDS = 600       # max wait for one packet's worker to finish before moving on
POLL = 20


def read_env(path):
    env = {}
    if os.path.exists(path):
        for line in open(path, encoding="utf-8-sig"):
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env


home = os.path.expanduser("~")
ENV = read_env(os.path.join(home, ".solpipe.env"))
ENV.update(read_env(os.path.join(home, ".conpipe.env")))
ACCOUNTS = ENV.get("ZOHO_ACCOUNTS_URL") or "https://accounts.zoho.com"
API = ENV.get("ZOHO_API_DOMAIN") or "https://www.zohoapis.com"
_token = {"v": None, "t": 0}


def http(method, url, data=None, headers=None, timeout=120):
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def access_token():
    if _token["v"] and time.time() - _token["t"] < 3000:
        return _token["v"]
    body = urllib.parse.urlencode({"refresh_token": ENV["ZOHO_REFRESH_TOKEN"], "client_id": ENV["ZOHO_CLIENT_ID"],
                                   "client_secret": ENV["ZOHO_CLIENT_SECRET"], "grant_type": "refresh_token"}).encode()
    code, raw = http("POST", ACCOUNTS + "/oauth/v2/token", body)
    tok = json.loads(raw).get("access_token")
    if not tok:
        sys.exit("Could not get a Zoho access token: {} {}".format(code, raw[:300]))
    _token.update(v=tok, t=time.time())
    return tok


def zoho(method, path, data=None, headers=None):
    # 29 Oct 2026: the pipeline's workers use the same Self Client, and each job mints its own access token.
    # Zoho caps live tokens per refresh token and drops the oldest, so this script's cached token can die
    # mid-run (INVALID_TOKEN 401 -- what stopped the 28 Sep run). On a 401: get a fresh token, retry once.
    for attempt in (1, 2):
        h = {"Authorization": "Zoho-oauthtoken " + access_token()}
        h.update(headers or {})
        code, raw = http(method, API + "/crm/v8/" + path, data, h)
        if code == 401 and attempt == 1:
            _token.update(v=None, t=0)
            continue
        break
    return code, (json.loads(raw) if raw and raw[:1] in (b"{", b"[") else raw)


def get_record(module, rid, fields):
    code, js = zoho("GET", "{}/{}?fields={}".format(module, rid, ",".join(fields)))
    return (js.get("data") or [{}])[0] if code == 200 else {}


def list_zips(module, rid):
    code, js = zoho("GET", "{}/{}/Attachments?fields=id,File_Name".format(module, rid))
    return [a for a in (js.get("data") or [])] if code == 200 and isinstance(js, dict) else []


def upload(module, rid, name, raw):
    boundary = "----bulkingest{}".format(int(time.time() * 1000))
    body = (("--{}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{}\"\r\n"
             "Content-Type: application/zip\r\n\r\n").format(boundary, name).encode() + raw +
            "\r\n--{}--\r\n".format(boundary).encode())
    return zoho("POST", "{}/{}/Attachments".format(module, rid), body,
                {"Content-Type": "multipart/form-data; boundary=" + boundary})


def call_con_api(module, rid, action):
    body = json.dumps({"module": module, "recordId": rid, "action": action}).encode()
    return http("POST", CON_API, body, {"Content-Type": "application/json", "X-Con-Token": ENV["CON_PIPELINE_TOKEN"]})


def safe(name):
    return "".join(c if c.isalnum() or c in " ._-()" else "_" for c in name).strip()[:90]


def build_zip(rows):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for r in rows:
            ocr = os.path.join(OCR, r["file"])
            path = ocr if (r["scanned"] and os.path.exists(ocr) and os.path.getsize(ocr) > 0) else os.path.join(SRC, r["file"])
            zi = zipfile.ZipInfo(r["clean"], date_time=time.localtime(os.stat(os.path.join(SRC, r["file"])).st_mtime)[:6])
            zi.compress_type = zipfile.ZIP_DEFLATED
            zf.writestr(zi, open(path, "rb").read())
    return buf.getvalue()


def coql(q):
    code, js = zoho("POST", "coql", json.dumps({"select_query": q}).encode(), {"Content-Type": "application/json"})
    return (js.get("data") or []) if code == 200 and isinstance(js, dict) else []


def account_contract_ids(account_id):
    return {c["id"] for c in coql("select id from Contracts where Account = '{}' limit 200".format(account_id))}


def wait_done(module, rid, action, before):
    """Poll until the worker has written its result (Ingested_On moves), or a new Contract appears."""
    t0 = time.time()
    while time.time() - t0 < WAIT_SECONDS:
        time.sleep(POLL)
        if action == "ingest_contract":
            rec = get_record("Contracts", rid, ["Ingest_Status", "Ingested_On"])
            if rec.get("Ingested_On") and rec.get("Ingested_On") != before:
                return rec.get("Ingest_Status") or "?"
        else:
            for c in coql("select id, Ingest_Status, Ingested_On from Contracts where Account = '{}' limit 200".format(rid)):
                if c["id"] not in before and c.get("Ingested_On"):
                    return "{} (new Contract {})".format(c.get("Ingest_Status"), c["id"])
    return "still running after {} min -- check the record".format(WAIT_SECONDS // 60)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--go", action="store_true")
    ap.add_argument("--pilot", type=int, default=0)
    a = ap.parse_args()
    live = a.go or a.pilot > 0

    rows = [r for r in csv.DictReader(open(os.path.join(HERE, "manifest.csv"), encoding="utf-8-sig"))
            if r["decision"] in SEND and r["record_id"]]
    packets = {}
    for r in rows:
        packets.setdefault((r["decision"], r["record_id"]), []).append(r)
    state = json.load(open(STATE)) if os.path.exists(STATE) else {}
    todo = [(k, v) for k, v in packets.items() if state.get(k[1], {}).get("status") != "done"]
    print("{} packets from {} files; {} already done; {} to go.".format(len(packets), len(rows), len(packets) - len(todo), len(todo)))
    if a.pilot:
        todo = todo[:a.pilot]
    if live:
        for need in ("ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN", "CON_PIPELINE_TOKEN"):
            if not ENV.get(need):
                sys.exit("Missing {} in ~/.solpipe.env or ~/.conpipe.env".format(need))

    for i, ((decision, rid), files) in enumerate(todo, 1):
        module, action = SEND[decision]
        name = files[0]["record_name"]
        missing = [f["clean"] for f in files if f["scanned"] and not os.path.exists(os.path.join(OCR, f["file"]))]
        print("\n[{}/{}] {} -> {} {} ({} file{})".format(i, len(todo), name, module, rid, len(files), "s" * (len(files) != 1)))
        for f in files:
            print("     - {}{}".format(f["clean"], "  [OCR copy]" if f["scanned"] and f["clean"] not in missing else
                                       "  [SCAN, no OCR copy -- worker will skip it]" if f["scanned"] else ""))
        if not live:
            continue
        zname = safe(name) + " - contract packet.zip"
        raw = build_zip(files)
        existing = [z for z in list_zips(module, rid) if z.get("File_Name", "").lower().endswith(".zip")]
        if existing and module == "Contracts":
            # the worker reads the FIRST zip on a Contract -- do not stack a second one on top of an old packet
            print("     ! Contract already has a zip attached ({}) -- skipped; merge by hand".format(existing[0]["File_Name"]))
            state[rid] = {"status": "skipped", "why": "zip already attached"}
            json.dump(state, open(STATE, "w"), indent=1)
            continue
        before = (get_record("Contracts", rid, ["Ingested_On"]).get("Ingested_On") if module == "Contracts"
                  else account_contract_ids(rid))
        code, js = upload(module, rid, zname, raw)
        if code not in (200, 201):
            print("     ! upload failed {}: {}".format(code, str(js)[:300]))
            state[rid] = {"status": "failed", "why": "upload {}".format(code)}
            json.dump(state, open(STATE, "w"), indent=1)
            continue
        code, resp = call_con_api(module, rid, action)
        if code != 202:
            print("     ! con_api {}: {}".format(code, resp[:300]))
            state[rid] = {"status": "failed", "why": "con_api {}".format(code)}
            json.dump(state, open(STATE, "w"), indent=1)
            continue
        print("     queued ({:.1f} MB); waiting for the worker...".format(len(raw) / 1e6))
        result = wait_done(module, rid, action, before)
        print("     -> " + result)
        state[rid] = {"status": "done" if "still running" not in result else "check", "result": result,
                      "name": name, "files": len(files), "at": time.strftime("%Y-%m-%d %H:%M")}
        json.dump(state, open(STATE, "w"), indent=1)

    if not live:
        print("\nDry run only. Re-run with --pilot 3 to do the first three for real.")


if __name__ == "__main__":
    main()
