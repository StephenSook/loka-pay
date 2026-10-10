#!/usr/bin/env python3
"""No analytics, error tracking or tracking scripts anywhere we ship (PLAN.md task 3.55).

/privacy says the site "runs no analytics or tracking" and the app sends nothing to us,
so this guard fails CI if any of these appear:

- an analytics or error-tracking package in a package.json or pnpm-lock.yaml (direct
  and transitive), a Gradle file, Package.swift / project.pbxproj, or a Cargo.toml;
- a tracker host (Google Analytics, Tag Manager, Segment, PostHog, Vercel Web Analytics
  and others) in web source.

It matches package identifiers and hosts, never bare words: "amplitude" is also an
audio level in VoiceNote.kt.

The file set is every tracked file plus untracked files gitignore does not exclude, so a
new file is checked before it is committed. The guard's own files are excluded by git
pathspec. A walk below --min-files, or one that misses a --require manifest, fails: a
scan that walked nothing must not read as clean.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

SELF = ["tools/hygiene/no_tracking.py", "tools/hygiene/test_no_tracking.py"]

NPM_EXACT = {
    "@vercel/analytics", "@vercel/speed-insights", "posthog-js", "posthog-node",
    "mixpanel", "mixpanel-browser", "amplitude-js", "analytics-node", "react-ga",
    "react-ga4", "ga-4-react", "logrocket", "plausible-tracker", "newrelic", "hotjar",
    "react-hotjar", "firebase", "rollbar", "raygun4js", "heap-api",
}
NPM_SCOPES = (
    "@sentry/", "@amplitude/", "@segment/", "@datadog/", "@bugsnag/", "@newrelic/",
    "@hotjar/", "@fullstory/", "@firebase/", "@posthog/", "@mixpanel/",
    "@google-analytics/", "@rollbar/",
)
GRADLE = re.compile(
    r"com\.google\.firebase|io\.sentry|com\.mixpanel|com\.amplitude|com\.posthog|"
    r"com\.segment|com\.bugsnag|com\.newrelic|com\.datadoghq|"
    r"com\.google\.android\.gms:play-services-(analytics|measurement)"
)
APPLE = re.compile(
    r"firebase-ios-sdk|sentry-cocoa|mixpanel-swift|mixpanel-iphone|amplitude-ios|"
    r"amplitude-swift|posthog-ios|analytics-swift|analytics-ios|bugsnag-cocoa|"
    r"dd-sdk-ios|newrelic-ios",
    re.IGNORECASE,
)
CARGO = re.compile(r"^\s*(sentry|posthog-rs|segment)\s*=", re.MULTILINE)
HOSTS = re.compile(
    r"googletagmanager\.com|google-analytics\.com|plausible\.io|cdn\.segment\.com|"
    r"api\.segment\.io|static\.hotjar\.com|cdn\.mxpnl\.com|sentry-cdn\.com|ingest\.sentry\.io|"
    r"i\.posthog\.com|app\.posthog\.com|cdn\.amplitude\.com|api2\.amplitude\.com|"
    r"vitals\.vercel-insights\.com|va\.vercel-scripts\.com|/_vercel/insights|"
    r"/_vercel/speed-insights|\bgtag\(",
)
WEB_SOURCE = re.compile(r"^web/.*\.(tsx?|jsx?|mjs|cjs|html)$")
LOCK_KEY = re.compile(r"^ {2}'?(@?[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)?)@", re.MULTILINE)


def tracked_files(root: Path) -> list[str]:
    out = subprocess.run(
        ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "."]
        + [f":(exclude){p}" for p in SELF],
        cwd=root, check=True, capture_output=True,
    ).stdout
    return sorted({p for p in out.decode().split("\0") if p and (root / p).is_file()})


def denied_npm(name: str) -> bool:
    return name in NPM_EXACT or name.startswith(NPM_SCOPES)


def scan(root: Path, files: list[str]) -> tuple[list[str], set[str]]:
    hits: list[str] = []
    manifests: set[str] = set()
    for rel in files:
        base = rel.rsplit("/", 1)[-1]
        path = root / rel
        if base == "package.json":
            manifests.add(rel)
            data = json.loads(path.read_text())
            for section in ("dependencies", "devDependencies", "optionalDependencies", "peerDependencies"):
                for name in data.get(section, {}):
                    if denied_npm(name):
                        hits.append(f"{rel}: {section} has {name}")
        elif base == "pnpm-lock.yaml":
            manifests.add(rel)
            for name in sorted(set(LOCK_KEY.findall(path.read_text()))):
                if denied_npm(name):
                    hits.append(f"{rel}: locks {name}")
        elif base in ("build.gradle", "build.gradle.kts", "libs.versions.toml"):
            manifests.add(rel)
            for m in GRADLE.finditer(path.read_text()):
                hits.append(f"{rel}: depends on {m.group(0)}")
        elif base in ("Package.swift", "Package.resolved", "project.pbxproj", "Podfile"):
            manifests.add(rel)
            for m in APPLE.finditer(path.read_text(errors="replace")):
                hits.append(f"{rel}: references {m.group(0)}")
        elif base == "Cargo.toml":
            manifests.add(rel)
            for m in CARGO.finditer(path.read_text()):
                hits.append(f"{rel}: depends on crate {m.group(1)}")
        if WEB_SOURCE.match(rel):
            for m in HOSTS.finditer(path.read_text(errors="replace")):
                hits.append(f"{rel}: tracker {m.group(0)}")
    return hits, manifests


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--root", default=".")
    ap.add_argument("--min-files", type=int, default=500)
    ap.add_argument(
        "--require", nargs="*",
        default=[
            "web/package.json", "web/pnpm-lock.yaml", "ios/LokaPay/Package.swift",
            "ios/LOKA.xcodeproj/project.pbxproj", "android/loka-mesh-lab/app/build.gradle.kts",
            "programs/loka_vault/Cargo.toml",
        ],
    )
    args = ap.parse_args(argv)
    root = Path(args.root).resolve()
    files = tracked_files(root)
    hits, manifests = scan(root, files)
    problems = list(hits)
    if len(files) < args.min_files:
        problems.append(f"walked only {len(files)} files, floor is {args.min_files}: the scan saw too little to call clean")
    for rel in args.require:
        if rel not in manifests:
            problems.append(f"required manifest {rel} was not scanned")
    for p in problems:
        print(f"no_tracking: {p}")
    print(f"no_tracking: {len(files)} files walked, {len(manifests)} manifests read, {len(hits)} findings")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
