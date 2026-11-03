# con_worker -- job function, contract-pipeline Catalyst project.
#
# Phase 2 scaffold + Phase 3b (rates) + Phase 3c (terms) + Phase 3d (clauses), 27-28 Sep 2026.
# Phase 4 (27 Sep 2026): Ingest_Review JSON for the Contract Review widget (review_payload.py).
# Reads the packet, classifies and dates each file, indexes it on Contract_Documents, extracts rate
# lines and term fields, writes them under the Phase 0 rules (writeback.py), and posts the summary Note.
# Clauses (Phase 3d, clause_finder.py) are proposed as Contract_Clauses rows, Status = Proposed.
#
# Idempotent: Packet_Hash (sha256 of the zip) short-circuits an unchanged packet ("already read
# earlier"). Contract_Documents key = parent + File_Name + sha1(bytes). Rate_Lines and Contract fields
# follow writeback.py's rules, so a rerun of a changed packet only moves what changed and never touches
# Verified rows or a Verified (Ingest_Status = Ingested) contract.
# No stub Solicitations (Phase 0 decision). AI tokens: off unless CON_CLAUDE is set (Phase 10a, 29 Oct 2026):
# claude_extract.py reads the packet beside the rules and, in shadow mode, only posts a Note and a .json
# attachment. With CON_CLAUDE unset the worker behaves exactly as before.
#
# 28 Sep 2026 fix: _upsert_contract_document no longer puts File_Name in the COQL (apostrophes in file
# names caused "400 SYNTAX_ERROR near Contract, column 43").
#
# 9 Oct 2026: vendor vs customer separation. Counterparty_Type picks the extraction profile; a blank
# value now stops the ingest with a Note instead of silently reading the packet as Customer. New action
# new_vendor_contract_from_packet (button on Vendors) creates a Counterparty_Type = Vendor contract;
# new_contract_from_packet (Accounts) stays Customer-only.

import datetime as dt
import hashlib
import io
import logging
import re
import zipfile

import zoho_client as zc
from doc_classifier import classify, extract_applies_to_contracts
from packet_extract import PacketDoc, extract_packet
from packet_reader import READABLE_EXT, read_packet
from writeback import derive_term_dates, make_eff, plan_contract_fields, plan_rate_lines
from clause_finder import find_clauses, plan_clauses
from rate_extractor import is_current
import review_payload
import ocr
import claude_extract

# Phase 3d (clauses): designed and calibrated on the golden set 28 Sep 2026 (Fable), finished 27 Sep 2026
# (Opus): list items, unnumbered headings, Due_Date, holdout + vendor-role tests, deploy gate. On = each
# proposal is written as a Contract_Clauses row with Status = Proposed for a person to Confirm/Reject;
# a rerun only adds new hashes and never re-proposes a Rejected one. Set False to go back to Note-only.
WRITE_CLAUSES = True

log = logging.getLogger()
# 20 Oct 2026: Catalyst runs the root logger at DEBUG, and pdfminer (under pdfplumber) logs every token it
# parses -- millions of lines on a vector-heavy PDF, which made Sawyer Co HHS run for 10+ minutes.
for _noisy in ("pdfminer", "pdfplumber", "PIL", "urllib3"):
    logging.getLogger(_noisy).setLevel(logging.WARNING)

NO_ATTACHMENTS_MSG = ("No readable attachment on this record -- nothing to ingest. Attach the packet as a "
                      ".zip, or the signed agreement as a PDF / Word / Excel file, and press the button again.")

CONTRACT_FIELDS = [
    "Name", "Ingest_Status", "Packet_Hash", "Account", "Counterparty_Type", "Rate_Lines",
    "Contract_Start_Date", "Original_End_Date", "Contract_End_Date", "Auto_Renews", "Renewals_Allowed",
    "Renewal_Options_Left", "Renewal_Option_Length_Mo", "End_After_1_Renewal", "Final_End_Date", "Notice_Period_Days", "Termination_Convenience_Days", "Payment_Terms_Days",
    "Invoice_Cadence", "Not_To_Exceed", "Escalator_Pct", "Governing_State", "Insurance_Limit",
    "Rate_Basis", "Admin_Rate_Pct", "Spare_Device_Clause", "Spare_Clause_Detail", "Amendment_Count",
    "Last_Amendment_Date", "Ingest_Review",
]
NOTE_LIMIT = 30000  # Zoho Note_Content practical cap; the Ingest_Summary field (2000) gets the head


