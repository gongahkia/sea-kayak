# ----- required imports -----

import datetime
import hashlib
import io
import json
import os
import re
from typing import Optional
from urllib.parse import urlparse
from xml.etree import ElementTree as ET

from bs4 import BeautifulSoup

# ----- config -----

FINGERPRINT_PATH = "./../data/scrape_metadata/fingerprints.json"
DRIFT_REPORT_PATH = "./../data/scrape_metadata/drift_report.md"
HISTORY_DEPTH = 7  # rolling window for entry-count baseline
SILENT_THRESHOLD_DAYS = 5
ENTRY_FLOOR_RATIO = 0.4  # flag when entries < 40% of rolling average

# in-memory store, flushed at end of run
_state: dict = {"feeds": {}}  # url -> record
_loaded = False

# ----- persistence -----


def _load() -> None:
    global _state, _loaded
    if _loaded:
        return
    if os.path.exists(FINGERPRINT_PATH):
        try:
            with open(FINGERPRINT_PATH, "r", encoding="utf-8") as f:
                _state = json.load(f)
                if "feeds" not in _state:
                    _state = {"feeds": {}}
        except Exception:
            _state = {"feeds": {}}
    _loaded = True


def _save() -> None:
    os.makedirs(os.path.dirname(FINGERPRINT_PATH), exist_ok=True)
    with open(FINGERPRINT_PATH, "w", encoding="utf-8") as f:
        json.dump(_state, f, indent=2, ensure_ascii=False, sort_keys=True)


# ----- fingerprinting -----


def _detect_encoding(content_type: str, body: bytes) -> str:
    if content_type:
        m = re.search(r"charset=([\w\-]+)", content_type, re.I)
        if m:
            return m.group(1).lower()
    # sniff XML declaration
    head = body[:200].decode("ascii", errors="ignore")
    m = re.search(r"encoding=[\"']([\w\-]+)[\"']", head, re.I)
    if m:
        return m.group(1).lower()
    return "utf-8"


def _looks_xml(content_type: str, body: bytes) -> bool:
    if content_type and ("xml" in content_type.lower() or "rss" in content_type.lower()):
        return True
    head = body[:512].lstrip()
    return head.startswith(b"<?xml") or head.startswith(b"<rss") or head.startswith(b"<feed")


def _xml_fingerprint(body: bytes) -> dict:
    try:
        # ET strips namespaces inconsistently; build a normalized fingerprint
        parser = ET.XMLParser()
        root = ET.fromstring(body, parser=parser)
    except ET.ParseError as e:
        return {"format": "xml", "parse_error": str(e)}

    def _tag(el):
        t = el.tag
        return t.split("}", 1)[1] if "}" in t else t  # strip namespace

    root_tag = _tag(root)
    root_attrs = sorted(root.attrib.keys())

    # find first entry-like child (item/entry); for RSS the channel wraps items
    entry = None
    for el in root.iter():
        tag = _tag(el)
        if tag in ("item", "entry"):
            entry = el
            break

    first_entry_tag = _tag(entry) if entry is not None else ""
    first_entry_children = sorted({_tag(c) for c in entry}) if entry is not None else []
    first_entry_attrs = sorted(entry.attrib.keys()) if entry is not None else []

    # entry count
    entry_count = sum(1 for el in root.iter() if _tag(el) in ("item", "entry"))

    return {
        "format": "xml",
        "root_tag": root_tag,
        "root_attrs": root_attrs,
        "first_entry_tag": first_entry_tag,
        "first_entry_children": first_entry_children,
        "first_entry_attrs": first_entry_attrs,
        "entry_count": entry_count,
    }


def _html_fingerprint(body: bytes) -> dict:
    try:
        soup = BeautifulSoup(body, "html.parser")
    except Exception as e:
        return {"format": "html", "parse_error": str(e)}
    anchors = soup.find_all("a", href=True)
    link_count = len(anchors)
    # top-level structural tags (which sections exist)
    top_tags = sorted({t.name for t in soup.find_all(True, recursive=False)})
    # capture distinct class names on anchors (drift signal for templating change)
    anchor_classes = sorted(
        {cls for a in anchors[:100] for cls in (a.get("class") or [])}
    )[:50]
    return {
        "format": "html",
        "top_tags": top_tags,
        "anchor_count": link_count,
        "anchor_classes": anchor_classes,
        "entry_count": link_count,  # alias for floor logic
    }


def _fingerprint(content_type: str, body: bytes) -> dict:
    fp = _xml_fingerprint(body) if _looks_xml(content_type, body) else _html_fingerprint(body)
    fp["body_sha256"] = hashlib.sha256(body).hexdigest()
    fp["encoding"] = _detect_encoding(content_type, body)
    fp["content_type"] = (content_type or "").split(";")[0].strip().lower()
    fp["size_bytes"] = len(body)
    return fp


def _structural_keys(fp: dict) -> dict:
    # subset of fingerprint that defines "schema" — body_sha256/size/encoding excluded
    keys = ("format", "root_tag", "root_attrs", "first_entry_tag", "first_entry_children",
            "first_entry_attrs", "top_tags", "anchor_classes", "content_type", "parse_error")
    return {k: fp[k] for k in keys if k in fp}


