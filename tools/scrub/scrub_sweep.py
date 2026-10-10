#!/usr/bin/env python3
"""Read-only scrub sweep for a source tree. Python 3 stdlib only.

Prepared before Hacklanta II (disclosed as a pre-event repo-prep tool). It never
modifies files. It walks a tree, applies a fixed set of identifier and secret
patterns, and reports counts per pattern and per file. Every value it prints is
MASKED (a length plus a short SHA-256 prefix, or a domain only), so a report can
be pasted into a private note without leaking what it found.

Usage:
  python3 scrub_sweep.py ROOT [--literal VALUE ...] [--allow-team TEAMID]
                              [--allowlist FILE] [--exclude GLOB ...]
                              [--json OUT] [--fail-on-hits] [--top N]
                              [--git-index | --git-tree REV]
                              [--expect-files N] [--min-files N]

What is swept: by default every file under ROOT (a folder walk). With --git-index,
exactly the files staged in the git repo at ROOT, read from the staged blobs (what
the next commit will contain, not what the folder happens to hold); with --git-tree
REV, the files of that commit, read from git objects (a read-only scan of another
repo). --expect-files N fails the run unless exactly N files were read, and
--min-files N (default 1) unless at least N were: a sweep that read fewer files than
it should have can never read as clean.

Exit codes:
  0  report produced (and, with --fail-on-hits, zero non-allowlisted hits)
  1  --fail-on-hits was given and at least one non-allowlisted hit remains
  2  usage error, unreadable root, the walk visited zero files (a sweep that
     walked nothing must never read as clean), or a file could not be fully
     scanned (unreadable file or folder, not a regular file, malformed PNG text
     chunk, unreadable or oversized archive). Nothing is ever silently skipped:
     binary files are reduced to printable ASCII/UTF-8/UTF-16 runs, zip and gzip
     archives (jar, apk, aab) are opened and their members scanned.

Allowlist file format (one rule per line, # starts a comment):
  <pattern_id><TAB><glob relative to ROOT><TAB><sha256 of the exact matched value>
  e.g.  hex64<TAB>protocol/test-vectors/v1.json<TAB><64 lowercase hex characters>
A rule allows ONE value of ONE pattern in matching paths: a new value in the same
file is still a hit. The value itself never appears in the file, only its SHA-256.
To review new hits, run with --suggest-allowlist OUT: it writes one candidate rule
per distinct (pattern, path, value) hit; the masked samples go to stderr only, so
the OUT file can never carry them into a repository.
Hex64 values inside the allowlist file itself are accepted only when they are the
hash column of one of its own rules (the allowlist is swept like any other file).

The allowlist that ships in a public repo may only name values that the public tree
already contains (a plain SHA-256 of a short value such as a serial or a team id can
be brute-forced). An exception about a value that must not be published belongs in a
PRIVATE allowlist outside the repo (--private-allowlist), whose third column is
HMAC-SHA256 keyed with --private-key (a file of 32+ random bytes, mode 600, outside
the repo). --suggest-private makes --suggest-allowlist write HMAC digests instead.
--write-used-allowlist OUT writes the public rules that matched in this tree, which is
how the import builds the published allowlist.
"""

import argparse
import errno
import fnmatch
import hashlib
import hmac
import io
import json
import os
import re
import stat
import struct
import subprocess
import sys
import zipfile
import zlib
from collections import Counter, defaultdict

# File extensions that are never parsed as text. Their printable runs are scanned
# instead (see binary_strings); PNGs also get a text-chunk pass.
BINARY_EXT = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".heic", ".ico", ".icns", ".pdf",
    ".ttf", ".otf", ".woff", ".woff2", ".zip", ".gz", ".jar", ".apk", ".aab",
    ".so", ".a", ".dylib", ".class", ".bin", ".mp3", ".mp4", ".mov", ".wav",
    ".keystore", ".jks", ".car",
}

# A file "TLD" that means the email pattern matched an asset name like icon@2x.png.
ASSET_TLDS = {
    "png", "jpg", "jpeg", "gif", "svg", "webp", "pdf", "heic", "json", "swift",
    "kt", "kts", "md", "txt", "xml", "plist", "ttf", "otf", "java", "py", "sh",
    "js", "ts", "tsx", "css", "html", "yml", "yaml", "gradle", "xcassets",
}