_SECRET_RE = re.compile(r"(refresh_token|client_secret|client_id|access_token|api_key|token)=[^&\s]+", re.I)


def _safe_error(exc):
    """Error text for a CRM Note: query strings with credentials masked, Zoho OAuth tokens masked, capped."""
    text = str(exc) or exc.__class__.__name__
    text = _SECRET_RE.sub(lambda m: m.group(1) + "=***", text)
    text = re.sub(r"1000\.[0-9a-f]{32}\.[0-9a-f]{32}", "***", text)   # Zoho oauth token shape
    return text[:1500]


def handler(job_request, context):
    """Catalyst python_3_9 Job function entry point (same signature as the live sol_worker): params come
    from job_request.get_job_param, and the job must be closed explicitly or it runs to the timeout."""
    record_id = str(job_request.get_job_param("recordId"))
    action = job_request.get_job_param("action")
    module = job_request.get_job_param("module") or "Contracts"
    try:
        run(record_id, action)
        context.close_with_success()
    except Exception as exc:  # noqa: BLE001 -- tell the person on the record, then fail the job
        log.exception("contract ingest failed")
        try:
            if action not in NEW_FROM_PACKET:
                zc.update_record("Contracts", record_id, {"Ingest_Status": "Failed"})
            zc.post_note(module, record_id, "Contract ingest", "Ingest failed: {}".format(_safe_error(exc)))
        except Exception:  # noqa: BLE001
            log.exception("could not post the failure note")
        context.close_with_failure()


COUNTERPARTY_TYPES = ("Customer", "Vendor")
NO_TYPE_MSG = ("Counterparty_Type is blank on this contract, so the ingest did not run -- vendor and customer "
               "packets are read with different rules. Set Counterparty_Type to Vendor (Allied, SCRAM, SuperCom, "
               "Buddi) or Customer (everyone else) and press the button again.")

# action -> (parent module, parent name field, parent lookup on Contracts, Counterparty_Type)
NEW_FROM_PACKET = {
    "new_contract_from_packet": ("Accounts", "Account_Name", "Account", "Customer"),
    "new_vendor_contract_from_packet": ("Vendors", "Vendor_Name", "Vendor", "Vendor"),
}


def run(record_id, action):
    if action in NEW_FROM_PACKET:
        contract_id = _create_contract_from_parent(record_id, *NEW_FROM_PACKET[action])
    else:
        contract_id = record_id
    _ingest_contract(contract_id)


def _create_contract_from_parent(parent_id, module, name_field, lookup_field, counterparty_type):
    parent = zc.get_record(module, parent_id, fields=[name_field])
    suffix = "vendor pricing from packet" if counterparty_type == "Vendor" else "from packet"
    contract = zc.create_record("Contracts", {
        "Name": "{} - {}".format(parent.get(name_field) or "New contract", suffix)[:120],  # mandatory
        lookup_field: {"id": parent_id},
        "Contract_Status": "In Progress",  # "Draft" is not a Contract_Status value
        "Ingest_Status": "Not Ingested",
        "Counterparty_Type": counterparty_type,
    })
    contract_id = contract["details"]["id"]
    # Move the zip so the packet lives in exactly one place (on the Contract).
    for att in zc.list_attachments(module, parent_id):
        name = att.get("File_Name", "")
        if name.lower().endswith(".zip"):
            raw = zc.download_attachment(module, parent_id, att["id"], expected_size=att.get("Size"), file_name=name)
            zc.upload_attachment("Contracts", contract_id, name, raw)
            zc.delete_attachment(module, parent_id, att["id"])
    return contract_id


