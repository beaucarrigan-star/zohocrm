"""Thin Zoho CRM v7 client: token refresh, search, create."""
from __future__ import annotations

import os
import time

import requests


class ZohoError(RuntimeError):
    pass


class ZohoClient:
    def __init__(self, client_id=None, client_secret=None, refresh_token=None,
                 accounts_url=None, api_url=None, session=None):
        env = os.environ.get
        self.client_id = client_id or env("ZOHO_CLIENT_ID", "")
        self.client_secret = client_secret or env("ZOHO_CLIENT_SECRET", "")
        self.refresh_token = refresh_token or env("ZOHO_REFRESH_TOKEN", "")
        # Defaults are the US data center; set both env vars for others.
        self.accounts_url = (accounts_url or env("ZOHO_ACCOUNTS_URL", "https://accounts.zoho.com")).rstrip("/")
        self.api_url = (api_url or env("ZOHO_API_URL", "https://www.zohoapis.com")).rstrip("/")
        self.http = session or requests.Session()
        self._token = ""
        self._expires = 0.0

    # -- auth ---------------------------------------------------------
    def _access_token(self) -> str:
        if self._token and time.time() < self._expires - 60:
            return self._token
        r = self.http.post(f"{self.accounts_url}/oauth/v2/token", data={
            "grant_type": "refresh_token",
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "refresh_token": self.refresh_token,
        }, timeout=20)
        body = r.json()
        if "access_token" not in body:
            raise ZohoError(f"token refresh failed: {body.get('error', r.status_code)}")
        self._token = body["access_token"]
        self._expires = time.time() + int(body.get("expires_in", 3600))
        return self._token

    def _call(self, method, path, **kw):
        headers = {"Authorization": f"Zoho-oauthtoken {self._access_token()}"}
        r = self.http.request(method, f"{self.api_url}/crm/v7/{path}",
                              headers=headers, timeout=30, **kw)
        if r.status_code == 204:       # search with no hits
            return {}
        try:
            body = r.json()
        except ValueError:
            raise ZohoError(f"{method} {path}: HTTP {r.status_code}, not JSON")
        if r.status_code >= 400 and "data" not in body:
            raise ZohoError(f"{method} {path}: HTTP {r.status_code} {body.get('code', '')}")
        return body

    # -- reads --------------------------------------------------------
    def search(self, module: str, criteria: str, fields: str = "id") -> list[dict]:
        body = self._call("GET", f"{module}/search",
                          params={"criteria": criteria, "fields": fields, "per_page": 10})
        return body.get("data", [])

    # -- writes -------------------------------------------------------
    def create(self, module: str, record: dict) -> str:
        """Create one record and return its id. Raises on any non-success."""
        body = self._call("POST", module, json={"data": [record]})
        row = (body.get("data") or [{}])[0]
        if row.get("code") == "SUCCESS":
            return row["details"]["id"]
        raise ZohoError(f"create {module}: {row.get('code', 'UNKNOWN')} {row.get('message', '')}")

    def add_note(self, module: str, record_id: str, title: str, content: str) -> None:
        self._call("POST", "Notes", json={"data": [{
            "Note_Title": title[:120],
            "Note_Content": content[:32000],
            "Parent_Id": {"module": {"api_name": module}, "id": record_id},
        }]})
