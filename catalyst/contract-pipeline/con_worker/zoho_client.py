# zoho_client.py
# Minimal Zoho CRM REST client for the Catalyst functions (con_api, con_worker).
# Uses a self-client refresh token (same pattern as the solicitation and billing pipelines) so the
# worker can read/write CRM records and attachments without a user's browser session.
#
# Config expected in Catalyst's environment variables (Catalyst console > Deployment Configuration,
# or `catalyst config:set` locally before deploy):
#   ZOHO_CRM_DOMAIN          e.g. https://www.zohoapis.com  (or .eu / .in / .com.au)
#   ZOHO_ACCOUNTS_DOMAIN     e.g. https://accounts.zoho.com
#   ZOHO_CLIENT_ID
#   ZOHO_CLIENT_SECRET
#   ZOHO_REFRESH_TOKEN
#   CON_PIPELINE_TOKEN       shared secret the contract_pipeline_call Deluge function sends; con_api
#                            rejects any request without it (no other auth in front of the advancedio URL)

import os
import time

import requests

_token_cache = {"access_token": None, "expires_at": 0}


def _accounts_domain():
    return os.environ.get("ZOHO_ACCOUNTS_DOMAIN", "https://accounts.zoho.com")


def _crm_domain():
    return os.environ.get("ZOHO_CRM_DOMAIN", "https://www.zohoapis.com")


def _check(r):
    """raise_for_status, but keep Zoho's own error body -- a bare "400 Client Error" says nothing."""
    if r.status_code >= 400:
        raise requests.HTTPError("{} {} for {}: {}".format(
            r.status_code, r.reason, r.url.split("?")[0], (r.text or "")[:600]), response=r)


def get_access_token():
    now = time.time()
    if _token_cache["access_token"] and _token_cache["expires_at"] - 60 > now:
        return _token_cache["access_token"]

    # Secrets go in the POST body (data=), never in the URL: requests puts the URL into every
    # HTTPError message, and con_worker posts that message as a Note on the record.
    resp = requests.post(
        _accounts_domain() + "/oauth/v2/token",
        data={
            "refresh_token": os.environ["ZOHO_REFRESH_TOKEN"],
            "client_id": os.environ["ZOHO_CLIENT_ID"],
            "client_secret": os.environ["ZOHO_CLIENT_SECRET"],
            "grant_type": "refresh_token",
        },
        timeout=30,
    )
    if resp.status_code >= 400:
        raise requests.HTTPError("Zoho token refresh failed: HTTP {}".format(resp.status_code), response=resp)
    data = resp.json()
    if not data.get("access_token"):
        # Zoho answers 200 with {"error": "invalid_code"} and the like; never echo the body
        raise RuntimeError("Zoho token refresh failed: {}".format(data.get("error") or "no access_token"))
    _token_cache["access_token"] = data["access_token"]
    _token_cache["expires_at"] = now + int(data.get("expires_in", 3600))
    return _token_cache["access_token"]


def _headers():
    return {"Authorization": "Zoho-oauthtoken " + get_access_token()}


def get_record(module, record_id, fields=None):
    params = {}
    if fields:
        params["fields"] = ",".join(fields)
    r = requests.get(
        "{}/crm/v7/{}/{}".format(_crm_domain(), module, record_id),
        headers=_headers(), params=params, timeout=30,
    )
    _check(r)
    return r.json()["data"][0]


def update_record(module, record_id, data):
    r = requests.put(
        "{}/crm/v7/{}/{}".format(_crm_domain(), module, record_id),
        headers=_headers(), json={"data": [data]}, timeout=30,
    )
    _check(r)
    return r.json()


def create_record(module, data):
    r = requests.post(
        "{}/crm/v7/{}".format(_crm_domain(), module),
        headers=_headers(), json={"data": [data]}, timeout=30,
    )
    _check(r)
    return r.json()["data"][0]


def search_records(module, criteria):
    r = requests.get(
        "{}/crm/v7/{}/search".format(_crm_domain(), module),
        headers=_headers(), params={"criteria": criteria}, timeout=30,
    )
    if r.status_code == 204:
        return []
    _check(r)
    return r.json().get("data", [])


def coql(select_query):
    r = requests.post(
        "{}/crm/v7/coql".format(_crm_domain()),
        headers=_headers(), json={"select_query": select_query}, timeout=30,
    )
    if r.status_code == 204:
        return []
    _check(r)
    return r.json().get("data", [])


def list_attachments(module, record_id):
    r = requests.get(
        "{}/crm/v7/{}/{}/Attachments".format(_crm_domain(), module, record_id),
        headers=_headers(), params={"fields": "id,File_Name,Size,Created_Time"}, timeout=30,
    )  # v7 related-list GETs refuse the call (400) without an explicit fields list
    if r.status_code == 204:
        return []
    _check(r)
    return r.json().get("data", [])


def download_attachment(module, record_id, attachment_id, expected_size=None, file_name="", tries=3):
    """Download one attachment and check it arrived whole.

    26 Oct 2026: Milwaukee Co Pretrial (a 33 MB zip) failed twice with "packet.zip is not a valid zip file" although
    the same bytes pass a full zip test. The old code trusted whatever came back. Now: the byte count must equal the
    Size Zoho lists for the attachment, and a .zip must start with the "PK" signature; otherwise retry (a short wait
    between tries), and after the last try raise an error that says exactly what was received, so the Note on the
    record shows the cause instead of an empty read."""
    last = ""
    for attempt in range(1, tries + 1):
        r = requests.get(
            "{}/crm/v7/{}/{}/Attachments/{}".format(_crm_domain(), module, record_id, attachment_id),
            headers=_headers(), timeout=(15, 180),
        )
        _check(r)
        raw = r.content
        want = int(expected_size) if str(expected_size or "").isdigit() else None
        problems = []
        if want is not None and len(raw) != want:
            problems.append("got {:,} bytes, Zoho lists {:,}".format(len(raw), want))
        if file_name.lower().endswith(".zip") and raw[:2] != b"PK":
            problems.append("does not start with the zip signature (starts {!r})".format(raw[:12]))
        if not problems:
            return raw
        last = "{}; HTTP {}, content-type {}, content-length header {}".format(
            "; ".join(problems), r.status_code, r.headers.get("Content-Type"), r.headers.get("Content-Length"))
        if attempt < tries:
            time.sleep(3 * attempt)
    raise IOError("Zoho returned a damaged download of {} after {} tries: {}".format(file_name or attachment_id, tries, last))


def upload_attachment(module, record_id, file_name, raw_bytes):
    r = requests.post(
        "{}/crm/v7/{}/{}/Attachments".format(_crm_domain(), module, record_id),
        headers=_headers(), files={"file": (file_name, raw_bytes)}, timeout=60,
    )
    _check(r)
    return r.json()


def delete_attachment(module, record_id, attachment_id):
    r = requests.delete(
        "{}/crm/v7/{}/{}/Attachments/{}".format(_crm_domain(), module, record_id, attachment_id),
        headers=_headers(), timeout=30,
    )
    _check(r)
    return r.json()


def post_note(module, record_id, title, content):
    r = requests.post(
        "{}/crm/v7/{}/{}/Notes".format(_crm_domain(), module, record_id),
        headers=_headers(),
        json={"data": [{"Note_Title": title, "Note_Content": content}]},
        timeout=30,
    )
    _check(r)
    return r.json()
