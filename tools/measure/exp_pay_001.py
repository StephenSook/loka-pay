#!/usr/bin/env python3
"""EXP-PAY-001 measurement (PLAN.md task 3.6). Python 3 stdlib only.

Recomputes the session's payment counts from data anyone can read without a key:

  1. Solana devnet: every transaction of the loka_vault program (config/pins.json programId),
     listed with getSignaturesForAddress and read with getTransaction (commitment finalized).
  2. For each redeem_note instruction, the secp256r1 precompile instruction right before it
     carries the payer's compressed key and the 141-byte NOTE_V1 (protocol/PAYMENT-V1.md
     sections 4.1 and 7). note id = sha256(NOTE_V1); payer key hash = sha256(compressed key).
  3. GET https://api.zerobars.us/v1/notes/<noteId>: the server's confirmation (CONF_V1),
     whose Ed25519 signature is verified here against config/pins.json serverEd25519PublicKey.
     Its uploaded-at and block-time fields give the settle seconds and the window membership.

Classes:
  settled        meta.err is null.
  refused_cheat  Custom 6011 (SerialUsed) on an allowance and serial that an EARLIER note
                 with a different note id settled. Not a payment: kept out of the denominator.
  duplicate      Custom 6011 on a serial that the SAME note already settled (a resend).
  failed_other   any other failure, including a 6011 with no earlier settled note found.

Window membership uses the signed upload time (CONF uploaded at), the same clock as
server/src/events/runs.ts and GET /api/stats?run=EXP-PAY-001. When a note has no verified
CONF, its block time stands in and a check fails, so a human looks.

What the chain cannot show: that the payer phone had zero bars, and tries that never reached
the chain. Both come from the session's attempt log (experiments/EXP-PAY-001-protocol.md).

Exit codes: 0 every check passed; 1 a fetch failed (nothing is written); 2 a check failed
(the drafts are written with the failures listed first); 64 usage error.
"""

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import struct
import sys
import time
import urllib.error
import urllib.request
from zoneinfo import ZoneInfo

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
ET = ZoneInfo("America/New_York")
SECP256R1_PROGRAM = "Secp256r1SigVerify1111111111111111111111111"
# Anchor discriminator: sha256("global:redeem_note")[:8], equal to programs/idl/loka_vault.json.
REDEEM_NOTE_DISCRIMINATOR = hashlib.sha256(b"global:redeem_note").digest()[:8]
NOTE_LEN = 141
NOTE_PREFIX = b"LOKA-PAY-NOTE-V1"
CONF_LEN = 139
CONF_PREFIX = b"LOKA-PAY-CONF-V1"
SERIAL_USED = 6011
USDC_DECIMALS = 6
USER_AGENT = "loka-pay-exp-pay-001/1"
DEFAULT_RPC = "https://api.devnet.solana.com"
DEFAULT_API = "https://api.zerobars.us"
EXPLORER = "https://explorer.solana.com/tx/%s?cluster=devnet"


class FetchError(Exception):
    """A network read failed. The run stops and writes nothing (a failed read is not a result)."""


class DecodeError(Exception):
    """A transaction or confirmation does not have the shape PAYMENT-V1 defines."""


# ---------------------------------------------------------------- base58

B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
B58_INDEX = {c: i for i, c in enumerate(B58)}