PATTERNS = [
    ("email", re.compile(
        r"(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*"
        r"\.([A-Za-z]{2,24})(?![A-Za-z0-9-])")),
    ("phone_e164", re.compile(r"(?<![\w+])\+[1-9]\d{7,14}(?!\d)")),
    ("phone_nanp", re.compile(r"(?<![\d-])\(?\b[2-9]\d{2}\)?[ .-]\d{3}[ .-]\d{4}\b(?!-)")),
    ("mac_address", re.compile(
        r"(?<![0-9A-Fa-f:-])(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}(?![0-9A-Fa-f:-])")),
    ("hex64", re.compile(r"(?<![0-9A-Fa-f])[0-9A-Fa-f]{64}(?![0-9A-Fa-f])")),
    # 8-4-4-4-12 hex (RFC 4122 layout, any version): device and install ids, but also
    # protocol constants such as BLE service UUIDs, which are allowlisted by exact value.
    ("uuid", re.compile(
        r"(?<![0-9A-Fa-f-])[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}"
        r"(?![0-9A-Fa-f-])")),
    # Bare 40-hex: SHA-1 key fingerprints, iOS UDIDs, git object ids.
    ("hex40", re.compile(r"(?<![0-9A-Fa-f])[0-9A-Fa-f]{40}(?![0-9A-Fa-f])")),
    ("private_key", re.compile(r"PRIVATE KEY")),
    ("sk_key", re.compile(
        r"(?<![A-Za-z0-9_])sk_(?:live|test)_[A-Za-z0-9]{8,}"
        r"|(?<![A-Za-z0-9_-])sk-(?:proj-)?[A-Za-z0-9_-]{20,}"
        r"|(?<![A-Za-z0-9_])sk_[A-Za-z0-9]{20,}")),
    ("aws_access_key", re.compile(r"(?<![A-Z0-9])(?:AKIA|ASIA)[0-9A-Z]{16}(?![A-Z0-9])")),
    ("jwt", re.compile(
        r"(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}")),
    ("home_path", re.compile(
        r"(?:/Users/|/home/)(?!Shared[/\s])([A-Za-z0-9._-]+)"
        r"|[A-Za-z]:\\\\?Users\\\\?([A-Za-z0-9._-]+)")),
    # Samsung-style ADB serial (R + 10 upper-alnum with at least two digits), or any
    # concrete value passed to `adb -s` (placeholders like DEVICE_SERIAL are skipped).
    ("adb_serial", re.compile(
        r"(?<![A-Za-z0-9])R(?=[0-9A-Z]{10}(?![A-Za-z0-9]))(?=(?:[A-Z]*[0-9]){2})[0-9A-Z]{10}"
        r"|adb\s+-s\s+(?!DEVICE_SERIAL\b|SERIAL\b|\$|<)[A-Za-z0-9._:-]{6,}")),
    ("device_model", re.compile(
        r"(?<![A-Za-z0-9-])SM-[A-Z][0-9]{3,4}[A-Z0-9]{0,3}(?![A-Za-z0-9])"
        r"|(?<![A-Za-z0-9])(?:iPhone|iPad|iPod)\d{1,2},\d{1,2}(?![0-9])")),
    # Any Apple team id in a project file, or a TEAMID.reverse.dns application id.
    ("dev_team", re.compile(
        r"DEVELOPMENT_TEAM\s*=\s*\"?([A-Z0-9]{10})\"?\s*;"
        r"|(?<![A-Za-z0-9])([A-Z0-9]{10})\.(?:org|com|io|dev|app)\.[A-Za-z0-9-]+")),
]


def sha8(value):
    return hashlib.sha256(value.encode("utf-8", "replace")).hexdigest()[:8]


def mask(pid, match):
    """Return a masked, non-reversible description of one match."""
    raw = match.group(0)
    if pid == "email":
        domain = raw.split("@", 1)[1]
        return "***@" + domain
    if pid in ("phone_e164", "phone_nanp"):
        digits = re.sub(r"\D", "", raw)
        return "phone(len %d, h:%s)" % (len(digits), sha8(digits))
    if pid == "home_path":
        user = match.group(1) or match.group(2) or ""
        prefix = raw[: raw.find(user)] if user else raw
        return "%s%s*(%d chars, h:%s)" % (prefix, user[:1], len(user), sha8(user))
    if pid == "device_model":
        return raw  # public product model numbers, not identifiers of a person
    if pid == "private_key":
        text = match.string
        start = text.rfind("\n", 0, match.start()) + 1
        end = text.find("\n", match.end())
        line = text[start:end if end != -1 else len(text)]
        kind = "pem_block" if ("BEGIN" in line and "-----" in line) else "mention"
        return "PRIVATE KEY (%s)" % kind
    if pid == "dev_team":
        team = match.group(1) or match.group(2) or ""
        return "team(%s%s%s, h:%s)" % (team[:2], "*" * max(0, len(team) - 4), team[-2:], sha8(team))
    return "%s(len %d, h:%s)" % (pid, len(raw), sha8(raw))


def team_of(match):
    return match.group(1) or match.group(2) or ""


SHA256_RX = re.compile(r"[0-9a-f]{64}")


def sha256_full(value):
    return hashlib.sha256(value.encode("utf-8", "surrogateescape")).hexdigest()