# ----- public api -----


def record_fetch(url: str, body: bytes, content_type: str = "") -> None:
    """Called from scrapers after a successful fetch. Computes + stores fingerprint."""
    _load()
    fp = _fingerprint(content_type, body)
    rec = _state["feeds"].setdefault(url, {"history": []})
    rec["current_fingerprint"] = fp
    rec["last_success_iso"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    # append entry_count to rolling history
    hist = rec.get("history", [])
    hist.append({
        "ts": rec["last_success_iso"],
        "entry_count": fp.get("entry_count", 0),
        "structural_sha": _struct_hash(fp),
    })
    rec["history"] = hist[-HISTORY_DEPTH:]


def _struct_hash(fp: dict) -> str:
    s = json.dumps(_structural_keys(fp), sort_keys=True)
    return hashlib.sha256(s.encode("utf-8")).hexdigest()[:16]


def _avg_entry_count(rec: dict) -> Optional[float]:
    hist = [h["entry_count"] for h in rec.get("history", [])[:-1] if h.get("entry_count")]
    if len(hist) < 2:
        return None
    return sum(hist) / len(hist)


def _diff_fingerprint(prev: Optional[dict], curr: dict) -> list:
    diffs = []
    if not prev:
        return diffs
    prev_s = _structural_keys(prev)
    curr_s = _structural_keys(curr)
    for k in set(prev_s) | set(curr_s):
        if prev_s.get(k) != curr_s.get(k):
            diffs.append({"field": k, "before": prev_s.get(k), "after": curr_s.get(k)})
    return diffs


# ----- end-of-run reporting -----


def finalize(prev_state_path: Optional[str] = None) -> dict:
    """Write fingerprints.json + drift_report.md; return summary dict.

    prev_state_path lets the caller pin "previous" to the pre-run snapshot for diffing.
    """
    _load()
    prev_state = {}
    if prev_state_path and os.path.exists(prev_state_path):
        try:
            with open(prev_state_path, "r", encoding="utf-8") as f:
                prev_state = json.load(f)
        except Exception:
            prev_state = {}

    now = datetime.datetime.now(datetime.timezone.utc)
    drift_findings = []
    silent_findings = []
    floor_findings = []

    for url, rec in _state["feeds"].items():
        curr_fp = rec.get("current_fingerprint")
        # silent check (no successful fetch this run + last_success too old)
        last_iso = rec.get("last_success_iso")
        if last_iso:
            try:
                last_dt = datetime.datetime.fromisoformat(last_iso)
                age_days = (now - last_dt).days
                if age_days > SILENT_THRESHOLD_DAYS:
                    silent_findings.append({"url": url, "age_days": age_days})
            except Exception:
                pass

        if not curr_fp:
            continue

        prev_fp = (
            prev_state.get("feeds", {}).get(url, {}).get("current_fingerprint")
            if prev_state else None
        )
        diffs = _diff_fingerprint(prev_fp, curr_fp)
        if diffs:
            drift_findings.append({"url": url, "diffs": diffs})

        # floor check
        avg = _avg_entry_count(rec)
        ec = curr_fp.get("entry_count", 0)
        if avg is not None and avg >= 5 and ec < avg * ENTRY_FLOOR_RATIO:
            floor_findings.append({
                "url": url,
                "current": ec,
                "rolling_avg": round(avg, 1),
            })

    _save()
    _write_report(drift_findings, silent_findings, floor_findings)

    return {
        "drift": drift_findings,
        "silent": silent_findings,
        "floor": floor_findings,
        "checked_count": len(_state["feeds"]),
    }


def _write_report(drift, silent, floor) -> None:
    os.makedirs(os.path.dirname(DRIFT_REPORT_PATH), exist_ok=True)
    lines = []
    ts = datetime.datetime.now(datetime.timezone.utc).isoformat()
    lines.append(f"# Drift Report — {ts}")
    lines.append("")
    if not (drift or silent or floor):
        lines.append("_No drift, silence, or floor violations detected this run._")
    if drift:
        lines.append("## Structural drift")
        for d in drift:
            lines.append(f"### `{d['url']}`")
            for c in d["diffs"]:
                lines.append(f"- **{c['field']}**: `{c['before']}` -> `{c['after']}`")
            lines.append("")
    if silent:
        lines.append("## Silent feeds (>{} days since last success)".format(SILENT_THRESHOLD_DAYS))
        for s in silent:
            lines.append(f"- `{s['url']}` — {s['age_days']}d silent")
        lines.append("")
    if floor:
        lines.append("## Entry-count floor breaches")
        for f in floor:
            lines.append(f"- `{f['url']}` — {f['current']} entries (rolling avg {f['rolling_avg']})")
        lines.append("")
    with open(DRIFT_REPORT_PATH, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")


def snapshot_previous(dest_path: str) -> None:
    """Copy current fingerprints.json -> dest so finalize() can diff against pre-run state."""
    if os.path.exists(FINGERPRINT_PATH):
        os.makedirs(os.path.dirname(dest_path), exist_ok=True)
        with open(FINGERPRINT_PATH, "rb") as src, open(dest_path, "wb") as dst:
            dst.write(src.read())