def _ingest_contract(contract_id):
    contract = zc.get_record("Contracts", contract_id, fields=CONTRACT_FIELDS)
    stored_hash = contract.get("Packet_Hash")
    counterparty_type = contract.get("Counterparty_Type")
    if counterparty_type not in COUNTERPARTY_TYPES:
        zc.update_record("Contracts", contract_id, {"Ingest_Status": "Failed"})
        zc.post_note("Contracts", contract_id, "Contract ingest", NO_TYPE_MSG)
        return

    attachments = zc.list_attachments("Contracts", contract_id)
    # 20 Oct 2026: take the NEWEST zip. The old code took whichever the API listed first, so a stale packet
    # from an earlier attempt could be read instead of the one just attached.
    zips = [a for a in attachments if a.get("File_Name", "").lower().endswith(".zip")]
    part_warnings = []
    if zips:
        # 26 Oct 2026: Zoho cuts every attachment download at 25 MB, so a big packet is attached as several zips.
        # The newest zip anchors the packet; every other zip attached within SPLIT_WINDOW_MINUTES of it is another
        # part of the same packet. Older zips stay ignored (the 20 Oct rule).
        parts, part_warnings = _select_packet_zips(zips)
        too_big = [a for a in parts if _over_cap(a)]
        if too_big and len(too_big) == len(parts):
            zc.update_record("Contracts", contract_id, {"Ingest_Status": "Failed"})
            zc.post_note("Contracts", contract_id, "Contract ingest", _over_cap_msg(too_big))
            return
        parts = [a for a in parts if not _over_cap(a)]
        part_warnings += ["{} is {} -- over Zoho's 25 MB download limit, so it was NOT read. Split it into zips under 25 MB "
                          "and attach them together.".format(a.get("File_Name", "a zip"), _mb(a)) for a in too_big]
        downloads = [(a.get("File_Name", "packet.zip"),
                      zc.download_attachment("Contracts", contract_id, a["id"], expected_size=a.get("Size"),
                                             file_name=a.get("File_Name", "packet.zip"))) for a in parts]
        if len(downloads) == 1:
            packet_name, zip_bytes = downloads[0]
        else:
            packet_name = "split packet ({} zips)".format(len(downloads))
            zip_bytes = bundle_files(_unique_names(downloads))
    else:
        # No zip: a single signed PDF (or a few loose files) is a packet too -- bundle every readable
        # attachment into an in-memory zip so the rest of the pipeline is unchanged.
        loose = sorted((a for a in attachments if _readable(a.get("File_Name", ""))), key=lambda a: a["File_Name"])
        if not loose:
            zc.update_record("Contracts", contract_id, {"Ingest_Status": "Failed"})
            zc.post_note("Contracts", contract_id, "Contract ingest", NO_ATTACHMENTS_MSG)
            return
        too_big = [a for a in loose if _over_cap(a)]
        if too_big:
            zc.update_record("Contracts", contract_id, {"Ingest_Status": "Failed"})
            zc.post_note("Contracts", contract_id, "Contract ingest", _over_cap_msg(too_big))
            return
        packet_name = loose[0]["File_Name"] if len(loose) == 1 else "attachments ({} files)".format(len(loose))
        zip_bytes = bundle_files([(a["File_Name"], zc.download_attachment("Contracts", contract_id, a["id"],
                                                                          expected_size=a.get("Size"), file_name=a["File_Name"]))
                                  for a in loose])
    log.info("packet downloaded: %s, %s KB", packet_name, len(zip_bytes) // 1024)

    # A Failed run is never "already read": the packet may have failed for a reason that is fixed now. Nor is a
    # packet with a scan still marked "No text layer" (OCR may work now, or an OCR'd copy was swapped in).
    # S45 (29 Oct 2026): the hash is checked BEFORE the packet is read, so an unchanged packet costs no reading and
    # no OCR (Milwaukee's unchanged packet was killed in OCR on every press).
    packet_sha256 = hashlib.sha256(zip_bytes).hexdigest()
    if (stored_hash and stored_hash == packet_sha256 and contract.get("Ingest_Status") != "Failed"
            and not _has_unread_scan(contract_id)):
        if claude_extract.rerun_unchanged():
            # Phase 10a golden-set runs: read the unchanged packet in memory, WITHOUT OCR (Claude reads the scans as
            # PDFs), and let Claude read it. Nothing is written but the Notes and the Claude .json attachment.
            zc.post_note("Contracts", contract_id, "Contract ingest",
                         "{} already read earlier (Packet_Hash unchanged) -- nothing written; CON_CLAUDE_RERUN is on, "
                         "so Claude reads it (shadow, scans sent to Claude as PDFs, no OCR).".format(packet_name))
            entries, _, _ = read_packet(zip_bytes, ocr_pages=0)
            docs = [PacketDoc(name=e.name, text=e.text) for e in entries if not e.skip_reason and not e.no_text_layer]
            result = extract_packet(docs, counterparty_type,
                                    contract_has_account=bool(contract.get("Account")), packet_name=packet_name)
            _claude_shadow(contract_id, entries, result, contract, counterparty_type)
            return
        zc.post_note("Contracts", contract_id, "Contract ingest",
                     "{} already read earlier (Packet_Hash unchanged) -- nothing new to ingest.".format(packet_name))
        return

    entries, packet_sha256, warnings = read_packet(zip_bytes)
    log.info("packet read: %s file(s)", len(entries))
    warnings = list(part_warnings) + list(warnings)

    read_lines, skipped_lines, no_text_layer_lines = [], [], []
    docs, entry_by_name = [], {}
    warnings = list(warnings) + _ocr_warnings(entries)
    for e in entries:
        if e.skip_reason:
            skipped_lines.append(e.to_summary())
            continue
        if e.no_text_layer:
            no_text_layer_lines.append(e.name)
            continue  # nothing to extract; indexed below with Text_Layer = No
        docs.append(PacketDoc(name=e.name, text=e.text))
        entry_by_name[e.name] = e

    result = extract_packet(docs, counterparty_type,
                            contract_has_account=bool(contract.get("Account")), packet_name=packet_name)

    # ---- Contract_Documents index (Phase 2 behaviour, now with better dates and Applies_To) ----
    for seq, d in enumerate(result.docs, start=1):
        e = entry_by_name[d.name]
        _upsert_contract_document(contract_id, d.name, e.sha1, d.doc_type, e.pages, d.effective_date, "Yes",
                                  extract_applies_to_contracts(d.text) if d.doc_type == "Addendum" else "", seq,
                                  parse_status="Parsed")
        read_lines.append("{} -> {}{}".format(d.name, d.doc_type,
                                              ", eff. {} ({})".format(d.effective_date, d.date_rule) if d.effective_date else ""))
    for name in no_text_layer_lines:
        e = next(x for x in entries if x.name == name)
        _upsert_contract_document(contract_id, name, e.sha1, classify(name, ""), e.pages, None, "No", "", 0,
                                  parse_status="No text layer")

    # ---- Phase 3b: rate lines ----
    existing_rows = contract.get("Rate_Lines") or []
    rate_plan, rate_notes = plan_rate_lines(existing_rows, result.rate_rows, result.superseded,
                                            counterparty_type)
    _apply_rate_plan(contract_id, existing_rows, rate_plan)

    # ---- Phase 3c: term + pricing fields ----
    decisions = review_payload.decisions_of(contract.get("Ingest_Review"))
    field_updates, field_notes = plan_contract_fields(
        contract, result.terms, result.pricing, [(d.doc_type, d.effective_date) for d in result.docs],
        decisions=decisions)
    # Phase 4: a field a person decided in the Contract Review widget is never rewritten by a rerun.
    field_updates, review_notes = review_payload.apply_decisions(field_updates, decisions)
    field_notes = field_notes + review_notes
    # The computed end dates, shown in the review for Confirm / Edit (same inputs the plan used).
    derived_dates, _ = derive_term_dates(make_eff(contract, field_updates, decisions))

    # ---- Phase 3d: clauses ----
    clause_props, clause_dropped, clause_notes = find_clauses(
        result.docs, counterparty_type, packet_name,
        start_date=field_updates.get("Contract_Start_Date") or contract.get("Contract_Start_Date"),
        end_date=field_updates.get("Contract_End_Date") or contract.get("Contract_End_Date"))
    clause_created = 0
    if clause_props:
        existing_clauses = zc.coql(
            "select id, Clause_Hash, Status from Contract_Clauses where Contract = '{}' limit 200".format(contract_id))
        account = contract.get("Account") or {}
        clause_plan, more = plan_clauses(existing_clauses, clause_props, contract_id, account.get("id"))
        clause_notes.extend(more)
        if WRITE_CLAUSES:
            for fields in clause_plan["create"]:
                try:
                    zc.create_record("Contract_Clauses", fields)
                    clause_created += 1
                except Exception as exc:  # one bad row must not lose the rates/terms already written
                    clause_notes.append("could not create clause '{}': {}".format(fields.get("Title"), exc))
        else:
            clause_notes.append("clause write-back is off (WRITE_CLAUSES) -- {} row(s) would be created".format(
                len(clause_plan["create"])))

    readable_count = len(entries) - len(skipped_lines)
    all_no_text = readable_count > 0 and len(no_text_layer_lines) == readable_count
    ingest_status = "Failed" if (readable_count == 0 or all_no_text) else "Needs Review"

    summary = _build_summary(read_lines, skipped_lines, no_text_layer_lines, warnings, result,
                             rate_plan, rate_notes, field_updates, field_notes,
                             clause_props, clause_dropped, clause_created, clause_notes, packet_name=packet_name)
    summary = "Read as a {} contract (Counterparty_Type).\n".format(counterparty_type) + summary
    update = dict(field_updates)
    update.update({
        "Ingest_Status": ingest_status if contract.get("Ingest_Status") != "Ingested" else "Ingested",
        "Ingested_On": dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S-00:00"),
        # A failed read does not record the hash, so the same packet can be read again once fixed.
        "Packet_Hash": packet_sha256 if ingest_status != "Failed" else contract.get("Packet_Hash"),
        "Ingest_Summary": summary[:2000],
        "Ingest_Review": review_payload.build(contract.get("Ingest_Review"), result, field_updates, packet_name,
                                              is_current=is_current, derived=derived_dates),
    })
    zc.update_record("Contracts", contract_id, update)
    zc.post_note("Contracts", contract_id, "Contract ingest", summary[:NOTE_LIMIT])
    # S45: an all-scan packet is Failed for the rules but is exactly what Claude can read (scans go as PDFs).
    if ingest_status != "Failed" or all_no_text:
        _claude_shadow(contract_id, entries, result, contract, counterparty_type)


def _claude_shadow(contract_id, entries, result, contract, counterparty_type):
    """Phase 10a: Claude reads the packet after the rule-based ingest is written. Off unless CON_CLAUDE is set;
    in shadow it only posts a Note and attaches a .json. claude_extract never raises."""
    if claude_extract.mode() == "off":
        return []
    return claude_extract.run_shadow(
        entries, result, contract, counterparty_type,
        post_note=lambda title, content: zc.post_note("Contracts", contract_id, title, content),
        upload_attachment=lambda name, raw: zc.upload_attachment("Contracts", contract_id, name, raw))


def _has_unread_scan(contract_id):
    try:
        rows = zc.coql("select id from Contract_Documents where (Contract = '{}' and Parse_Status = 'No text layer') "
                       "limit 1".format(contract_id))
        return bool(rows)
    except Exception:  # noqa: BLE001 -- never block an ingest on this check
        return False


def _ocr_warnings(entries):
    """Lines for the Note: files read by OCR (check the numbers) and scans OCR could not read (use the PC)."""
    out = []
    for e in entries:
        if e.ocr_used:
            conf = " (lowest page confidence {:.0f}%)".format(e.ocr_confidence * 100) if e.ocr_confidence is not None else ""
            low = " LOW CONFIDENCE." if e.ocr_confidence is not None and e.ocr_confidence < ocr.LOW_CONFIDENCE else ""
            out.append("{} is a scan and was read by OCR, {} page(s){}.{} OCR can misread digits -- check every rate "
                       "and date from this file against the PDF.".format(e.name, e.ocr_pages, conf, low))
        elif e.unread_pages:
            out.append("{} was read from its text pages only: page(s) {} are scans with no readable text (OCR: {}). "
                       "Anything on those pages -- an earlier amendment, a certificate of insurance, a signed rate "
                       "sheet -- is NOT in this read. OCR the file on your PC, attach the searchable copy under a "
                       "new file name, and read the contract again.".format(
                           e.name, _page_list(e.unread_pages), e.ocr_error or "not tried"))
        elif e.ocr_error:
            out.append("OCR in Catalyst could not read {} ({}). Run OCR on your PC (Acrobat: Scan & OCR > Recognize "
                       "Text, or ocrmypdf), attach the searchable copy under a new file name, and read the contract "
                       "again.".format(e.name, e.ocr_error))
    return out


def _page_list(pages, limit=12):
    """[21,22,23,45] -> '21-23, 45' (first `limit` runs, then '...')."""
    runs, start, prev = [], None, None
    for n in list(pages) + [None]:
        if start is None:
            start = prev = n
        elif n is not None and n == prev + 1:
            prev = n
        else:
            runs.append(str(start) if start == prev else "{}-{}".format(start, prev))
            start = prev = n
    return ", ".join(runs[:limit]) + (", ..." if len(runs) > limit else "")


ZOHO_DOWNLOAD_CAP = 25000000  # Zoho's attachment download API stops at exactly this many bytes
SPLIT_WINDOW_MINUTES = 10


def _size(a):
    try:
        return int(a.get("Size") or 0)
    except (TypeError, ValueError):
        return 0


def _over_cap(a):
    return _size(a) > ZOHO_DOWNLOAD_CAP


def _mb(a):
    return "{:.1f} MB".format(_size(a) / 1048576.0)


def _over_cap_msg(attachments):
    return ("Ingest failed: " + "; ".join("{} is {}".format(a.get("File_Name", "a file"), _mb(a)) for a in attachments)
            + ". Zoho only lets the worker download 25 MB (25,000,000 bytes) per attachment, so a file over that "
              "cannot be read. Split the packet into several zips, each under 25 MB, and attach them all together "
              "(within {} minutes of each other); the worker reads them as one packet.".format(SPLIT_WINDOW_MINUTES))


def _created(a):
    from datetime import datetime
    try:
        return datetime.fromisoformat((a.get("Created_Time") or "").replace("Z", "+00:00"))
    except ValueError:
        return None


def _select_packet_zips(zips):
    """The newest zip plus every zip created within SPLIT_WINDOW_MINUTES before it. Returns (parts, warnings).
    A zip with no readable Created_Time is only ever the packet when it is the sole zip."""
    newest = max(zips, key=lambda a: a.get("Created_Time") or "")
    t_new = _created(newest)
    parts = [newest]
    if t_new is not None:
        for a in zips:
            if a is newest:
                continue
            t = _created(a)
            if t is not None and t.tzinfo is not None and t_new.tzinfo is not None \
                    and 0 <= (t_new - t).total_seconds() <= SPLIT_WINDOW_MINUTES * 60:
                parts.append(a)
    parts.sort(key=lambda a: (a.get("Created_Time") or "", a.get("File_Name", "")))
    warnings = []
    if len(parts) > 1:
        warnings.append("Read {} zips attached together as one packet: {}.".format(
            len(parts), ", ".join(a.get("File_Name", "?") for a in parts)))
    return parts, warnings


def _unique_names(downloads):
    seen, out = {}, []
    for name, raw in downloads:
        n = seen.get(name, 0)
        seen[name] = n + 1
        out.append((name if n == 0 else "{} ({})".format(name, n + 1), raw))
    return out



def _readable(name):
    return ("." + name.rsplit(".", 1)[-1].lower()) in READABLE_EXT if "." in name else False


def bundle_files(files):
    """[(name, bytes)] -> zip bytes. Fixed timestamps so the same files always give the same Packet_Hash
    (an unchanged PDF is then "already read earlier", like an unchanged zip)."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, raw in files:
            zf.writestr(zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0)), raw)
    return buf.getvalue()


def _apply_rate_plan(contract_id, existing_rows, plan):
    """Rate_Lines is a subform: a PUT replaces the whole list, and any existing row whose id is left out
    is DELETED by Zoho. So every existing row id is always sent back, changed or not."""
    if not (plan["update"] or plan["insert"] or plan["supersede"]):
        return
    payload = []
    for r in existing_rows:
        item = {"id": r["id"]}
        item.update(plan["update"].get(r["id"], {}))
        payload.append(item)
    payload.extend(fields for _, fields in plan["insert"])
    zc.update_record("Contracts", contract_id, {"Rate_Lines": payload})

    if not plan["supersede"]:
        return
    # Second pass: find the ids Zoho gave the inserted rows, then set Superseded_By.
    fresh = zc.get_record("Contracts", contract_id, fields=["Rate_Lines"]).get("Rate_Lines") or []
    old_ids = {r["id"] for r in existing_rows}
    new_ids = {}
    for (ref, fields) in plan["insert"]:
        for r in fresh:
            if r["id"] in old_ids or r["id"] in new_ids.values():
                continue
            if (r.get("Rate_Device") == fields["Rate_Device"] and (r.get("Tier_Min_Units") or 0) == (fields["Tier_Min_Units"] or 0)
                    and r.get("Effective_Date") == fields["Effective_Date"]
                    and abs(float(r.get("Rate_Daily_Amount") or 0) - fields["Rate_Daily_Amount"]) < 0.005):
                new_ids[ref] = r["id"]
                break

    def resolve(ref):
        return ref[1] if ref[0] == "id" else new_ids.get(ref)

    sup = {}
    for old_ref, new_ref in plan["supersede"]:
        o, n = resolve(old_ref), resolve(new_ref)
        if o and n:
            sup[o] = n
    if sup:
        zc.update_record("Contracts", contract_id, {"Rate_Lines": [
            dict({"id": r["id"]}, **({"Superseded_By": sup[r["id"]]} if r["id"] in sup else {})) for r in fresh]})


def _upsert_contract_document(contract_id, file_name, sha1, doc_type, pages, effective_date, text_layer,
                              applies_to, sequence, parse_status=None):
    # Key = parent + File_Name + sha1. File_Name is matched here in Python, not in the COQL: COQL rejects
    # a backslash-escaped quote (SYNTAX_ERROR at the start of the where clause), so a file name with an
    # apostrophe ("Sheriff's addendum.pdf") broke the whole ingest (28 Sep 2026). contract_id is digits and
    # sha1 is hex, so this query can never hold a quote.
    rows = zc.coql(
        "select id, File_Name from Contract_Documents where (Contract = '{}' and Sha1 = '{}') limit 200"
        .format(contract_id, sha1)
    )
    existing = [r for r in rows if (r.get("File_Name") or "") == file_name]
    data = {
        "Name": file_name[:120],  # mandatory record-name field on Contract_Documents
        "Contract": {"id": contract_id},
        "File_Name": file_name,
        "Doc_Type": doc_type,
        "Sequence": sequence,
        "Effective_Date": effective_date,
        "Pages": pages,
        "Text_Layer": text_layer,
        "Applies_To_Contracts": applies_to,
        "Sha1": sha1,
    }
    if parse_status:
        # 12 Oct 2026: the Contract Ingest widget polls this field to show a chip per file. Picklist values:
        # Parsed, No text layer, Skipped, Failed. Skipped files are not indexed, so only the first two are
        # written here; a whole-run failure is already reported through Ingest_Status = Failed.
        data["Parse_Status"] = parse_status
    if existing:
        zc.update_record("Contract_Documents", existing[0]["id"], data)
    else:
        zc.create_record("Contract_Documents", data)


_UUID_PREFIX = re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-")


def _tidy(text, packet_name=None):
    """Readable file names: Contractbook puts a 36-character ID in front of every name, and every citation
    repeats the packet name. Display only -- Source_Ref on Rate_Lines and the review payload keep the full text."""
    text = _UUID_PREFIX.sub("", text)
    if packet_name:
        text = text.replace(packet_name + " > ", "")
    return text


def _build_summary(read_lines, skipped_lines, no_text_layer_lines, warnings, result, rate_plan, rate_notes,
                   field_updates, field_notes, clause_props=(), clause_dropped=0, clause_created=0, clause_notes=(),
                   packet_name=None):
    def T(x):
        return _tidy(x, packet_name)

    end = result.terms.get("Contract_End_Date")
    parts = ["SUMMARY: {} file(s) read | packet end date {} | {} rate line(s) | {} clause(s) to review".format(
        len(read_lines), end.value if end else "not found", len(result.rate_rows), len(clause_props)),
        "",
        "FILES READ (oldest first, newest wins):"]
    parts.extend("  {}. {}".format(i, T(l).replace(" -> ", " - ")) for i, l in enumerate(read_lines, 1)) \
        if read_lines else parts.append("  none")
    dupes = [l for l in skipped_lines if "same file as" in l]
    other = [l for l in skipped_lines if "same file as" not in l]
    if dupes:
        parts.append("Skipped {} duplicate copy(ies) of the files above (the same packet is attached more than once).".format(len(dupes)))
    parts.extend("Skipped: " + T(l) for l in other)
    if no_text_layer_lines:
        parts.append("{} file(s) have no text layer and were not read -- OCR on Beau's PC and re-upload: {}".format(
            len(no_text_layer_lines), ", ".join(T(n) for n in no_text_layer_lines)))
    if warnings:
        parts.extend("Warning: " + T(w) for w in warnings)

    parts.append("")
    parts.append("RATES: {} inserted, {} updated/cited, {} superseded.".format(
        len(rate_plan["insert"]), len(rate_plan["update"]), len(rate_plan["supersede"])))
    for r in result.rate_rows:
        parts.append(T("  {} {}{} ${:.2f}/day eff {} [{}] {}".format(
            r.device, "tier {}{} ".format(r.tier_min, "-{}".format(r.tier_max) if r.tier_max else "+") if r.tier_min else "",
            "(purchased) " if r.ownership else "", r.amount, r.effective_date or "?", r.confidence, r.source)))
    parts.extend("  " + T(n) for n in rate_notes + result.notes)

    fees = getattr(result, "program_fees", None) or []
    if fees:
        parts.append("")
        parts.append("PROGRAM FEES: the county pays a fixed monthly fee per program (JusticePoint's own programs). These are "
                     "NOT Rate Lines -- Rate Lines hold per-day device rates only. Check each against the paper.")
        for sow in sorted({f.sow or 0 for f in fees}):
            rows = [f for f in fees if (f.sow or 0) == sow]
            parts.append("  {}{}".format("SOW {}".format(sow) if sow else "No SOW named", ": " + T(rows[0].caption) if rows[0].caption else ""))
            for f in rows:
                parts.append("    {} -- ${:,.2f}/month (${:,.2f}/year) [{}]".format(f.program, f.monthly, f.annual, T(f.source)))
            parts.append("    total ${:,.2f}/month, ${:,.2f}/year".format(sum(f.monthly for f in rows), sum(f.annual for f in rows)))
            if any(f.check for f in rows):
                parts.append("    WARNING: " + next(f.check for f in rows if f.check))
    parts.append("")
    parts.append("TERMS: {} field(s) written: {}".format(
        len(field_updates), ", ".join("{}={}".format(k, v) for k, v in field_updates.items()) or "none"))
    for f in result.terms.values():
        if f.field != "Escalator_Note":
            parts.append("  " + T(f.as_note()))
    parts.extend("  " + T(n) for n in field_notes)
    parts.append("")
    parts.append("CLAUSES: {} proposed ({} created as Contract_Clauses rows), {} candidate sentence(s) dropped as "
                 "boilerplate, duplicates or already-captured fields.".format(len(clause_props), clause_created, clause_dropped))
    for p in clause_props:
        parts.append("  " + T(p.as_note()))
    parts.extend("  " + T(n) for n in clause_notes)
    parts.append("")
    parts.append("Nothing above is marked verified -- review the lines and clauses, set Line_Verified, "
                 "Confirm/Reject each clause, and set Ingest_Status = Ingested when correct.")
    return "\n".join(parts)
