"""One-off repair: remove Git conflict markers from store.json / site.json."""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STORE = ROOT / "data" / "store.json"
SITE = ROOT / "frontend" / "public" / "data" / "site.json"

CONFLICT_RE = re.compile(
    r"<<<<<<< HEAD\n(.*?)=======\n(.*?)>>>>>>> [0-9a-f]+\n?",
    re.DOTALL,
)


def parse_entries(chunk: str, *, leading_brace: bool = False, trailing_brace: bool = False) -> list[dict]:
    chunk = chunk.strip()
    if not chunk:
        return []
    if leading_brace and not chunk.lstrip().startswith("{"):
        chunk = "{\n" + chunk
    if trailing_brace and not chunk.rstrip().endswith("}"):
        chunk = chunk.rstrip().rstrip(",") + "\n    }"
    wrapped = "[" + chunk.rstrip(",") + "]"
    return json.loads(wrapped)


def fix_store() -> None:
    text = STORE.read_text(encoding="utf-8")
    if "<<<<<<< HEAD" not in text:
        print("store.json: no conflict markers")
        return

    match = CONFLICT_RE.search(text)
    if not match:
        raise SystemExit("store.json: unrecognized conflict format")

    head_entries = parse_entries(match.group(1), leading_brace=True, trailing_brace=True)
    theirs_entries = parse_entries(match.group(2), leading_brace=True, trailing_brace=True)
    prefix = text[: match.start()]
    suffix = text[match.end() :]

    if prefix.rstrip().endswith("{"):
        prefix = prefix.rstrip()[:-1].rstrip().rstrip(",")

    merged: dict[tuple[str, str], dict] = {}
    for entry in theirs_entries + head_entries:
        key = (entry["video_id"], entry.get("snapshot_bucket", entry.get("snapshot_time", "")))
        merged[key] = entry

    entries = sorted(
        merged.values(),
        key=lambda row: (row.get("snapshot_time", ""), row["video_id"]),
    )

    lines = []
    for entry in entries:
        blob = json.dumps(entry, ensure_ascii=False, indent=2)
        lines.append("    " + blob.replace("\n", "\n    "))
    body = ",\n".join(lines)

    suffix_clean = suffix.lstrip()
    if suffix_clean.startswith("}"):
        newline = suffix_clean.find("\n")
        suffix_clean = suffix_clean[newline + 1 :] if newline >= 0 else ""

    rebuilt = f"{prefix},\n{body}\n{suffix_clean}"
    data = json.loads(rebuilt)
    STORE.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"store.json: repaired ({len(data['history'])} history rows)")


def fix_site() -> None:
    text = SITE.read_text(encoding="utf-8")
    if "<<<<<<< HEAD" not in text:
        print("site.json: no conflict markers")
        return

    match = CONFLICT_RE.search(text)
    if not match:
        raise SystemExit("site.json: unrecognized conflict format")

    head = match.group(1).strip()
    theirs = match.group(2).strip()
    # Prefer newer generated_at from HEAD when both are single-line timestamps.
    chosen = head if head else theirs
    rebuilt = text[: match.start()] + chosen + text[match.end() :]
    data = json.loads(rebuilt)
    SITE.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("site.json: repaired")


def main() -> int:
    fix_store()
    fix_site()
    json.load(STORE.open(encoding="utf-8"))
    json.load(SITE.open(encoding="utf-8"))
    print("validation ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
