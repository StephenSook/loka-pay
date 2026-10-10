#!/usr/bin/env python3
"""FACTS equality check for LOKA Pay (PLAN.md task 4.2). Python 3 stdlib only.

docs/FACTS.json holds every judge-facing number. This check fails CI when a surface in
this repository drifts from it:

  1. Schema. Every fact has the required fields, a known kind, status and surface. A
     pending fact has no value. Every value has a source and an ISO 8601 as_of. A display
     string equals the value run through the formatter table below, and a computed
     estimate equals the arithmetic its source states.
  2. web/lib/facts.ts. Every exported constant is classified below. Each one that mirrors
     a fact equals docs/FACTS.json byte for byte. The file is read with a regex, not node.
  3. README.md. Each fact whose surfaces include README is looked for with its slot
     patterns: the wording README prints it in, with the value captured. Every value
     printed in a slot must equal the fact run through its README formatter.
  4. A pending fact may appear on README only as placeholder wording (PENDING, pending,
     TODO, TODO(3.6), not measured yet), never as a number.

A fact with a value that lists README as a surface but that README does not print yet is
a warning, not a failure. surfaces list where a fact goes: pending facts carry README
long before any value exists, and the README first screen is task 4.3. Run with --strict
before submission to turn those warnings into failures.

What this cannot see: slides, the video and the Devpost text live outside the repository.
The /judge, /proof and home proof pairs read docs/FACTS.json at build time
(web/lib/proof-pair.ts), so they cannot drift; web/lib/facts.ts is the hand-typed copy.

Exit codes: 0 clean, 1 findings, 2 a file is missing or unreadable.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Optional

FACTS_PATH = "docs/FACTS.json"
WEB_PATH = "web/lib/facts.ts"
README_PATH = "README.md"

KINDS = {"measured", "sourced", "computed", "config"}
STATUSES = {"pending", "measured", "computed", "config", "sourced", "not_verified"}
# Statuses that claim a value exists. not_verified may be null; pending must be.
VALUE_STATUSES = {"measured", "computed", "config", "sourced"}
SURFACES = {
    "README", "/judge", "/live", "/proof", "/trust", "/send", "/verify", "home",
    "slides", "video", "Devpost",
}
REQUIRED = ("value", "unit", "kind", "status", "source", "as_of", "surfaces")
OPTIONAL = ("display", "caveat")
SCHEMA_VERSION = 1


def explorer_tx(signature: str) -> str:
    return f"https://explorer.solana.com/tx/{signature}?cluster=devnet"


def _tenth_of_a_cent(usd: float) -> str:
    if round(usd * 100, 1) != 0.1:
        raise ValueError(f"{usd} USD is no longer about a tenth of a cent; update its wording in DISPLAY")
    return f"about ${usd:.4f} (about a tenth of a cent)"


# The text each displayed fact prints, computed from its value. A fact's "display" must
# equal this, so a value updated without its display (or the reverse) fails.
DISPLAY: dict[str, Callable[[Any], str]] = {
    "fee_per_redeem_lamports": lambda v: f"{v:,} lamports",
    "solana_base_fee_lamports_per_signature": lambda v: f"{v:,} lamports",
    "sol_usd_price_snapshot": lambda v: f"${v:,.2f}",
    "redeem_fee_usd_estimate": _tenth_of_a_cent,
    "senegal_remittances_pct_gdp_2023": lambda v: f"{v:.1f}%",
    "senegal_remittances_usd_2023": lambda v: f"${v / 1e9:.2f} billion",
    "nigeria_remittances_usd_2024": lambda v: f"${v / 1e9:.2f} billion",
    "senegal_mobile_money_adults_pct_2021": lambda v: f"{v:.0f}%",
    "senegal_mobile_money_adults_pct_2024": lambda v: f"{v:.0f}%",
    "senegal_rural_mobile_money_adults_pct_2024": lambda v: f"{v:.0f}%",
    "wave_send_fee_pct": lambda v: f"{v:g}%",
    "senegal_remittance_cost_pct_2023": lambda v: f"{v:g}%",
    "senegal_adults_15plus_2025": lambda v: f"{v / 1e6:.1f} million",
    "people_count_estimate": lambda v: f"about {v / 1e6:.1f} million",
}

# Computed estimates, recomputed from the facts their sources name.
DERIVED: dict[str, tuple[tuple[str, ...], Callable[..., Any]]] = {
    "people_count_estimate": (
        ("senegal_adults_15plus_2025", "senegal_mobile_money_adults_pct_2024"),
        lambda adults, pct: round(adults * pct / 100),
    ),
    "redeem_fee_usd_estimate": (
        ("fee_per_redeem_lamports", "sol_usd_price_snapshot"),
        lambda lamports, usd_per_sol: lamports / 1_000_000_000 * usd_per_sol,
    ),
}

# web/lib/facts.ts: every exported constant must be in exactly one of these two tables.
WEB_MIRRORS = {
    "FIRST_REDEEM_TX_SIGNATURE": "proof_pair_settled_tx",
    "REFUSED_CHEAT_TX_SIGNATURE": "proof_pair_refused_tx",
    "IPHONE_SETTLED_TX_SIGNATURE": "proof_pair_iphone_settled_tx",
    "IPHONE_SETTLED_NOTE_ID": "proof_pair_iphone_settled_note_id",
    "IPHONE_REFUSED_TX_SIGNATURE": "proof_pair_iphone_refused_tx",
    "IPHONE_REFUSED_NOTE_ID": "proof_pair_iphone_refused_note_id",
}
WEB_NOT_FACTS = {
    "INIT_TX_SIGNATURE": "initialize_vault transaction from the devnet deploy log; no FACTS key, lib/chain.ts reads it from devnet",
    "TESTFLIGHT_STATUS": "dated status sentence, not a number",
    "TESTFLIGHT_STATUS_AS_OF": "the date of TESTFLIGHT_STATUS",
    "HACKING_STARTED": "the organizers' start time, as text",
    "KIT_TAG": "a git tag name",
    "MULTISIG_TASK": "a PLAN.md task number",
}

PLACEHOLDER = r"PENDING|pending|TODO(?:\([\d.]+\))?|not measured yet"
PLACEHOLDER_WORDS = "PENDING, pending, TODO, TODO(3.6), not measured yet"
PLACEHOLDER_RX = re.compile(rf"(?:{PLACEHOLDER})")
# A number or placeholder in a README slot, never the tail of a longer number.
NP = rf"(?<![\w.,])(?P<v>\d[\d.,]*|{PLACEHOLDER})"


def _link(text: str) -> str:
    return rf"\[{re.escape(text)}\]\((?P<v>[^)\s]*)\)"


def _usd_country(country: str) -> tuple[str, ...]:
    amount = r"(?P<v>\$\d[\d.,]* (?:billion|million))"
    return (rf"{country}[^$\n]{{0,60}}?{amount}", rf"{amount}[^$\n]{{0,40}}?(?:to|in|for|into) {country}")


def _mobile_money_pct(year: int) -> tuple[str, ...]:
    pct = r"(?<![\d.])(?P<v>\d[\d.]* ?%)"
    mm = r"(?i:mobile[- ]money)"
    return (
        rf"{mm}[^\n]{{0,80}}?{pct}[^%\n]{{0,40}}?(?:in |\(){year}\b",
        rf"{pct}[^%\n]{{0,40}}?(?:in |\(){year}\b[^\n]{{0,80}}?{mm}",
    )


@dataclass(frozen=True)
class Slot:
    """How README prints one fact: patterns with one group named v, and the formatter."""

    patterns: tuple[str, ...]
    fmt: Optional[Callable[[Any], str]]  # None: no wording yet, add it when the value lands
    prefix_ok: bool = False  # a git SHA may print as its first 7 or more characters


def _g(v: Any) -> str:
    return f"{v:g}"


# Every fact whose surfaces include README. Patterns for figures README does not print
# yet are written for the likely wording and are tested in test_check_facts.py; if README
# prints a figure in other wording, add that wording here or this check cannot see it.
README_SLOTS: dict[str, Slot] = {
    "proof_pair_settled_tx": Slot((_link("settled payment"),), explorer_tx),
    "proof_pair_refused_tx": Slot((_link("refused cheat"),), explorer_tx),
    "proof_pair_iphone_settled_tx": Slot((_link("settled iPhone payment"),), explorer_tx),
    "proof_pair_iphone_refused_tx": Slot((_link("refused iPhone cheat"),), explorer_tx),
    "note_v1_bytes": Slot((r"(?<![\w.,-])(?P<v>\d[\d,]*)-byte (?:structure|note|NOTE_V1|message)\b",), str),
    "senegal_remittances_pct_gdp_2023": Slot(
        (r"(?<![\d.])(?P<v>\d[\d.,]* ?%) of (?:Senegal(?:'|’)s )?(?:GDP|gross domestic product)",),
        DISPLAY["senegal_remittances_pct_gdp_2023"],
    ),
    "senegal_remittances_usd_2023": Slot(_usd_country("Senegal"), DISPLAY["senegal_remittances_usd_2023"]),
    "nigeria_remittances_usd_2024": Slot(_usd_country("Nigeria"), DISPLAY["nigeria_remittances_usd_2024"]),
    "senegal_mobile_money_adults_pct_2021": Slot(_mobile_money_pct(2021), DISPLAY["senegal_mobile_money_adults_pct_2021"]),
    "senegal_mobile_money_adults_pct_2024": Slot(_mobile_money_pct(2024), DISPLAY["senegal_mobile_money_adults_pct_2024"]),
    "people_count_estimate": Slot(
        (r"(?<![\d.])(?P<v>(?:about |around |roughly )?\d[\d.,]* million) (?:Senegalese )?(?:adults|people)[^\n]{0,60}?(?i:mobile[- ]money)",),
        DISPLAY["people_count_estimate"],
    ),
    "zero_bar_payments_settled": Slot(
        (rf"{NP} of \S+ (?:(?:zero[- ]bars?|offline) )?payments?\b",), lambda v: f"{v:,}"
    ),
    "zero_bar_payments_tried": Slot(
        (rf"\S of {NP} (?:(?:zero[- ]bars?|offline) )?payments?\b",), lambda v: f"{v:,}"
    ),
    "ble_direct_hop_seconds_median": Slot(
        (
            rf"\bhop\b(?: took| in| of)? (?:a median of |about )?{NP} ?(?:s|sec|seconds)\b",
            rf"{NP} ?(?:s|sec|seconds)\b(?: median)? (?:per |for (?:a |one |each )?)?(?:direct )?(?:Bluetooth )?hop\b",
        ),
        _g,
    ),
    "note_to_settle_seconds_p50": Slot(
        (
            rf"{NP} ?(?:s|sec|seconds)\b(?: median)? (?:to settle|to settlement|until settled|from (?:note|payment) to settlement)",
            rf"\bsettle[sd]?\b[^\n]{{0,40}}?\b(?:in|within|after) (?:a median of |about )?{NP} ?(?:s|sec|seconds)\b",
        ),
        _g,
    ),
    "payments_settled_total": Slot(
        (rf"(?<!of ){NP} payments? settled\b", rf"(?i:payments settled|settled payments):? {NP}\b"), lambda v: f"{v:,}"
    ),
    "program_commit": Slot(
        (rf"(?i:program|verified build|built from)[^\n]{{0,40}}?\bcommit `?(?P<v>[0-9a-f]{{7,40}}|{PLACEHOLDER})\b",),
        str,
        prefix_ok=True,
    ),
    "program_hash": Slot(
        (rf"(?i:program|executable|on-chain) hash[^\n]{{0,20}}?`?(?P<v>[0-9a-f]{{64}}|{PLACEHOLDER})\b",), str
    ),
    "weekend_commits": Slot((rf"{NP} commits\b",), str),
    "weekend_files_changed": Slot((rf"{NP} files? changed\b",), str),
    "weekend_lines_added": Slot((rf"{NP} (?:insertions?\(\+\)|lines? added)",), str),
    "helene_grocer_stores_cash_only": Slot(
        (rf"{NP} (?:(?i:grocery|grocer(?:'|’)s) )?stores?\b[^\n]{{0,60}}?(?i:cash)",), str
    ),
    "helene_grocer_lost_sales_usd": Slot(
        (rf"(?P<v>\$\d[\d.,]*(?: (?:thousand|million|billion))?|{PLACEHOLDER}) (?:in )?(?i:lost sales)",), None
    ),
    "square_outage_2023_duration_minutes": Slot(
        (rf"(?i:square)[^\n]{{0,80}}?{NP}[- ]?minutes?\b", rf"{NP}[- ]?minutes?\b[^\n]{{0,60}}?(?i:square)"), str
    ),
}

EXPORT_RX = re.compile(
    r"^export\s+const\s+(?P<name>[A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*"
    r"(?P<lit>\"(?:[^\"\\\n]|\\.)*\"|'(?:[^'\\\n]|\\.)*'|-?\d[\d_]*(?:\.\d+)?)\s*;",
    re.M,
)
EXPORT_ANY_RX = re.compile(r"^export\b", re.M)


@dataclass
class Finding:
    key: str
    surface: str
    message: str
    line: Optional[int] = None


@dataclass
class Report:
    findings: list[Finding]
    warnings: list[Finding]
    facts_total: int = 0
    facts_checked: int = 0
    web_checked: int = 0
    readme_total: int = 0
    readme_checked: int = 0
    readme_printed: int = 0
    readme_pending: int = 0
    readme_unprinted: int = 0


class InputError(Exception):
    """A file this check needs is missing or cannot be parsed."""


def _read(root: Path, rel: str) -> str:
    path = root / rel
    try:
        return path.read_text(encoding="utf-8")
    except OSError as exc:
        raise InputError(f"cannot read {rel}: {exc}") from exc


def load_facts(root: Path) -> dict[str, Any]:
    try:
        data = json.loads(_read(root, FACTS_PATH))
    except json.JSONDecodeError as exc:
        raise InputError(f"{FACTS_PATH} is not valid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise InputError(f"{FACTS_PATH} is not a JSON object")
    return data


def _same_number(a: Any, b: Any) -> bool:
    if isinstance(a, int) and isinstance(b, int):
        return a == b
    return math.isclose(float(a), float(b), rel_tol=1e-9, abs_tol=0.0)


def check_schema(data: dict[str, Any], report: Report) -> dict[str, dict[str, Any]]:
    meta, facts = data.get("_meta"), data.get("facts")
    if set(data) != {"_meta", "facts"}:
        report.findings.append(Finding("_meta", FACTS_PATH, f"top level must be exactly _meta and facts, found {sorted(data)}"))
    if not isinstance(meta, dict) or meta.get("schema_version") != SCHEMA_VERSION:
        report.findings.append(Finding("_meta", FACTS_PATH, f"_meta.schema_version must be {SCHEMA_VERSION}"))
    if not isinstance(facts, dict):
        report.findings.append(Finding("facts", FACTS_PATH, "facts must be an object keyed by fact name"))
        return {}
    report.facts_total = len(facts)
    for key, fact in facts.items():
        problems = _fact_problems(key, fact)
        for problem in problems:
            report.findings.append(Finding(key, FACTS_PATH, problem))
        report.facts_checked += 1
    for key, (inputs, formula) in DERIVED.items():
        if key not in facts:
            report.findings.append(Finding(key, FACTS_PATH, "DERIVED in check_facts.py names a fact that FACTS.json does not have"))
            continue
        values = [_value(facts, name) for name in inputs]
        actual = _value(facts, key)
        if actual is None or any(v is None for v in values):
            continue
        expected = formula(*values)
        if not _same_number(expected, actual):
            report.findings.append(Finding(
                key, FACTS_PATH,
                f"value {actual!r} does not equal its formula from {', '.join(inputs)}: expected {expected!r}",
            ))
    for key in DISPLAY:
        if key not in facts:
            report.findings.append(Finding(key, FACTS_PATH, "DISPLAY in check_facts.py names a fact that FACTS.json does not have"))
    return facts


def _value(facts: dict[str, Any], key: str) -> Any:
    fact = facts.get(key)
    return fact.get("value") if isinstance(fact, dict) else None


def _fact_problems(key: str, fact: Any) -> list[str]:
    if not isinstance(fact, dict):
        return ["is not an object"]
    out = []
    for field in REQUIRED:
        if field not in fact:
            out.append(f"is missing the required field {field!r}")
    unknown = sorted(set(fact) - set(REQUIRED) - set(OPTIONAL))
    if unknown:
        out.append(f"has unknown fields {unknown} (allowed: {', '.join(REQUIRED + OPTIONAL)})")
    value, kind, status = fact.get("value"), fact.get("kind"), fact.get("status")
    if kind not in KINDS:
        out.append(f"kind {kind!r} is not one of {sorted(KINDS)}")
    if status not in STATUSES:
        out.append(f"status {status!r} is not one of {sorted(STATUSES)}")
    for field in ("unit", "source"):
        if field in fact and not (isinstance(fact[field], str) and fact[field].strip()):
            out.append(f"{field} must be a non-empty string")
    surfaces = fact.get("surfaces")
    if "surfaces" in fact:
        if not isinstance(surfaces, list) or not surfaces or not all(isinstance(s, str) for s in surfaces):
            out.append("surfaces must be a non-empty list of strings")
        else:
            bad = [s for s in surfaces if s not in SURFACES]
            if bad:
                out.append(f"surfaces {bad} are not known surfaces {sorted(SURFACES)}")
            if len(set(surfaces)) != len(surfaces):
                out.append("surfaces lists a surface twice")
    if isinstance(value, bool) or (value is not None and not isinstance(value, (str, int, float))):
        out.append(f"value must be a string, a number or null, not {type(value).__name__}")
    if status == "pending" and value is not None:
        out.append(f"status is pending but value is {value!r}; a pending value stays null")
    if status in VALUE_STATUSES and value is None:
        out.append(f"status is {status} but value is null")
    if value is not None:
        as_of = fact.get("as_of")
        if not isinstance(as_of, str) or not as_of:
            out.append("has a value but no as_of date")
        else:
            try:
                dt.datetime.fromisoformat(as_of)
            except ValueError:
                out.append(f"as_of {as_of!r} is not an ISO 8601 date")
    if "display" in fact:
        display = fact["display"]
        if value is None:
            out.append("has a display but no value")
        elif not isinstance(display, str) or not display:
            out.append("display must be a non-empty string")
        elif key not in DISPLAY:
            out.append(f"has display {display!r} but check_facts.py has no DISPLAY formatter for it; add one")
        else:
            try:
                expected = DISPLAY[key](value)
            except (ValueError, TypeError) as exc:
                out.append(f"cannot format value {value!r}: {exc}")
            else:
                if display != expected:
                    out.append(f"display {display!r} does not match value {value!r}: expected {expected!r}")
    if "caveat" in fact and not isinstance(fact["caveat"], str):
        out.append("caveat must be a string")
    return out


def _decode_ts_literal(lit: str) -> tuple[str, bool]:
    """(decoded text, is_string) for a TS string or number literal."""
    if lit.startswith('"'):
        return json.loads(lit), True
    if lit.startswith("'"):
        inner = lit[1:-1].replace("\\'", "'").replace('"', '\\"')
        return json.loads(f'"{inner}"'), True
    return lit, False


def _line_of(text: str, index: int) -> int:
    return text.count("\n", 0, index) + 1


def check_web(root: Path, facts: dict[str, dict[str, Any]], report: Report) -> None:
    text = _read(root, WEB_PATH)
    parsed = {m.group("name"): m for m in EXPORT_RX.finditer(text)}
    parsed_starts = {m.start() for m in parsed.values()}
    for any_export in EXPORT_ANY_RX.finditer(text):
        if any_export.start() not in parsed_starts:
            report.findings.append(Finding(
                "-", WEB_PATH,
                "an export this check cannot read (only `export const NAME = \"string\" | number;`); "
                "write it as a plain literal so it can be compared",
                _line_of(text, any_export.start()),
            ))
    for name, match in parsed.items():
        if name not in WEB_MIRRORS and name not in WEB_NOT_FACTS:
            report.findings.append(Finding(
                name, WEB_PATH,
                "exported constant is not classified: map it to its FACTS key in WEB_MIRRORS or say why it is not a fact in WEB_NOT_FACTS",
                _line_of(text, match.start()),
            ))
    for name, key in WEB_MIRRORS.items():
        if name in WEB_NOT_FACTS:
            report.findings.append(Finding(name, WEB_PATH, "is in both WEB_MIRRORS and WEB_NOT_FACTS"))
        match = parsed.get(name)
        if match is None:
            report.findings.append(Finding(key, WEB_PATH, f"WEB_MIRRORS expects `export const {name}`, which the file does not have"))
            continue
        line = _line_of(text, match.start())
        fact = facts.get(key)
        if not isinstance(fact, dict):
            report.findings.append(Finding(key, WEB_PATH, f"{name} maps to a fact FACTS.json does not have", line))
            continue
        report.web_checked += 1
        actual, is_string = _decode_ts_literal(match.group("lit"))
        value = fact.get("value")
        if value is None:
            report.findings.append(Finding(key, WEB_PATH, f"{name} = {actual!r} but the fact has no value (status {fact.get('status')})", line))
            continue
        expected = value if isinstance(value, str) else json.dumps(value)
        if is_string != isinstance(value, str) or actual != expected:
            report.findings.append(Finding(key, WEB_PATH, f"{name}: expected {expected!r}, actual {actual!r}", line))


def _slot_matches(slot: Slot, lines: list[str]) -> list[tuple[int, str]]:
    out = []
    for number, line in enumerate(lines, start=1):
        for pattern in slot.patterns:
            for match in re.finditer(pattern, line):
                out.append((number, match.group("v")))
    return out


def check_readme(root: Path, facts: dict[str, dict[str, Any]], report: Report) -> None:
    text = _read(root, README_PATH)
    lines = text.splitlines()
    declared = sorted(k for k, f in facts.items() if isinstance(f, dict) and "README" in (f.get("surfaces") or []))
    for key in README_SLOTS:
        if key not in declared:
            report.findings.append(Finding(key, README_PATH, "README_SLOTS has this key, but FACTS.json does not list README in its surfaces"))
    for key in declared:
        report.readme_total += 1
        _check_readme_fact(key, facts[key], text, lines, report)
        report.readme_checked += 1


def _check_readme_fact(key: str, fact: dict[str, Any], text: str, lines: list[str], report: Report) -> None:
    slot = README_SLOTS.get(key)
    if slot is None:
        report.findings.append(Finding(key, README_PATH, "lists README as a surface but check_facts.py has no README_SLOTS entry; add its wording and formatter"))
        return
    value = fact.get("value")
    matches = _slot_matches(slot, lines)
    if value is None or fact.get("status") == "pending":
        for line, shown in matches:
            if not PLACEHOLDER_RX.fullmatch(shown):
                report.findings.append(Finding(
                    key, README_PATH,
                    f"is {fact.get('status')} with no value, but README prints {shown!r}; expected placeholder wording ({PLACEHOLDER_WORDS})",
                    line,
                ))
        report.readme_pending += 1
        return
    expected = None
    if slot.fmt is not None:
        try:
            expected = slot.fmt(value)
        except (ValueError, TypeError) as exc:
            report.findings.append(Finding(key, README_PATH, f"cannot format value {value!r} for README: {exc}"))
            return
    if not matches:
        # A correct value printed in wording no slot knows: matched on its own, never inside
        # a longer token (a short number can sit inside a base58 signature).
        if expected is not None and re.search(rf"(?<![\w.,]){re.escape(expected)}(?!\w)", text):
            report.readme_printed += 1
            report.warnings.append(Finding(key, README_PATH, f"printed as {expected!r} in wording its slot patterns do not recognize; add that wording to README_SLOTS"))
        else:
            report.readme_unprinted += 1
            report.warnings.append(Finding(
                key, README_PATH,
                "has a value and lists README as a surface, but README does not print it yet "
                "(task 4.3 places it; or remove README from its surfaces)",
            ))
        return
    if expected is None:
        report.findings.append(Finding(key, README_PATH, "README prints this fact but README_SLOTS has no formatter for its value yet; add one", matches[0][0]))
        return
    ok = True
    for line, shown in matches:
        equal = shown == expected or (slot.prefix_ok and len(shown) >= 7 and expected.startswith(shown))
        if not equal:
            ok = False
            report.findings.append(Finding(key, README_PATH, f"expected {expected!r}, actual {shown!r}", line))
    if ok:
        report.readme_printed += 1


def run(root: Path) -> Report:
    report = Report(findings=[], warnings=[])
    facts = check_schema(load_facts(root), report)
    check_web(root, facts, report)
    check_readme(root, facts, report)
    if report.facts_total < 1:
        report.findings.append(Finding("facts", FACTS_PATH, "count floor: FACTS.json has no facts, so nothing was checked"))
    if report.facts_checked < report.facts_total:
        report.findings.append(Finding("facts", FACTS_PATH, f"count floor: checked {report.facts_checked} of {report.facts_total} facts"))
    if report.web_checked < len(WEB_MIRRORS):
        report.findings.append(Finding("web", WEB_PATH, f"count floor: compared {report.web_checked} of {len(WEB_MIRRORS)} mirrored constants"))
    if report.readme_total < 1 or report.readme_checked < report.readme_total:
        report.findings.append(Finding(
            "README", README_PATH,
            f"count floor: checked {report.readme_checked} of {report.readme_total} facts that list README (at least 1 required)",
        ))
    return report


def _emit(kind: str, finding: Finding, annotate: bool) -> None:
    where = finding.surface + (f":{finding.line}" if finding.line else "")
    print(f"{kind} {finding.key} on {where}: {finding.message}")
    if annotate:
        level = "error" if kind == "FAIL" else "warning"
        props = []
        if finding.surface in (FACTS_PATH, WEB_PATH, README_PATH):
            props.append(f"file={finding.surface}")
            if finding.line:
                props.append(f"line={finding.line}")
        head = f"::{level} {','.join(props)}::" if props else f"::{level}::"
        print(f"{head}FACTS {finding.key}: {finding.message}")


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--root", default=str(Path(__file__).resolve().parents[2]), help="repository root")
    parser.add_argument("--strict", action="store_true", help="fail on facts declared on README that README does not print yet")
    args = parser.parse_args(argv)
    try:
        report = run(Path(args.root))
    except InputError as exc:
        print(f"ERROR {exc}")
        return 2
    annotate = os.environ.get("GITHUB_ACTIONS") == "true"
    if args.strict:
        unprinted = [w for w in report.warnings if "does not print it yet" in w.message]
        report.findings.extend(unprinted)
        report.warnings = [w for w in report.warnings if w not in unprinted]
    for finding in report.findings:
        _emit("FAIL", finding, annotate)
    for warning in report.warnings:
        _emit("WARN", warning, annotate)
    print(
        f"FACTS check: {report.facts_checked} of {report.facts_total} facts checked (floor {report.facts_total}); "
        f"surfaces: {report.web_checked} web/lib/facts.ts constants and {report.readme_checked} of {report.readme_total} README entries "
        f"({report.readme_printed} printed and equal, {report.readme_pending} pending with no number, "
        f"{report.readme_unprinted} with a value not printed yet); "
        f"{len(report.findings)} findings, {len(report.warnings)} warnings."
    )
    return 1 if report.findings else 0


if __name__ == "__main__":
    sys.exit(main())