def allowlist_error(msg):
    print("ERROR: " + msg, file=sys.stderr)
    raise SystemExit(2)


def load_allowlist(path, known_pids):
    """Return a list of (pattern_id, glob, sha256) rules. Fails loudly (exit 2) on any bad line."""
    rules = []
    if not path:
        return rules
    with open(path, encoding="utf-8") as fh:
        for n, line in enumerate(fh, 1):
            line = line.rstrip("\r\n")
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            parts = line.split("\t")
            if len(parts) != 3:
                allowlist_error("allowlist line %d is not '<pattern_id><TAB><glob><TAB><sha256 of the value>' "
                                "(path-only rules are no longer accepted; see --suggest-allowlist)" % n)
            pid, glob, digest = (x.strip() for x in parts)
            if pid not in known_pids:
                allowlist_error("allowlist line %d: unknown pattern id %r" % (n, pid))
            if not glob:
                allowlist_error("allowlist line %d: empty path glob" % n)
            if not SHA256_RX.fullmatch(digest):
                allowlist_error("allowlist line %d: the third column must be 64 lowercase hex characters" % n)
            rules.append((pid, glob, digest))
    return rules


def allowed(rules, pid, rel, digest, used):
    for i, (rule_pid, glob, rule_digest) in enumerate(rules):
        if rule_pid == pid and rule_digest == digest and fnmatch.fnmatchcase(rel, glob):
            used.add(i)
            return True
    return False


def load_private_key(path):
    """32+ random bytes from a regular file that only its owner can read (mode 600)."""
    try:
        info = os.lstat(path)
    except OSError:
        allowlist_error("private key file not found: %s" % path)
    if not stat.S_ISREG(info.st_mode):
        allowlist_error("private key must be a regular file (not a link): %s" % path)
    if info.st_mode & 0o077:
        allowlist_error("private key must be readable by its owner only (chmod 600): %s" % path)
    with open(path, "rb") as fh:
        key = fh.read()
    if len(key) < 32:
        allowlist_error("private key must hold at least 32 random bytes: %s" % path)
    return key


def hmac_full(key, value):
    return hmac.new(key, value.encode("utf-8", "surrogateescape"), hashlib.sha256).hexdigest()


def open_new(path):
    """Open a NEW text file for writing: never follows a symbolic link and never
    overwrites anything (O_CREAT | O_EXCL | O_NOFOLLOW), so a planted link cannot
    redirect a report into another file."""
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    return os.fdopen(fd, "w", encoding="utf-8")


def write_used_allowlist(src_path, used, out_path):
    """Copy the allowlist keeping only rules in `used` (by index) and the comments that
    introduce kept rules. The header (comments before the first rule) is always kept."""
    blocks, cur_comments, cur_rules, idx = [], [], [], 0
    header, seen_rule = [], False
    with open(src_path, encoding="utf-8") as fh:
        for line in fh:
            line = line.rstrip("\r\n")
            if not line.strip():
                continue
            if line.lstrip().startswith("#"):
                if not seen_rule:
                    header.append(line)
                    continue
                if cur_rules:
                    blocks.append((cur_comments, cur_rules))
                    cur_comments, cur_rules = [], []
                cur_comments.append(line)
                continue
            seen_rule = True
            if idx in used:
                cur_rules.append(line)
            idx += 1
    blocks.append((cur_comments, cur_rules))
    out = list(header)
    for comments, kept in blocks:
        if kept:
            out.extend(comments)
            out.extend(kept)
    with open_new(out_path) as fh:
        fh.write("\n".join(out) + "\n")


# A printable run: ASCII (plus tab) or well-formed UTF-8 multibyte sequences, 6 or more.
# Catches EXIF/XMP/C2PA text in images, JPEG comments, and logs that contain NUL bytes.
STRINGS_RX = re.compile(
    rb"(?:[\x20-\x7e\t]|[\xc2-\xdf][\x80-\xbf]|[\xe0-\xef][\x80-\xbf]{2}|[\xf0-\xf4][\x80-\xbf]{3}){6,}")


# The same for UTF-16 text (Windows-style strings, .strings files, TTF name tables).
UTF16LE_RX = re.compile(rb"(?:[\x20-\x7e\t]\x00){6,}")
UTF16BE_RX = re.compile(rb"(?:\x00[\x20-\x7e\t]){6,}")
# Archives are opened, never skipped. Past these limits the sweep fails rather than skip.
MAX_INFLATED = 512 * 1024 * 1024
MAX_DEPTH = 3


