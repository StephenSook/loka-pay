#!/usr/bin/env python3
"""Prose gate for LOKA Pay (pre-event kit). Python 3 stdlib only.

Checks the lines WE wrote, so imported LOKA text is exempt by construction:
  1. no em dash (U+2014) and no en dash (U+2013) in any added line of a text file;
  2. no AI-tone words in added lines of markdown files.

Modes:
  --base REF [--head REF]   every line added between REF and HEAD (what CI runs)
  --files PATH [PATH ...]   every line of the given files (a local check before committing)

Exit codes: 0 clean, 1 findings, 2 usage or git error.
"""

import argparse
import fnmatch
import re
import subprocess
import sys

# Built from code points so this file itself contains neither character.
DASHES = {chr(0x2014): "em dash", chr(0x2013): "en dash"}
TONE_WORDS = [
    "leverage", "leverages", "leveraging", "robust", "comprehensive", "seamless",
    "seamlessly", "powerful", "sophisticated", "elevate", "empower", "intuitive",
    "cutting-edge", "revolutionary", "amazing", "effortless", "effortlessly",
    "streamline", "unlock", "unlocked", "ecosystem", "delve", "game-changer",
    "easily", "simply",
]
TONE_PHRASES = ["it's worth noting", "it is worth noting", "it's important to remember", "not only"]
TONE_RX = re.compile(r"\b(" + "|".join(re.escape(w) for w in TONE_WORDS) + r")\b|"
                     + "|".join(re.escape(p) for p in TONE_PHRASES), re.I)
# Imported or vendored text that may arrive as "added" lines (a moved LOKA README,
# archived LOKA files, the games catalog). Our own files are never exempt.
DEFAULT_EXEMPT = ["LOKA-README.md", "docs/archive/*", "gameJson/*"]


def check_line(path, lineno, text, findings):
    for ch, name in DASHES.items():
        if ch in text:
            findings.append("%s:%d: %s: %s" % (path, lineno, name, text.strip()[:120]))
    if path.lower().endswith((".md", ".mdx")):
        m = TONE_RX.search(text)
        if m:
            findings.append("%s:%d: AI-tone word %r: %s" % (path, lineno, m.group(0), text.strip()[:120]))


def scan_diff(base, head, exempt):
    rev = subprocess.run(["git", "rev-parse", "--verify", "-q", base + "^{commit}"],
                         capture_output=True, text=True)
    if rev.returncode != 0:
        print("prose_gate: ERROR: base %r is not a commit in this clone (fetch tags with full history)" % base,
              file=sys.stderr)
        return None, 0
    proc = subprocess.run(["git", "-c", "core.quotePath=false", "diff", "-U0", "--no-color", "--no-ext-diff",
                           "-M", "-C", base, head], capture_output=True)
    if proc.returncode != 0:
        print("prose_gate: ERROR: git diff failed: %s" % proc.stderr.decode("utf-8", "replace"), file=sys.stderr)
        return None, 0
    findings, scanned = [], 0
    path, lineno = None, 0
    for raw in proc.stdout.decode("utf-8", "replace").split("\n"):
        if raw.startswith("diff --git "):
            path = None
        elif raw.startswith("+++ "):
            target = raw[4:]
            path = None if target == "/dev/null" else target[2:] if target.startswith("b/") else target
            if path and any(fnmatch.fnmatch(path, g) for g in exempt):
                path = None
        elif raw.startswith("@@"):
            m = re.match(r"@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@", raw)
            lineno = int(m.group(1)) if m else 0
        elif raw.startswith("+") and path is not None:
            scanned += 1
            check_line(path, lineno, raw[1:], findings)
            lineno += 1
    return findings, scanned


def scan_files(paths):
    findings, scanned = [], 0
    for path in paths:
        with open(path, "rb") as fh:
            data = fh.read()
        if b"\x00" in data[:8192]:
            continue
        for lineno, text in enumerate(data.decode("utf-8", "replace").split("\n"), 1):
            scanned += 1
            check_line(path, lineno, text, findings)
    return findings, scanned


def main(argv):
    ap = argparse.ArgumentParser(description="No em or en dashes and no AI-tone words in lines we wrote.")
    ap.add_argument("--base", help="commit-ish to diff from (CI: the pre-hacklanta-foundation tag)")
    ap.add_argument("--head", default="HEAD")
    ap.add_argument("--files", nargs="+", help="scan these files completely instead of a diff")
    ap.add_argument("--exempt", action="append", default=[], help="extra glob to exempt in diff mode")
    args = ap.parse_args(argv)
    if bool(args.base) == bool(args.files):
        print("prose_gate: ERROR: give exactly one of --base or --files", file=sys.stderr)
        return 2
    if args.files:
        findings, scanned = scan_files(args.files)
    else:
        findings, scanned = scan_diff(args.base, args.head, DEFAULT_EXEMPT + args.exempt)
        if findings is None:
            return 2
    for f in findings:
        print(f)
    print("prose_gate: %d added lines scanned, %d findings" % (scanned, len(findings)))
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