def b58decode(text):
    n = 0
    for ch in text:
        if ch not in B58_INDEX:
            raise DecodeError("not base58: %r" % ch)
        n = n * 58 + B58_INDEX[ch]
    body = n.to_bytes((n.bit_length() + 7) // 8, "big") if n else b""
    return b"\x00" * (len(text) - len(text.lstrip("1"))) + body


def b58encode(data):
    n = int.from_bytes(data, "big")
    out = ""
    while n:
        n, r = divmod(n, 58)
        out = B58[r] + out
    return "1" * (len(data) - len(data.lstrip(b"\x00"))) + out


def b64url_decode(text):
    import base64
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


# ---------------------------------------------------------------- Ed25519 verify (RFC 8032 section 6)

_P = 2 ** 255 - 19
_L = 2 ** 252 + 27742317777372353535851937790883648493
_D = -121665 * pow(121666, _P - 2, _P) % _P
_SQRT_M1 = pow(2, (_P - 1) // 4, _P)


def _inv(x):
    return pow(x, _P - 2, _P)


def _add(a, b):
    x1, y1, z1, t1 = a
    x2, y2, z2, t2 = b
    aa = (y1 - x1) * (y2 - x2) % _P
    bb = (y1 + x1) * (y2 + x2) % _P
    cc = 2 * t1 * t2 * _D % _P
    dd = 2 * z1 * z2 % _P
    e, f, g, h = bb - aa, dd - cc, dd + cc, bb + aa
    return (e * f % _P, g * h % _P, f * g % _P, e * h % _P)


def _mul(s, point):
    q = (0, 1, 1, 0)
    while s > 0:
        if s & 1:
            q = _add(q, point)
        point = _add(point, point)
        s >>= 1
    return q


def _equal(a, b):
    return (a[0] * b[2] - b[0] * a[2]) % _P == 0 and (a[1] * b[2] - b[1] * a[2]) % _P == 0


def _recover_x(y, sign):
    if y >= _P:
        return None
    x2 = (y * y - 1) * _inv(_D * y * y + 1) % _P
    if x2 == 0:
        return None if sign else 0
    x = pow(x2, (_P + 3) // 8, _P)
    if (x * x - x2) % _P != 0:
        x = x * _SQRT_M1 % _P
    if (x * x - x2) % _P != 0:
        return None
    if (x & 1) != sign:
        x = _P - x
    return x


def _decompress(raw):
    if len(raw) != 32:
        return None
    y = int.from_bytes(raw, "little")
    sign = y >> 255
    y &= (1 << 255) - 1
    x = _recover_x(y, sign)
    return None if x is None else (x, y, 1, x * y % _P)


_GY = 4 * _inv(5) % _P
_G = (_recover_x(_GY, 0), _GY, 1, _recover_x(_GY, 0) * _GY % _P)


def ed25519_verify(public, message, signature):
    """True only when signature is a valid RFC 8032 Ed25519 signature of message by public."""
    if len(public) != 32 or len(signature) != 64:
        return False
    a = _decompress(public)
    r = _decompress(signature[:32])
    if a is None or r is None:
        return False
    s = int.from_bytes(signature[32:], "little")
    if s >= _L:
        return False
    h = int.from_bytes(hashlib.sha512(signature[:32] + public + message).digest(), "little") % _L
    return _equal(_mul(s, _G), _add(r, _mul(h, a)))


# ---------------------------------------------------------------- PAYMENT-V1 decoding

def key_hash(compressed_key):
    """PAYMENT-V1 section 2: sha256 of the 33-byte compressed SEC1 key, hex."""
    return hashlib.sha256(compressed_key).hexdigest()


def decode_precompile(data):
    """Section 7: u8 count, u8 padding, then seven little-endian u16 offsets and indexes."""
    if len(data) < 16:
        raise DecodeError("precompile data is %d bytes, shorter than its 16-byte header" % len(data))
    if data[0] != 1:
        raise DecodeError("precompile carries %d signatures; redeem_note expects 1" % data[0])
    sig_off, sig_ix, key_off, key_ix, msg_off, msg_len, msg_ix = struct.unpack_from("<7H", data, 2)
    if (sig_ix, key_ix, msg_ix) != (0xFFFF, 0xFFFF, 0xFFFF):
        raise DecodeError("precompile instruction indexes are not all 0xFFFF")
    if msg_len != NOTE_LEN:
        raise DecodeError("precompile message is %d bytes, not %d" % (msg_len, NOTE_LEN))
    for name, off, size in (("signature", sig_off, 64), ("public key", key_off, 33), ("message", msg_off, msg_len)):
        if off + size > len(data):
            raise DecodeError("precompile %s runs past the instruction data" % name)
    return {"public_key": data[key_off:key_off + 33], "signature": data[sig_off:sig_off + 64],
            "message": data[msg_off:msg_off + msg_len]}


def decode_note(message):
    """Section 4.1: NOTE_V1, big-endian integers."""
    if len(message) != NOTE_LEN:
        raise DecodeError("note is %d bytes, not %d" % (len(message), NOTE_LEN))
    return {
        "note_id": hashlib.sha256(message).hexdigest(),
        "prefix": message[0:16],
        "program_id": b58encode(message[16:48]),
        "cluster_id": message[48],
        "mint": b58encode(message[49:81]),
        "allowance_id": int.from_bytes(message[81:89], "big"),
        "payee_key_hash": message[89:121].hex(),
        "amount_units": int.from_bytes(message[121:129], "big"),
        "currency": message[129:132].decode("ascii", "replace"),
        "serial": message[132],
        "expiry": int.from_bytes(message[133:141], "big", signed=True),
    }


def decode_conf(wire, server_public_key):
    """Section 4.3: CONF_V1 (139 bytes) then the server's Ed25519 signature (64 bytes)."""
    if len(wire) != CONF_LEN + 64:
        raise DecodeError("conf wire is %d bytes, not %d" % (len(wire), CONF_LEN + 64))
    body, sig = wire[:CONF_LEN], wire[CONF_LEN:]
    if body[:16] != CONF_PREFIX:
        raise DecodeError("conf prefix is not LOKA-PAY-CONF-V1")
    return {
        "verified": ed25519_verify(server_public_key, body, sig),
        "note_id": body[16:48].hex(),
        "tx_signature": b58encode(body[48:112]),
        "slot": int.from_bytes(body[112:120], "big"),
        "block_time": int.from_bytes(body[120:128], "big", signed=True),
        "uploaded_at": int.from_bytes(body[128:136], "big", signed=True),
        "status": body[136],
        "error_code": int.from_bytes(body[137:139], "big"),
    }


def account_keys(tx):
    keys = list(tx["transaction"]["message"]["accountKeys"])
    loaded = (tx.get("meta") or {}).get("loadedAddresses") or {}
    return keys + list(loaded.get("writable") or []) + list(loaded.get("readonly") or [])


def instruction_names(tx):
    names = []
    for line in (tx.get("meta") or {}).get("logMessages") or []:
        if line.startswith("Program log: Instruction: "):
            names.append(line[len("Program log: Instruction: "):])
    return names


def chain_error(meta_err):
    """(None, None) when the transaction succeeded; (code, text) otherwise. code is the Custom
    program error when there is one, else None."""
    if meta_err is None:
        return None, None
    text = json.dumps(meta_err, sort_keys=True)
    if isinstance(meta_err, dict) and "InstructionError" in meta_err:
        detail = meta_err["InstructionError"]
        if isinstance(detail, list) and len(detail) == 2 and isinstance(detail[1], dict) and "Custom" in detail[1]:
            return int(detail[1]["Custom"]), text
    return None, text


def extract_redeems(tx, program_id):
    """Every redeem_note instruction in tx, decoded with the precompile instruction before it."""
    keys = account_keys(tx)
    instructions = tx["transaction"]["message"]["instructions"]
    rows = []
    for index, ix in enumerate(instructions):
        if keys[ix["programIdIndex"]] != program_id:
            continue
        data = b58decode(ix["data"])
        if data[:8] != REDEEM_NOTE_DISCRIMINATOR:
            continue
        if index == 0 or keys[instructions[index - 1]["programIdIndex"]] != SECP256R1_PROGRAM:
            raise DecodeError("redeem_note at instruction %d is not preceded by the secp256r1 precompile" % index)
        pre = decode_precompile(b58decode(instructions[index - 1]["data"]))
        if data[8:] != pre["message"]:
            raise DecodeError("redeem_note's note argument differs from the precompile message")
        note = decode_note(pre["message"])
        code, text = chain_error(tx["meta"]["err"])
        rows.append(dict(note, **{
            "signature": tx["transaction"]["signatures"][0],
            "slot": tx["slot"],
            "chain_block_time": tx.get("blockTime"),
            "instruction_index": index,
            "payer_key_hash": key_hash(pre["public_key"]),
            "error_code": code,
            "error": text,
            "fee_lamports": tx["meta"].get("fee"),
        }))
    return rows


# ---------------------------------------------------------------- classification and statistics

def classify(rows, excluded_payers):
    """Label every row. rows must be in chain order (slot, then position in the slot).

    Returns the same row dicts with: class, and cheat_of / duplicate_of / reason when they apply,
    plus excluded (the payer key hash is in excluded_payers)."""
    settled_by_serial = {}
    for row in rows:
        row["excluded"] = row["payer_key_hash"] in excluded_payers
        key = (row["allowance_id"], row["serial"])
        if row["error"] is None:
            row["class"] = "settled"
            settled_by_serial.setdefault(key, row)
        elif row["error_code"] == SERIAL_USED:
            original = settled_by_serial.get(key)
            if original is None:
                row["class"] = "failed_other"
                row["reason"] = ("SerialUsed (6011) with no earlier settled note for allowance %d serial %d in the scan"
                                 % key)
            elif original["note_id"] == row["note_id"]:
                row["class"] = "duplicate"
                row["duplicate_of"] = original["signature"]
            else:
                row["class"] = "refused_cheat"
                row["cheat_of"] = original["signature"]
        else:
            row["class"] = "failed_other"
            row["reason"] = row["error"]
    return rows


def percentile_cont(values, fraction):
    """Linear interpolation between closest ranks, as Postgres percentile_cont (server/src/events/stats.ts)."""
    if not values:
        return None
    ordered = sorted(values)
    position = fraction * (len(ordered) - 1)
    low = int(position)
    high = min(low + 1, len(ordered) - 1)
    return ordered[low] + (ordered[high] - ordered[low]) * (position - low)


def count_window(rows):
    """Headline counts over rows that are in the window and not excluded."""
    counted = [r for r in rows if r.get("in_window") and not r["excluded"]]
    settled_ids = {r["note_id"] for r in counted if r["class"] == "settled"}
    made_ids = {r["note_id"] for r in counted if r["class"] in ("settled", "failed_other")}
    cheats = {r["note_id"] for r in counted if r["class"] == "refused_cheat"}
    settle = [r["settle_seconds"] for r in counted
              if r["class"] == "settled" and r.get("settle_seconds") is not None]
    return {
        "payments_reached_chain": len(made_ids),
        "payments_settled": len(settled_ids),
        "payments_failed_other": len(made_ids - settled_ids),
        "refused_cheats": len(cheats),
        "duplicates": sum(1 for r in counted if r["class"] == "duplicate"),
        "settle_seconds": {"median": percentile_cont(settle, 0.5), "p95": percentile_cont(settle, 0.95),
                           "n": len(settle)},
    }


# ---------------------------------------------------------------- network

class Rpc:
    def __init__(self, url, delay, cache_dir=None, log=None):
        self.url, self.delay, self.cache_dir = url, delay, cache_dir
        self.log = log or (lambda msg: print(msg, file=sys.stderr))
        self._last = 0.0
        self.calls = 0

    def call(self, method, params, attempts=10):
        payload = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
        for attempt in range(attempts):
            wait = self.delay - (time.monotonic() - self._last)
            if wait > 0:
                time.sleep(wait)
            self._last = time.monotonic()
            self.calls += 1
            request = urllib.request.Request(self.url, data=payload, headers={
                "Content-Type": "application/json", "User-Agent": USER_AGENT})
            try:
                with urllib.request.urlopen(request, timeout=30) as response:
                    body = json.load(response)
            except urllib.error.HTTPError as error:
                if error.code in (429, 500, 502, 503, 504):
                    pause = int(error.headers.get("Retry-After") or 0) or min(2 ** attempt, 20)
                    self.log("rpc %s: HTTP %d, retrying in %d s" % (method, error.code, pause))
                    time.sleep(pause)
                    continue
                raise FetchError("rpc %s: HTTP %d" % (method, error.code))
            except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
                pause = min(2 ** attempt, 20)
                self.log("rpc %s: %s, retrying in %d s" % (method, error, pause))
                time.sleep(pause)
                continue
            if "error" in body:
                raise FetchError("rpc %s: %s" % (method, json.dumps(body["error"])))
            return body["result"]
        raise FetchError("rpc %s: no answer after %d attempts" % (method, attempts))

    def signatures(self, address, before=None, limit=1000):
        options = {"limit": limit, "commitment": "finalized"}
        if before:
            options["before"] = before
        return self.call("getSignaturesForAddress", [address, options])

    def transaction(self, signature):
        path = os.path.join(self.cache_dir, signature + ".json") if self.cache_dir else None
        if path and os.path.exists(path):
            with open(path) as fh:
                return json.load(fh)
        result = self.call("getTransaction", [signature, {
            "encoding": "json", "maxSupportedTransactionVersion": 0, "commitment": "finalized"}])
        if result is None:
            raise FetchError("getTransaction %s: not found at commitment finalized" % signature)
        if path:  # finalized transactions never change, so the cache cannot go stale
            os.makedirs(self.cache_dir, exist_ok=True)
            with open(path, "w") as fh:
                json.dump(result, fh)
        return result


def fetch_note(api_base, note_id, log, attempts=5):
    url = "%s/v1/notes/%s" % (api_base.rstrip("/"), note_id)
    for attempt in range(attempts):
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return {"http_status": response.status, "body": json.load(response)}
        except urllib.error.HTTPError as error:
            if error.code in (404, 410):
                return {"http_status": error.code, "body": None}
            if error.code in (429, 500, 502, 503, 504):
                pause = int(error.headers.get("Retry-After") or 0) or min(2 ** attempt, 20)
                log("notes api %s: HTTP %d, retrying in %d s" % (note_id[:12], error.code, pause))
                time.sleep(pause)
                continue
            raise FetchError("notes api %s: HTTP %d" % (note_id, error.code))
        except (urllib.error.URLError, TimeoutError, ConnectionError, ValueError) as error:
            pause = min(2 ** attempt, 20)
            log("notes api %s: %s, retrying in %d s" % (note_id[:12], error, pause))
            time.sleep(pause)
    raise FetchError("notes api %s: no answer after %d attempts" % (note_id, attempts))


# ---------------------------------------------------------------- run

def parse_when(text, now):
    """unix seconds, 'now', or an ISO 8601 time (no offset means US Eastern)."""
    value = text.strip()
    if value == "now":
        return int(now)
    if re.fullmatch(r"\d{9,11}", value):
        return int(value)
    try:
        when = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise argparse.ArgumentTypeError("not a time: %r (use unix seconds, 'now' or ISO 8601)" % text)
    if when.tzinfo is None:
        when = when.replace(tzinfo=ET)
    return int(when.timestamp())


def et(ts):
    if ts is None:
        return "unknown"
    when = dt.datetime.fromtimestamp(ts, ET)
    return when.strftime("%a %b %d %Y ") + when.strftime("%I:%M:%S %p").lstrip("0") + " ET"


def load_json(relative):
    with open(os.path.join(REPO, relative)) as fh:
        return json.load(fh)


def check_note_binding(row, pins):
    problems = []
    if row["prefix"] != NOTE_PREFIX:
        problems.append("prefix")
    if row["program_id"] != pins["programId"]:
        problems.append("program id %s" % row["program_id"])
    if row["cluster_id"] != (0 if pins["cluster"] == "devnet" else 1):
        problems.append("cluster id %d" % row["cluster_id"])
    if row["mint"] != pins["mint"]:
        problems.append("mint %s" % row["mint"])
    if row["currency"] != "USD":
        problems.append("currency %r" % row["currency"])
    return problems


def attach_conf(row, answer, server_key):
    """Cross-check the notes API answer and its signed CONF against the chain row. Returns problems."""
    problems = []
    row["api_http_status"] = answer["http_status"]
    body = answer["body"]
    if body is None:
        return ["notes api answered HTTP %d for note %s" % (answer["http_status"], row["note_id"])]
    row["api_status"] = body.get("status")
    if not body.get("conf"):
        return ["notes api returned no signed confirmation for note %s (status %r)" % (row["note_id"], body.get("status"))]
    try:
        conf = decode_conf(b64url_decode(body["conf"]), server_key)
    except (DecodeError, ValueError) as error:
        return ["note %s: confirmation does not decode: %s" % (row["note_id"], error)]
    row["conf"] = conf
    expected_status = 1 if row["error"] is None else 2
    # Section 4.3: the redeem_note Custom code when it fits a u16 at status 2, else 0.
    code = row["error_code"]
    expected_code = code if code is not None and 0 <= code <= 0xFFFF else 0
    checks = [
        ("Ed25519 signature verifies with the pinned server key", conf["verified"]),
        ("CONF note id equals the chain note id", conf["note_id"] == row["note_id"]),
        ("CONF transaction signature equals the chain signature", conf["tx_signature"] == row["signature"]),
        ("CONF slot equals the chain slot", conf["slot"] == row["slot"]),
        ("CONF block time equals the chain block time", conf["block_time"] == row["chain_block_time"]),
        ("CONF status agrees with meta.err", conf["status"] == expected_status),
        ("CONF error code agrees with the chain error", conf["error_code"] == expected_code),
        ("API JSON uploadedAt equals the signed uploaded at", body.get("uploadedAt") == conf["uploaded_at"]),
        ("API JSON blockTime equals the signed block time", body.get("blockTime") == conf["block_time"]),
        ("API JSON noteId equals the chain note id", body.get("noteId") == row["note_id"]),
    ]
    for label, ok in checks:
        if not ok:
            problems.append("note %s (%s): %s FAILED" % (row["note_id"][:16], row["signature"][:12], label))
    if conf["verified"]:
        row["uploaded_at"] = conf["uploaded_at"]
        if row["error"] is None:
            row["settle_seconds"] = conf["block_time"] - conf["uploaded_at"]
    return problems


def derive_payer(rpc, signatures, program_id):
    """Payer key hash shared by every redeem in the given transactions (the 2:01 AM test key)."""
    hashes = set()
    for signature in signatures:
        redeems = extract_redeems(rpc.transaction(signature), program_id)
        if not redeems:
            raise DecodeError("%s carries no redeem_note" % signature)
        hashes.update(r["payer_key_hash"] for r in redeems)
    if len(hashes) != 1:
        raise DecodeError("transactions %s decode to %d different payers" % (", ".join(signatures), len(hashes)))
    return hashes.pop()


def run(args, now, log):
    pins = load_json("config/pins.json")
    facts = load_json("docs/FACTS.json")["facts"]
    program_id = pins["programId"]
    server_key = bytes.fromhex(pins["serverEd25519PublicKey"])
    rpc = Rpc(args.rpc, args.rpc_delay, args.cache, log)
    window_from, window_to = args.window_from, args.window_to
    scan_to = window_to + args.settle_margin
    lookback_floor = window_from - int(args.lookback_hours * 3600)
    problems = []

    # Excluded payers: the 2:01 AM test key from FACTS (always), then any --exclude-payer-of-tx and --exclude-payer.
    excluded = {}
    test_txs = [facts["proof_pair_settled_tx"]["value"], facts["proof_pair_refused_tx"]["value"]]
    excluded[derive_payer(rpc, test_txs, program_id)] = "test key (docs/FACTS.json proof_pair_settled_tx and proof_pair_refused_tx)"
    for signature in args.exclude_payer_of_tx:
        excluded.setdefault(derive_payer(rpc, [signature], program_id), "--exclude-payer-of-tx %s" % signature)
    for value in args.exclude_payer:
        value = value.strip().lower()
        if not re.fullmatch(r"[0-9a-f]{64}", value):
            raise argparse.ArgumentTypeError("--exclude-payer takes a 64-hex payer key hash, got %r" % value)
        excluded.setdefault(value, "--exclude-payer")

    # 1. List signatures newest first until one is older than the window or the program's history ends.
    listing, before, complete = [], None, False
    for _ in range(args.max_pages):
        page = rpc.signatures(program_id, before)
        listing.extend(page)
        if len(page) < 1000:
            complete = True  # the listing reached the program's first transaction
            break
        oldest = page[-1].get("blockTime")
        if oldest is not None and oldest < lookback_floor:
            complete = True
            break
        before = page[-1]["signature"]
    reached_before_window = any(s.get("blockTime") is not None and s["blockTime"] < window_from for s in listing)
    if not complete and not reached_before_window:
        problems.append("coverage: %d pages read without reaching the window start; raise --max-pages" % args.max_pages)
    for position, entry in enumerate(listing):
        entry["_order"] = position

    # 2. Read every transaction whose block time could hold an in-window upload.
    rows, other, decode_failures = [], [], []
    for entry in listing:
        block_time = entry.get("blockTime")
        if block_time is not None and not window_from <= block_time <= scan_to:
            continue
        tx = rpc.transaction(entry["signature"])
        try:
            redeems = extract_redeems(tx, program_id)
        except DecodeError as error:
            decode_failures.append({"signature": entry["signature"], "error": str(error)})
            problems.append("decode: %s: %s" % (entry["signature"], error))
            continue
        if not redeems:
            other.append({"signature": entry["signature"], "slot": tx["slot"], "block_time": tx.get("blockTime"),
                          "instructions": instruction_names(tx), "error": chain_error(tx["meta"]["err"])[1]})
        if len(redeems) > 1:
            problems.append("shape: %s carries %d redeem_note instructions (batches are not counted by this script)"
                            % (entry["signature"], len(redeems)))
        for row in redeems:
            row["_order"] = entry["_order"]
            row["fetched_for"] = "window"
            rows.append(row)

    # 3. Signed confirmations: membership by upload time, settle seconds from signed times.
    for row in rows:
        problems.extend("binding: note %s: %s" % (row["note_id"][:16], p) for p in check_note_binding(row, pins))
        conf_problems = attach_conf(row, fetch_note(args.api, row["note_id"], log), server_key)
        if row["payer_key_hash"] in excluded:  # never counted, so its confirmation cannot fail the run
            row["conf_problems"] = conf_problems
        else:
            problems.extend(conf_problems)
        if row.get("uploaded_at") is not None:
            row["window_clock"] = "conf_uploaded_at"
            row["in_window"] = window_from <= row["uploaded_at"] <= window_to
        else:
            row["window_clock"] = "chain_block_time"
            row["in_window"] = row["chain_block_time"] is not None and window_from <= row["chain_block_time"] <= window_to

    # 4. A 6011 whose original settled before the scan: read older settled redeems, newest first, until found.
    def unmatched():
        settled = {(r["allowance_id"], r["serial"]) for r in rows if r["error"] is None}
        return {(r["allowance_id"], r["serial"]) for r in rows
                if r["error_code"] == SERIAL_USED and (r["allowance_id"], r["serial"]) not in settled}
    missing = unmatched()
    for entry in listing:
        if not missing:
            break
        block_time = entry.get("blockTime")
        if block_time is None or block_time >= window_from or block_time < lookback_floor or entry.get("err") is not None:
            continue
        try:
            older = extract_redeems(rpc.transaction(entry["signature"]), program_id)
        except DecodeError as error:  # outside the window: noted, not a window problem
            decode_failures.append({"signature": entry["signature"], "error": str(error), "outside_window": True})
            continue
        for row in older:
            row["_order"] = entry["_order"]
            row["fetched_for"] = "cheat_original_lookup"
            row["in_window"] = False
            row["window_clock"] = "chain_block_time"
            rows.append(row)
        missing = unmatched()

    rows.sort(key=lambda r: (r["slot"], -r["_order"], r["instruction_index"]))
    classify(rows, set(excluded))
    for row in rows:
        # A real failure is data (it stays in the denominator). A 6011 with no original found is ambiguous:
        # a cheat whose original settled before --lookback-hours, or a failure. A human decides.
        if (row.get("in_window") and not row["excluded"] and row["class"] == "failed_other"
                and row["error_code"] == SERIAL_USED):
            problems.append("ambiguous: %s: %s; raise --lookback-hours or classify it by hand"
                            % (row["signature"], row.get("reason")))
    counts = count_window(rows)
    if counts["payments_reached_chain"] + counts["refused_cheats"] < args.min_payments:
        problems.append("floor: %d redeem payments in the window, fewer than --min-payments %d (a scan that finds "
                        "nothing is not a clean result)" % (counts["payments_reached_chain"] + counts["refused_cheats"],
                                                            args.min_payments))

    per_allowance = {}
    for row in rows:
        if row.get("in_window") and not row["excluded"] and row["class"] == "settled":
            entry = per_allowance.setdefault(str(row["allowance_id"]), {
                "payer_key_hash": row["payer_key_hash"], "settled": 0, "settled_units": 0, "serials": []})
            entry["settled"] += 1
            entry["settled_units"] += row["amount_units"]
            entry["serials"].append(row["serial"])

    command = ["python3", "tools/measure/exp_pay_001.py", "--from", str(window_from), "--to", str(window_to)]
    for signature in args.exclude_payer_of_tx:
        command += ["--exclude-payer-of-tx", signature]
    for value in args.exclude_payer:
        command += ["--exclude-payer", value.strip().lower()]
    if args.settle_margin != 3600:
        command += ["--settle-margin", str(args.settle_margin)]
    if args.lookback_hours != 48.0:
        command += ["--lookback-hours", "%g" % args.lookback_hours]
    if args.api != DEFAULT_API:
        command += ["--api", args.api]
    if args.rpc != DEFAULT_RPC:  # never print a custom RPC URL: it often carries an API key
        command += ["--rpc", "<your devnet RPC URL>"]

    return {
        "experiment": "EXP-PAY-001",
        "generated_at": dt.datetime.fromtimestamp(int(now), dt.timezone.utc).isoformat(),
        "generator": "tools/measure/exp_pay_001.py",
        "recompute": " ".join(command),
        "window": {"from": window_from, "to": window_to, "from_et": et(window_from), "to_et": et(window_to),
                   "clock": "CONF uploaded at (server upload clock), as RUNS and /api/stats?run=EXP-PAY-001"},
        "deployment": {"cluster": pins["cluster"], "program_id": program_id, "mint": pins["mint"],
                       "server_ed25519_public_key": pins["serverEd25519PublicKey"]},
        "scan": {"rpc": "devnet public RPC" if args.rpc == DEFAULT_RPC else "custom RPC", "notes_api": args.api,
                 "signatures_listed": len(listing), "listing_complete": complete,
                 "listing_reached_before_window": reached_before_window,
                 "block_time_range": [window_from, scan_to], "settle_margin_seconds": args.settle_margin,
                 "lookback_hours": args.lookback_hours, "rpc_calls": rpc.calls},
        "excluded_payers": [{"payer_key_hash": k, "why": v} for k, v in excluded.items()],
        "counts": counts,
        "per_allowance": per_allowance,
        "checks": {"passed": not problems, "problems": problems},
        "payments": [public_row(r) for r in rows],
        "other_program_transactions": other,
        "decode_failures": decode_failures,
        "signatures": [{"signature": s["signature"], "slot": s.get("slot"), "block_time": s.get("blockTime"),
                        "err": s.get("err"), "explorer": EXPLORER % s["signature"]} for s in listing],
    }


def public_row(row):
    keep = ["signature", "slot", "chain_block_time", "uploaded_at", "window_clock", "in_window", "fetched_for",
            "class", "excluded", "cheat_of", "duplicate_of", "reason", "note_id", "allowance_id", "serial",
            "amount_units", "payee_key_hash", "payer_key_hash", "expiry", "error_code", "error", "fee_lamports",
            "api_http_status", "api_status", "settle_seconds", "conf_problems"]
    out = {k: row[k] for k in keep if k in row}
    if "conf" in row:
        out["conf_verified"] = row["conf"]["verified"]
        out["conf_status"] = row["conf"]["status"]
    out["explorer"] = EXPLORER % row["signature"]
    return out


# ---------------------------------------------------------------- markdown draft

def usd(units):
    return "%d.%06d" % divmod(units, 10 ** USDC_DECIMALS)


def fmt_seconds(value):
    return "n/a" if value is None else ("%g" % round(value, 3))


def render_markdown(report):
    c, w, s = report["counts"], report["window"], report["scan"]
    lines = ["# EXP-PAY-001 (generated draft, not reviewed)", ""]
    lines.append("Generated by `%s` at %s. This is a draft: `docs/FACTS.json` and `RUNS['EXP-PAY-001']` are "
                 "filled only in the reviewed PR described in `experiments/EXP-PAY-001-protocol.md`."
                 % (report["generator"], report["generated_at"]))
    lines.append("")
    if report["checks"]["passed"]:
        lines.append("**Checks: all passed.**")
    else:
        lines.append("**Checks FAILED. Read these before using any number below:**")
        lines.append("")
        lines.extend("- %s" % p for p in report["checks"]["problems"])
    lines += ["", "## Window", "",
              "- From: %s (unix %d)" % (w["from_et"], w["from"]),
              "- To: %s (unix %d)" % (w["to_et"], w["to"]),
              "- Membership clock: %s." % w["clock"],
              "- Program `%s` on %s; %d signatures listed (reached a signature older than the window: %s)."
              % (report["deployment"]["program_id"], report["deployment"]["cluster"], s["signatures_listed"],
                 "yes" if s["listing_reached_before_window"] or s["listing_complete"] else "NO"),
              "", "## Counts", "",
              "| What | n |", "|---|---|",
              "| Payments that reached Solana (chain part of the headline denominator) | %d |" % c["payments_reached_chain"],
              "| Settled on Solana (headline numerator) | %d |" % c["payments_settled"],
              "| Failed on chain for another reason | %d |" % c["payments_failed_other"],
              "| Refused cheats, SerialUsed 6011 (excluded from the denominator) | %d |" % c["refused_cheats"],
              "| Duplicate settles of an already settled note | %d |" % c["duplicates"],
              "",
              "Draft headline from the chain alone: **%d of %d payments that reached Solana settled.** Before this "
              "becomes `zero_bar_payments_settled` / `zero_bar_payments_tried`, add every try from the attempt log "
              "that never reached the chain to the denominator, and confirm from the log that each counted payment "
              "was made with zero bars (UNVERIFIED here: the chain cannot see a phone's signal)."
              % (c["payments_settled"], c["payments_reached_chain"]),
              "", "## Settle seconds", "",
              "Block time minus uploaded at, both read from the server-signed CONF (chain clock minus server clock, "
              "1-second resolution; Solana block time is the cluster's stake-weighted estimate). Percentiles "
              "interpolate like Postgres `percentile_cont`, as `/api/stats` does.", "",
              "- median %s s, p95 %s s, n %d" % (fmt_seconds(c["settle_seconds"]["median"]),
                                                fmt_seconds(c["settle_seconds"]["p95"]), c["settle_seconds"]["n"]),
              "", "## Settled total per allowance", "",
              "Compare each total with the allowance cap shown on the payer's Pay screen (\"Up to $X sandbox\"). "
              "This script does not read the cap.", ""]
    if report["per_allowance"]:
        lines += ["| Allowance | Payer key hash | Settled | Total (base units) | Total (sandbox USD) | Serials |",
                  "|---|---|---|---|---|---|"]
        for allowance, a in sorted(report["per_allowance"].items()):
            lines.append("| %s | `%s` | %d | %d | %s | %s |" % (allowance, a["payer_key_hash"][:16], a["settled"],
                         a["settled_units"], usd(a["settled_units"]), ", ".join(str(x) for x in sorted(a["serials"]))))
    else:
        lines.append("None settled in the window.")
    lines += ["", "## Every redeem in the scan", "",
              "| Time (ET, block) | Class | Counted | Allowance | Serial | Amount (units) | Settle s | Note id | Transaction |",
              "|---|---|---|---|---|---|---|---|---|"]
    for r in report["payments"]:
        counted = "yes" if r.get("in_window") and not r["excluded"] and r["class"] in ("settled", "failed_other") else (
            "excluded payer" if r["excluded"] else "cheat, not counted" if r["class"] == "refused_cheat" else
            "duplicate" if r["class"] == "duplicate" else "outside window")
        label = r["class"] + (" (of %s)" % r["cheat_of"][:8] if r.get("cheat_of") else "")
        lines.append("| %s | %s | %s | %d | %d | %d | %s | `%s` | [%s](%s) |" % (
            et(r.get("chain_block_time")), label, counted, r["allowance_id"], r["serial"], r["amount_units"],
            fmt_seconds(r.get("settle_seconds")), r["note_id"][:16], r["signature"][:12], r["explorer"]))
    if not report["payments"]:
        lines.append("| none | | | | | | | | |")
    lines += ["", "## Excluded payers", ""]
    lines.extend("- `%s`: %s" % (e["payer_key_hash"], e["why"]) for e in report["excluded_payers"])
    lines += ["", "## Other program transactions in the scan (not payments)", ""]
    if report["other_program_transactions"]:
        for o in report["other_program_transactions"]:
            lines.append("- %s: %s [%s](%s)" % (et(o["block_time"]), ", ".join(o["instructions"]) or "no loka_vault log",
                                               o["signature"][:12], EXPLORER % o["signature"]))
    else:
        lines.append("None.")
    lines += ["", "## Not checked by this script (UNVERIFIED here)", "",
              "- Zero bars on the payer phone at signing time (airplane mode): from the attempt log and recordings.",
              "- Tries that never reached the chain (a scan that failed, a phone that crashed): from the attempt log.",
              "- Which phone and person made each payment: the chain shows key hashes, not devices.",
              "- Canary, ci and load_test rows: `/api/stats` drops them by source; this script drops payers by key "
              "hash, so pass any test payer with `--exclude-payer` or `--exclude-payer-of-tx`.",
              "", "## Recompute", "", "```", report["recompute"], "```", "",
              "The JSON beside this file lists every signature the scan read.", ""]
    return "\n".join(lines)


# ---------------------------------------------------------------- main

def main(argv, now=None, log=None):
    log = log or (lambda msg: print(msg, file=sys.stderr))
    now = time.time() if now is None else now
    ap = argparse.ArgumentParser(description="Recompute EXP-PAY-001 from devnet and the signed confirmations.")
    ap.add_argument("--from", dest="window_from", required=True, type=lambda t: parse_when(t, now),
                    help="window start: unix seconds or ISO 8601 (no offset means US Eastern)")
    ap.add_argument("--to", dest="window_to", default="now", type=lambda t: parse_when(t, now),
                    help="window end: unix seconds, ISO 8601 or 'now' (default)")
    ap.add_argument("--exclude-payer", action="append", default=[], help="payer key hash (64 hex) to leave out")
    ap.add_argument("--exclude-payer-of-tx", action="append", default=[],
                    help="leave out the payer of this redeem transaction (derived by decoding it)")
    ap.add_argument("--rpc", default=DEFAULT_RPC, help="devnet JSON-RPC URL (default: the public devnet RPC)")
    ap.add_argument("--rpc-delay", type=float, default=1.0, help="seconds between RPC calls (public devnet rate-limits)")
    ap.add_argument("--api", default=DEFAULT_API, help="settlement API base URL")
    ap.add_argument("--settle-margin", type=int, default=3600,
                    help="also read transactions this many seconds after --to (an upload before the end settles after it)")
    ap.add_argument("--lookback-hours", type=float, default=48.0,
                    help="how far before --from to look for the settled original of a refused cheat")
    ap.add_argument("--min-payments", type=int, default=1, help="fail unless at least this many redeems are in the window")
    ap.add_argument("--max-pages", type=int, default=20)
    ap.add_argument("--cache", default=None, help="directory to cache finalized transactions in (optional)")
    ap.add_argument("--json-out", default=os.path.join(REPO, "experiments", "EXP-PAY-001.draft.json"))
    ap.add_argument("--md-out", default=os.path.join(REPO, "experiments", "EXP-PAY-001.draft.md"))
    try:
        args = ap.parse_args(argv)
    except SystemExit as error:
        return 64 if error.code else 0
    if args.window_to <= args.window_from:
        log("exp_pay_001: --to must be after --from")
        return 64
    try:
        report = run(args, now, log)
    except FetchError as error:
        log("exp_pay_001: FETCH FAILED, nothing written: %s" % error)
        return 1
    except argparse.ArgumentTypeError as error:
        log("exp_pay_001: %s" % error)
        return 64
    except DecodeError as error:
        log("exp_pay_001: DECODE FAILED, nothing written: %s" % error)
        return 2
    with open(args.json_out, "w") as fh:
        json.dump(report, fh, indent=2)
        fh.write("\n")
    with open(args.md_out, "w") as fh:
        fh.write(render_markdown(report))
    c = report["counts"]
    print("EXP-PAY-001 window %s to %s" % (report["window"]["from_et"], report["window"]["to_et"]))
    print("reached chain %d, settled %d, failed other %d, refused cheats %d, duplicates %d"
          % (c["payments_reached_chain"], c["payments_settled"], c["payments_failed_other"], c["refused_cheats"],
             c["duplicates"]))
    print("settle seconds: median %s, p95 %s, n %d" % (fmt_seconds(c["settle_seconds"]["median"]),
                                                      fmt_seconds(c["settle_seconds"]["p95"]), c["settle_seconds"]["n"]))
    shown = [os.path.relpath(p, REPO) if os.path.abspath(p).startswith(REPO + os.sep) else p
             for p in (args.json_out, args.md_out)]
    print("wrote %s and %s" % tuple(shown))
    if not report["checks"]["passed"]:
        print("CHECKS FAILED:")
        for problem in report["checks"]["problems"]:
            print("  " + problem)
        return 2
    print("checks: all passed")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
