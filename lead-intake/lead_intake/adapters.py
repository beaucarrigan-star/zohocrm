"""Each input channel turns its raw data into Lead objects."""
from __future__ import annotations

import csv
import io
import re
from email import message_from_string, policy

from .normalize import Lead, build_lead, clean, normalize_email

# Column header -> Lead field. Headers are lowercased, punctuation stripped.
CSV_ALIASES = {
    "first_name": ["first name", "firstname", "first", "given name"],
    "last_name": ["last name", "lastname", "last", "surname", "family name"],
    "full_name": ["name", "full name", "contact", "contact name"],
    "email": ["email", "e-mail", "email address", "work email"],
    "phone": ["phone", "phone number", "telephone", "mobile", "cell"],
    "title": ["title", "job title", "position", "role"],
    "organization": ["organization", "organisation", "company", "company name",
                     "account", "account name", "agency", "employer", "org"],
    "website": ["website", "web site", "url", "web", "company website"],
    "city": ["city", "town"],
    "state": ["state", "province", "st"],
    "notes": ["notes", "comments", "message", "description"],
}


def _header_key(h: str) -> str:
    return clean(re.sub(r"[^\w\s\-]", " ", h or "")).lower()


def _alias_lookup() -> dict:
    return {alias: field for field, aliases in CSV_ALIASES.items() for alias in aliases}


def from_form(payload: dict) -> Lead:
    """Web form / manual entry: a JSON object using Lead field names
    (a few common synonyms are accepted)."""
    lookup = _alias_lookup()
    mapped: dict = {}
    extra: dict = {}
    for key, value in payload.items():
        if key in ("source",):
            continue
        field = lookup.get(_header_key(str(key)).replace("_", " "))
        if field and field not in mapped:
            mapped[field] = value if isinstance(value, str) else str(value or "")
        elif key in Lead.__dataclass_fields__ and key not in ("extra", "source"):
            mapped[key] = value
        else:
            extra[key] = value
    return build_lead(**mapped, extra=extra, source=payload.get("source") or "web_form")


def from_csv(text: str, source: str = "csv") -> list[tuple[int, Lead]]:
    """Returns (row number, Lead). Row 1 is the header, data starts at 2."""
    lookup = _alias_lookup()
    reader = csv.DictReader(io.StringIO(text.lstrip("﻿")))
    out = []
    for i, row in enumerate(reader, start=2):
        mapped: dict = {}
        for header, value in row.items():
            field = lookup.get(_header_key(header))
            if field and field not in mapped:
                mapped[field] = value or ""
        if not any(clean(v) for v in mapped.values()):
            continue                      # blank line
        out.append((i, build_lead(**mapped, source=source)))
    return out


_LABEL = re.compile(r"^\s*(name|email|phone|title|company|organization|website|city|state)\s*[:\-]\s*(.+?)\s*$",
                    re.I | re.M)


def from_email(raw: str) -> Lead:
    """Raw RFC 822 text (or a forwarded message). Prefers labeled lines in the
    body ("Name: ...", "Company: ..."), then falls back to the From header."""
    msg = message_from_string(raw, policy=policy.default)
    body_part = msg.get_body(preferencelist=("plain", "html"))
    body = body_part.get_content() if body_part else (raw if not msg.keys() else "")
    mapped: dict = {}
    for label, value in _LABEL.findall(body):
        label = label.lower()
        key = {"name": "full_name", "company": "organization"}.get(label, label)
        mapped.setdefault(key, value)
    if not mapped.get("email"):
        # first address in the body that isn't ours, else the sender
        from_addr = normalize_email(str(msg.get("Reply-To") or msg.get("From") or ""))
        mapped["email"] = from_addr or normalize_email(body)
    if not mapped.get("full_name") and msg.get("From"):
        display = re.sub(r"<.*?>", "", str(msg["From"])).strip().strip('"')
        if display and "@" not in display:
            mapped["full_name"] = display
    return build_lead(**mapped, source="email",
                      notes=f"Subject: {msg.get('Subject', '')}".strip())