def gunzip_all(data):
    """The full content of a gzip stream, all members (a concatenation of gzip members
    is one file to gunzip). Raises ValueError on a truncated member, on any trailing
    data that is not another member, or past MAX_INFLATED in total."""
    out, rest, total, n = [], data, 0, 0
    while rest:
        if not rest.startswith(b"\x1f\x8b"):
            raise ValueError("trailing data after gzip member %d" % n)
        d = zlib.decompressobj(16 + zlib.MAX_WBITS)
        try:
            chunk = d.decompress(rest, MAX_INFLATED - total + 1)
        except zlib.error as exc:
            raise ValueError("gzip member %d does not inflate (%s)" % (n + 1, exc))
        total += len(chunk)
        if total > MAX_INFLATED or d.unconsumed_tail:
            raise ValueError("gzip inflates past %d bytes" % MAX_INFLATED)
        if not d.eof:
            raise ValueError("gzip member %d is truncated" % (n + 1))
        out.append(chunk)
        n += 1
        rest = d.unused_data
    return b"".join(out), n


def binary_strings(data):
    """Printable runs of a binary file, one per line, so no match spans two runs."""
    runs = [m.group(0).decode("utf-8", "replace") for m in STRINGS_RX.finditer(data)]
    runs += [m.group(0).decode("utf-16-le", "replace") for m in UTF16LE_RX.finditer(data)]
    runs += [m.group(0).decode("utf-16-be", "replace") for m in UTF16BE_RX.finditer(data)]
    return "\n".join(runs)


def png_text_chunks(data):
    """Yield (chunk_type, keyword, text) for tEXt/zTXt/iTXt chunks and eXIf presence.
    Raises ValueError on a truncated or undecodable chunk: unread text is never 'clean'."""
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        return
    pos = 8
    while pos + 8 <= len(data):
        length, = struct.unpack(">I", data[pos:pos + 4])
        ctype = data[pos + 4:pos + 8].decode("latin-1")
        if pos + 12 + length > len(data):
            raise ValueError("truncated PNG chunk %r" % ctype)
        body = data[pos + 8:pos + 8 + length]
        pos += 12 + length
        try:
            if ctype == "tEXt":
                key, _, text = body.partition(b"\x00")
                yield ctype, key.decode("latin-1"), text.decode("latin-1")
            elif ctype == "zTXt":
                key, _, rest = body.partition(b"\x00")
                yield ctype, key.decode("latin-1"), zlib.decompress(rest[1:]).decode("latin-1", "replace")
            elif ctype == "iTXt":
                key, _, rest = body.partition(b"\x00")
                comp_flag = rest[0:1]
                rest = rest[2:]
                _lang, _, rest = rest.partition(b"\x00")
                _tkey, _, text = rest.partition(b"\x00")
                if comp_flag == b"\x01":
                    text = zlib.decompress(text)
                yield ctype, key.decode("latin-1"), text.decode("utf-8", "replace")
            elif ctype == "eXIf":
                yield ctype, "exif", body.decode("latin-1")
        except (zlib.error, IndexError, UnicodeDecodeError) as exc:
            raise ValueError("undecodable PNG %s chunk (%s)" % (ctype, exc.__class__.__name__))
        if ctype == "IEND":
            break


