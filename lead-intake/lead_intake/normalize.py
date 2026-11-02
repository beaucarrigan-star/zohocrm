"""Turn messy lead input into one clean shape."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional
from urllib.parse import urlparse

FREE_EMAIL_DOMAINS = {
    "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com",
    "icloud.com", "me.com", "live.com", "msn.com", "protonmail.com",
    "comcast.net", "att.net", "sbcglobal.net",
}

_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")


@dataclass
class Lead:
    first_name: str = ""
    last_name: str = ""
    email: str = ""
    phone: str = ""
    title: str = ""
    organization: str = ""
    website: str = ""
    city: str = ""
    state: str = ""
    source: str = ""          # where it came from: web_form, csv, email, manual
    notes: str = ""
    extra: dict = field(default_factory=dict)

    @property
    def email_domain(self) -> str:
        return email_domain(self.email)

    @property
    def company_domain(self) -> str:
        """Domain that identifies the organization, or '' if we can't tell."""
        d = domain_from_url(self.website) or self.email_domain
        return "" if d in FREE_EMAIL_DOMAINS else d

    def problems(self) -> list[str]:
        out = []
        if not self.last_name:
            out.append("missing last name")
        if not self.organization and not self.company_domain:
            out.append("no organization or company domain")
        return out


def clean(s: Optional[str]) -> str:
    return re.sub(r"\s+", " ", (s or "").strip())


def normalize_email(s: str) -> str:
    m = _EMAIL_RE.search(s or "")
    return m.group(0).lower() if m else ""


def email_domain(email: str) -> str:
    return email.split("@", 1)[1].lower() if "@" in email else ""


def domain_from_url(url: str) -> str:
    url = clean(url)
    if not url:
        return ""
    if "//" not in url:
        url = "http://" + url
    host = (urlparse(url).hostname or "").lower()
    return host[4:] if host.startswith("www.") else host


def normalize_phone(s: str) -> str:
    """Keep digits; format 10/11-digit US numbers, leave others as typed."""
    raw = clean(s)
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) == 10:
        return f"({digits[:3]}) {digits[3:6]}-{digits[6:]}"
    return raw


def split_name(full: str) -> tuple[str, str]:
    full = clean(re.sub(r"[,;].*$", "", full or ""))
    parts = full.split(" ")
    if not full:
        return "", ""
    if len(parts) == 1:
        return "", parts[0]
    return parts[0], " ".join(parts[1:])


def normalize_org(name: str) -> str:
    """Comparison key for organization names (not what we store)."""
    n = clean(name).lower()
    n = re.sub(r"[^\w\s]", " ", n)
    n = re.sub(r"\b(inc|llc|ltd|corp|co|company|the|of)\b", " ", n)
    return clean(n)


def build_lead(**kw) -> Lead:
    lead = Lead(
        first_name=clean(kw.get("first_name")),
        last_name=clean(kw.get("last_name")),
        email=normalize_email(kw.get("email", "")),
        phone=normalize_phone(kw.get("phone", "")),
        title=clean(kw.get("title")),
        organization=clean(kw.get("organization")),
        website=clean(kw.get("website")),
        city=clean(kw.get("city")),
        state=clean(kw.get("state")),
        source=clean(kw.get("source")),
        notes=(kw.get("notes") or "").strip(),
        extra=kw.get("extra") or {},
    )
    if not lead.last_name and kw.get("full_name"):
        lead.first_name, lead.last_name = split_name(kw["full_name"])
    return lead