class Scanner:
    """Every pattern over every byte of a file: text, printable runs of binary files,
    PNG text chunks, and the members of zip and gzip archives. Nothing is skipped:
    anything that cannot be read fully lands in .errors, and callers fail on errors."""

    def __init__(self, patterns):
        self.patterns = patterns
        self.st = Counter()  # text, binary, png, png_with_text, binary_bytes, archive_members
        self.errors = []
        self.png_keywords = Counter()
        self.ext_binary = Counter()

    def _text(self, text, rel):
        for pid, rx in self.patterns:
            for m in rx.finditer(text):
                yield pid, rel, m

    def blob(self, rel, name, data, depth=0):
        """Yield (pattern_id, rel#pass, match) for one file's bytes."""
        st = self.st
        ext = os.path.splitext(name)[1].lower()
        if data.startswith(b"PK\x03\x04") or data.startswith(b"PK\x05\x06"):
            st["binary"] += 1
            self.ext_binary[ext or "<zip>"] += 1
            yield from self._text(binary_strings(data), rel + "#strings")
            if depth >= MAX_DEPTH:
                self.errors.append("%s: archive nested deeper than %d levels" % (rel, MAX_DEPTH))
                return
            try:
                with zipfile.ZipFile(io.BytesIO(data)) as zf:
                    infos = [i for i in zf.infolist() if not i.is_dir()]
                    if sum(i.file_size for i in infos) > MAX_INFLATED:
                        self.errors.append("%s: archive inflates past %d bytes" % (rel, MAX_INFLATED))
                        return
                    members = [(i.filename, zf.read(i)) for i in infos]
            except (zipfile.BadZipFile, RuntimeError, NotImplementedError, OSError, EOFError, zlib.error) as exc:
                self.errors.append("%s: cannot read archive (%s)" % (rel, exc.__class__.__name__))
                return
            for mname, mdata in members:
                st["archive_members"] += 1
                yield from self.blob(rel + "#zip:" + mname, mname, mdata, depth + 1)
            return
        if data.startswith(b"\x1f\x8b"):
            st["binary"] += 1
            self.ext_binary[ext or "<gzip>"] += 1
            yield from self._text(binary_strings(data), rel + "#strings")
            try:
                inner, members = gunzip_all(data)
            except ValueError as exc:
                self.errors.append("%s: %s" % (rel, exc))
                return
            st["gzip_members"] += members
            if depth >= MAX_DEPTH:
                self.errors.append("%s: archive nested deeper than %d levels" % (rel, MAX_DEPTH))
                return
            st["archive_members"] += 1
            yield from self.blob(rel + "#gunzip", name[:-3] if name.endswith(".gz") else name, inner, depth + 1)
            return
        if data.startswith(b"\x89PNG\r\n\x1a\n"):
            st["png"] += 1
            st["binary"] += 1
            self.ext_binary[".png"] += 1
            found = False
            try:
                chunks = list(png_text_chunks(data))
            except ValueError as exc:
                self.errors.append("%s: %s" % (rel, exc))
                chunks = []
            for ctype, key, text in chunks:
                found = True
                self.png_keywords["%s:%s" % (ctype, key)] += 1
                yield from self._text(text, rel + "#png-text")
            st["png_with_text"] += 1 if found else 0
            st["binary_bytes"] += len(data)
            yield from self._text(binary_strings(data), rel + "#strings")
            return
        if data.startswith(b"\xff\xfe") or data.startswith(b"\xfe\xff"):
            # UTF-16 text with a byte-order mark: decode it as text, not as bytes.
            st["text"] += 1
            yield from self._text(data.decode("utf-16", "replace"), rel)
            return
        if ext in BINARY_EXT or b"\x00" in data[:8192]:
            st["binary"] += 1
            st["binary_bytes"] += len(data)
            self.ext_binary[ext or "<none>"] += 1
            yield from self._text(binary_strings(data), rel + "#strings")
            return
        st["text"] += 1
        yield from self._text(data.decode("utf-8", "replace"), rel)
        if b"\x00" in data:  # NUL past the first 8 KB: also scan the runs, as for binaries
            yield from self._text(binary_strings(data), rel + "#strings")


# Every git call runs without the caller's GIT_* variables (GIT_DIR, GIT_WORK_TREE,
# GIT_INDEX_FILE, GIT_OBJECT_DIRECTORY, GIT_CONFIG_*, ...), which could point it at
# another repository, and with optional locks off (never refresh another repo's index).
GIT_ENV = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
GIT_ENV["GIT_OPTIONAL_LOCKS"] = "0"


def git_entries(repo, rev=None):
    """[(mode, object_id, stage, path)] for the index of `repo` (rev None) or a commit's tree."""
    if rev is None:
        argv = ["git", "-C", repo, "ls-files", "-s", "-z"]
    else:
        argv = ["git", "-C", repo, "ls-tree", "-r", "-z", "--full-tree", rev]
    out = subprocess.run(argv, check=True, capture_output=True, env=GIT_ENV).stdout
    entries = []
    for rec in out.split(b"\0"):
        if not rec:
            continue
        meta, path = rec.split(b"\t", 1)
        parts = meta.decode("ascii").split(" ")
        if rev is None:
            mode, oid, stage = parts
        else:
            mode, _typ, oid = parts
            stage = "0"
        entries.append((mode, oid, stage, path.decode("utf-8", "surrogateescape")))
    return entries


def git_blobs(repo, entries, errors):
    """Yield (path, data) for regular-file entries; links, submodules and unmerged
    entries are errors (a sweep must never pass over something it did not read)."""
    proc = subprocess.Popen(["git", "-C", repo, "cat-file", "--batch"], stdin=subprocess.PIPE,
                            stdout=subprocess.PIPE, env=GIT_ENV)
    try:
        for mode, oid, stage, path in entries:
            if stage != "0":
                errors.append("%s: unmerged index entry (stage %s)" % (path, stage))
                continue
            if mode == "120000":
                errors.append("%s: symbolic link" % path)
                continue
            if mode not in ("100644", "100755"):
                errors.append("%s: not a regular file (git mode %s)" % (path, mode))
                continue
            proc.stdin.write((oid + "\n").encode("ascii"))
            proc.stdin.flush()
            header = proc.stdout.readline().split()
            if len(header) != 3 or header[1] != b"blob":
                errors.append("%s: cannot read blob %s" % (path, oid))
                continue
            size = int(header[2])
            data = proc.stdout.read(size)
            proc.stdout.read(1)
            if len(data) != size:
                errors.append("%s: short read of blob %s" % (path, oid))
                continue
            yield path, data
    finally:
        proc.stdin.close()
        proc.stdout.close()
        proc.wait()


def main(argv):
    try:
        return run(argv)
    except (FileExistsError, IsADirectoryError) as exc:
        print("ERROR: refusing to overwrite an existing report file or link: %s" % exc.filename, file=sys.stderr)
        return 2
    except OSError as exc:
        if exc.errno == errno.ELOOP:
            print("ERROR: refusing to write a report through a symbolic link: %s" % exc.filename, file=sys.stderr)
            return 2
        raise


def run(argv):
    ap = argparse.ArgumentParser(description="Read-only identifier and secret sweep (masked output).")
    ap.add_argument("root")
    ap.add_argument("--literal", action="append", default=[], help="extra case-sensitive literal to count (masked in output)")
    ap.add_argument("--allow-team", default="", help="Apple team id that is ours; dev_team hits equal to it are not hits")
    ap.add_argument("--allowlist", default="", help="TSV of <pattern_id><TAB><glob><TAB><sha256> rules")
    ap.add_argument("--suggest-allowlist", default="",
                    help="write a candidate rule (hash only) per distinct remaining hit; masked samples go to stderr")
    ap.add_argument("--suggest-private", action="store_true",
                    help="with --suggest-allowlist and --private-key: write HMAC digests for the private allowlist")
    ap.add_argument("--private-allowlist", default="", help="private rules (HMAC-SHA256 digests), outside ROOT")
    ap.add_argument("--private-key", default="", help="key file for --private-allowlist (32+ bytes, mode 600)")
    ap.add_argument("--write-used-allowlist", default="",
                    help="write the --allowlist rules that matched in this tree (the published allowlist)")
    ap.add_argument("--exclude", action="append", default=[], help="glob (relative path) to skip entirely")
    ap.add_argument("--json", default="", help="write a masked JSON report here (a new file; never overwrites)")
    ap.add_argument("--fail-on-hits", action="store_true")
    ap.add_argument("--top", type=int, default=12, help="files listed per pattern")
    ap.add_argument("--only", default="", help="comma-separated pattern ids to run (default: all)")
    src = ap.add_mutually_exclusive_group()
    src.add_argument("--git-index", action="store_true", help="sweep exactly the staged files, from the staged blobs")
    src.add_argument("--git-tree", default="", metavar="REV", help="sweep the files of a commit, from git objects")
    ap.add_argument("--expect-files", type=int, default=None, help="fail unless exactly N files were read")
    ap.add_argument("--min-files", type=int, default=1, help="fail unless at least N files were read (default 1)")
    args = ap.parse_args(argv)

    root = os.path.abspath(args.root)
    if not os.path.isdir(root):
        print("ERROR: root is not a directory: %s" % root, file=sys.stderr)
        return 2
    if args.git_index and args.exclude:
        print("ERROR: --exclude cannot be used with --git-index: every staged file will be committed, "
              "so none may be skipped", file=sys.stderr)
        return 2
    if args.git_index or args.git_tree:
        top = subprocess.run(["git", "-C", root, "rev-parse", "--show-toplevel"], capture_output=True, env=GIT_ENV)
        if top.returncode != 0 or os.path.realpath(top.stdout.decode().strip()) != os.path.realpath(root):
            print("ERROR: --git-index/--git-tree need ROOT to be the top folder of a git repository: %s" % root,
                  file=sys.stderr)
            return 2
    rules = load_allowlist(args.allowlist, {pid for pid, _ in PATTERNS})
    rule_digests = {d for _p, _g, d in rules}
    used_rules = set()
    # The allowlist may live inside ROOT (tools/scrub/allowlist.tsv); its own hash column
    # is 64-hex by construction and is accepted there, and only there.
    allowlist_rel = None
    if args.allowlist:
        al_real, root_real = os.path.realpath(args.allowlist), os.path.realpath(root)
        if al_real.startswith(root_real + os.sep):
            allowlist_rel = os.path.relpath(al_real, root_real).replace(os.sep, "/")
    private_rules, private_key, private_used = [], None, set()
    if args.private_allowlist or args.suggest_private:
        if not args.private_key:
            allowlist_error("--private-allowlist and --suggest-private need --private-key")
        private_key = load_private_key(args.private_key)
        root_real = os.path.realpath(root)
        for label, f in (("private allowlist", args.private_allowlist), ("private key", args.private_key)):
            if f and (os.path.realpath(f) + os.sep).startswith(root_real + os.sep):
                allowlist_error("the %s must live outside the swept tree, or it would be published: %s" % (label, f))
        if args.private_allowlist:
            private_rules = load_allowlist(args.private_allowlist, {pid for pid, _ in PATTERNS})
    patterns = list(PATTERNS)
    if args.only:
        wanted = [p.strip() for p in args.only.split(",") if p.strip()]
        known = {pid for pid, _ in PATTERNS}
        unknown = [p for p in wanted if p not in known]
        if unknown or not wanted:
            print("ERROR: unknown pattern ids in --only: %s" % ", ".join(unknown), file=sys.stderr)
            return 2
        patterns = [(pid, rx) for pid, rx in PATTERNS if pid in wanted]
    for i, lit in enumerate(args.literal, 1):
        patterns.append(("literal_%d" % i, re.compile(re.escape(lit))))

    hits = defaultdict(Counter)          # pid -> rel -> count (not allowlisted)
    allowed_hits = defaultdict(Counter)  # pid -> rel -> count (allowlisted)
    samples = defaultdict(lambda: defaultdict(set))
    distinct = defaultdict(set)
    suggestions = {}  # (pid, path, digest) -> masked sample, for --suggest-allowlist
    scanner = Scanner(patterns)
    errors = scanner.errors
    st = scanner.st

    def record(pid, rel, m):
        if pid == "dev_team" and args.allow_team and team_of(m) == args.allow_team:
            return
        if pid == "email" and m.group(1) and m.group(1).lower() in ASSET_TLDS:
            return
        path = rel.split("#", 1)[0]
        digest = sha256_full(m.group(0))
        masked = mask(pid, m)
        if pid == "hex64" and path == allowlist_rel and m.group(0) in rule_digests:
            bucket = allowed_hits
        elif allowed(rules, pid, path, digest, used_rules):
            bucket = allowed_hits
        elif private_rules and allowed(private_rules, pid, path, hmac_full(private_key, m.group(0)), private_used):
            bucket = allowed_hits
        else:
            bucket = hits
            key = hmac_full(private_key, m.group(0)) if args.suggest_private else digest
            suggestions.setdefault((pid, path, key), masked)
        bucket[pid][rel] += 1
        if len(samples[pid][rel]) < 3:
            samples[pid][rel].add(masked)
        distinct[pid].add(sha8(m.group(0)))

    excluded = []

    def walk_error(exc):
        errors.append("cannot list %s (%s)" % (getattr(exc, "filename", "?"), exc.__class__.__name__))

    if args.git_index or args.git_tree:
        try:
            entries = git_entries(root, args.git_tree or None)
        except subprocess.CalledProcessError as exc:
            print("ERROR: cannot list the git %s: %s" % ("tree" if args.git_tree else "index",
                                                        exc.stderr.decode("utf-8", "replace").strip()), file=sys.stderr)
            return 2
        st["entries"] = len(entries)
        for path, data in git_blobs(root, entries, errors):
            if args.exclude and any(fnmatch.fnmatch(path, g) for g in args.exclude):
                excluded.append(path)
                continue
            st["walked"] += 1
            for pid, r, m in scanner.blob(path, path.rsplit("/", 1)[-1], data):
                record(pid, r, m)
        if st["walked"] + len(excluded) != len(entries):
            errors.append("read %d of %d git entries" % (st["walked"] + len(excluded), len(entries)))
    for dirpath, dirnames, filenames in ([] if (args.git_index or args.git_tree) else os.walk(root, onerror=walk_error)):
        dirnames[:] = sorted(d for d in dirnames if d != ".git")
        for d in dirnames:  # os.walk never descends into a linked folder: report it
            if os.path.islink(os.path.join(dirpath, d)):
                errors.append("%s: symbolic link to a folder (not followed, not scanned)"
                              % os.path.relpath(os.path.join(dirpath, d), root).replace(os.sep, "/"))
        for name in sorted(filenames):
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, root).replace(os.sep, "/")
            if any(fnmatch.fnmatch(rel, g) for g in args.exclude):
                excluded.append(rel)
                continue
            if os.path.islink(full):
                errors.append("%s: symbolic link (not followed, not scanned)" % rel)
                continue
            if not stat.S_ISREG(os.lstat(full).st_mode):
                errors.append("%s: not a regular file" % rel)
                continue
            st["walked"] += 1
            try:
                with open(full, "rb") as fh:
                    data = fh.read()
            except OSError as exc:
                errors.append("%s: cannot read (%s)" % (rel, exc.__class__.__name__))
                continue
            for pid, r, m in scanner.blob(rel, name, data):
                record(pid, r, m)

    if args.expect_files is not None and st["walked"] != args.expect_files:
        errors.append("read %d files, expected exactly %d (the staged count)" % (st["walked"], args.expect_files))
    if st["walked"] < args.min_files:
        errors.append("read %d files, fewer than the floor of %d" % (st["walked"], args.min_files))
    png_keywords, ext_binary = scanner.png_keywords, scanner.ext_binary
    walked, text_files, binary_files = st["walked"], st["text"], st["binary"]
    png_total, png_with_text, binary_bytes = st["png"], st["png_with_text"], st["binary_bytes"]

    pids = [p for p, _ in patterns]
    total_hits = sum(sum(c.values()) for c in hits.values())
    mode = ("git index (staged blobs)" if args.git_index else "git tree %s" % args.git_tree if args.git_tree
            else "folder walk")
    print("scrub_sweep: root=%s (%s)" % (root, mode))
    print("walked=%d text=%d binary=%d (png=%d, png_with_text_chunks=%d; printable runs of %d binary bytes scanned)" % (
        walked, text_files, binary_files, png_total, png_with_text, binary_bytes))
    print("archive members scanned=%d" % st["archive_members"])
    if args.exclude:
        print("excluded globs: %s (%d files not scanned, listed in --json)" % (", ".join(args.exclude), len(excluded)))
    print("")
    print("%-16s %8s %6s %9s %9s" % ("pattern", "hits", "files", "distinct", "allowed"))
    for pid in pids:
        n = sum(hits[pid].values())
        a = sum(allowed_hits[pid].values())
        print("%-16s %8d %6d %9d %9d" % (pid, n, len(hits[pid]), len(distinct[pid]), a))
    for pid in pids:
        if not hits[pid]:
            continue
        print("\n[%s] top files (count: path : masked samples)" % pid)
        for rel, n in hits[pid].most_common(args.top):
            print("  %5d  %s : %s" % (n, rel, "; ".join(sorted(samples[pid][rel]))))
        if len(hits[pid]) > args.top:
            print("  ... %d more files" % (len(hits[pid]) - args.top))
    if args.allowlist:
        print("\nallowlist: %d rules, %d used in this tree" % (len(rules), len(used_rules)))
    if args.private_allowlist:
        print("private allowlist: %d rules, %d used in this tree" % (len(private_rules), len(private_used)))
    if png_keywords:
        print("\nPNG text-chunk keywords (chunk:keyword -> files): %s" % dict(png_keywords.most_common()))
    if ext_binary:
        print("binary files by extension: %s" % dict(ext_binary.most_common()))

    if args.json:
        report = {
            "root": root,
            "mode": mode,
            "git_entries": st["entries"] if (args.git_index or args.git_tree) else None,
            "walked": walked, "text_files": text_files, "binary_files": binary_files,
            "binary_bytes_string_scanned": binary_bytes,
            "png_total": png_total, "png_with_text_chunks": png_with_text,
            "png_keywords": dict(png_keywords),
            "excluded": args.exclude,
            "excluded_files": excluded,
            "archive_members": st["archive_members"],
            "errors": errors,
            "patterns": {
                pid: {
                    "hits": sum(hits[pid].values()),
                    "files": {rel: {"count": n, "samples": sorted(samples[pid][rel])} for rel, n in hits[pid].items()},
                    "allowed": {rel: n for rel, n in allowed_hits[pid].items()},
                    "distinct_values": len(distinct[pid]),
                } for pid in pids
            },
        }
        report["allowlist_rules"] = len(rules)
        report["allowlist_rules_used"] = len(used_rules)
        report["private_allowlist_rules"] = len(private_rules)
        report["private_allowlist_rules_used"] = len(private_used)
        with open_new(args.json) as fh:
            json.dump(report, fh, indent=1, sort_keys=True)
    if args.suggest_allowlist:
        # Rules only. The masked samples go to stderr, never into a file that someone
        # might copy into the public allowlist.
        kind = "PRIVATE (HMAC)" if args.suggest_private else "public (SHA-256)"
        with open_new(args.suggest_allowlist) as fh:
            for n, ((pid, path, digest), masked) in enumerate(sorted(suggestions.items()), 1):
                fh.write("%s\t%s\t%s\n" % (pid, path, digest))
                print("suggested %s rule %d: %s in %s : %s" % (kind, n, pid, path, masked), file=sys.stderr)
    if args.write_used_allowlist:
        if not args.allowlist:
            allowlist_error("--write-used-allowlist needs --allowlist")
        write_used_allowlist(args.allowlist, used_rules, args.write_used_allowlist)

    if errors:
        for e in errors:
            print("ERROR: %s" % e, file=sys.stderr)
        print("ERROR: %d file(s) could not be fully scanned; refusing to report a clean result." % len(errors),
              file=sys.stderr)
        return 2
    if walked == 0:
        print("ERROR: walked zero files; refusing to report a clean result.", file=sys.stderr)
        return 2
    if args.fail_on_hits and total_hits:
        print("\nFAIL: %d non-allowlisted hits remain." % total_hits, file=sys.stderr)
        return 1
    print("\nOK: report complete (%d non-allowlisted hits)." % total_hits)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
