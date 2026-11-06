#!/usr/bin/env python3
"""Prepare public parallel corpora without loading any project evaluation text.

Default is offline and verifies cached archives. --download permits fetching only
the pinned manifest URLs. Output belongs in a private work directory, not Git.
Canonical pairs preserve original corpus text. Source spans and raw alignments
are available in provenance.jsonl; no learner text enters this source file.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import difflib
import hashlib
import json
from pathlib import Path
import re
import tarfile
import unicodedata
import urllib.request


SALT = "localcorrect-context-v1\0"
SPLITS = ("train", "calibration", "test")


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def normalize(text):
    return "".join(c for c in unicodedata.normalize("NFKC", text).casefold() if c.isalnum())


def document_split(document_id):
    n = int(sha256((SALT + document_id).encode())[:8], 16) % 100
    return "train" if n < 80 else "calibration" if n < 90 else "test"


def dump_json(path, obj):
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def dump_jsonl(path, rows):
    with path.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")


def download_and_verify(source, raw, allow_download):
    path = raw / source["archive"]
    if not path.exists():
        if not allow_download:
            raise SystemExit(f"Missing {path}; use --download to acquire pinned public archives")
        temporary = path.with_suffix(path.suffix + ".part")
        with urllib.request.urlopen(source["url"]) as response, temporary.open("wb") as f:
            while chunk := response.read(1024 * 1024):
                f.write(chunk)
        temporary.replace(path)
    if path.stat().st_size != source["bytes"] or sha256(path.read_bytes()) != source["sha256"]:
        raise SystemExit(f"Archive size/SHA-256 mismatch: {path}")
    return path


def archive_text(archive, name):
    extracted = archive.extractfile(name)
    if extracted is None:
        raise ValueError(f"Not an archive file: {name}")
    return extracted.read().decode("utf-8")


def pair(source, document_id, ordinal, original, corrected):
    return {"id": f"{document_id}:{ordinal:04d}", "document_id": document_id,
            "language": "en" if source == "eracond" else "de", "source": source,
            "input": original, "expected": corrected, "split": document_split(document_id)}


def read_eracond(path, source, notices):
    rows, provenance = [], {}
    prefix = "eracond-" + source["revision"]
    with tarfile.open(path, "r:gz") as archive:
        (notices / "eracond-MIT.txt").write_text(archive_text(archive, prefix + "/LICENSE"))
        pattern = re.compile(re.escape(prefix) + r"/data/(\d+)/orig/(\d+)\.txt$")
        for name in sorted(archive.getnames()):
            match = pattern.fullmatch(name)
            if not match:
                continue
            group, conversation = match.groups()
            corr_name = name.replace("/orig/", "/corr/")
            original = archive_text(archive, name).splitlines()
            corrected = archive_text(archive, corr_name).splitlines()
            if len(original) != len(corrected):
                raise ValueError(f"Unaligned source/correction: {name}")
            document_id = f"eracond:{group}/{conversation}"
            for ordinal, (a, b) in enumerate(zip(original, corrected), 1):
                row = pair("eracond", document_id, ordinal, a, b)
                rows.append(row)
                provenance[row["id"]] = {"archive": source["archive"], "input_file": name,
                    "expected_file": corr_name, "source_line": ordinal,
                    "unit": "conversation utterance", "representation": "original untokenized strings",
                    "annotation": "corr; alternative corr2 not used",
                    "m2_file": name.replace("/orig/", "/m2/").replace(".txt", ".m2")}
    return rows, provenance


def read_german(path, source, notices):
    rows, provenance = [], {}
    ordinals = Counter()
    with tarfile.open(path, "r:gz") as archive:
        (notices / "boyd-data-CC-BY-SA-4.0.txt").write_text(archive_text(archive, "data/LICENSE"))
        for name in sorted(archive.getnames()):
            match = re.fullmatch(r"data/source/(falko|merlin)-id-ctok-zh1\.txt\.(train|dev|test)", name)
            if not match:
                continue
            component, published_split = match.groups()
            for line_number, line in enumerate(archive_text(archive, name).splitlines(), 1):
                columns = line.split("\t")
                if len(columns) == 2:
                    # Six original archive rows omit the corrected column. Do
                    # not invent a target; the empty-text audit excludes them.
                    columns.append("")
                if len(columns) != 3:
                    raise ValueError(f"Expected text ID, original, correction at {name}:{line_number}")
                text_id, original, corrected = columns
                document_id = f"{component}:{text_id}"
                ordinals[document_id] += 1
                row = pair(component, document_id, ordinals[document_id], original, corrected)
                rows.append(row)
                provenance[row["id"]] = {"archive": source["archive"], "input_file": name,
                    "expected_file": name, "source_line": line_number, "original_text_id": text_id,
                    "published_split": published_split, "unit": "aligned source sentence span",
                    "representation": "original tokenized strings; no detokenization",
                    "layers": "ctok -> ZH1/TH1, as extracted by Boyd 2018"}
    return rows, provenance


def split_and_deduplicate(rows):
    audit = []
    invalid = set()
    input_expected = defaultdict(lambda: defaultdict(list))
    for row in rows:
        a, b = normalize(row["input"]), normalize(row["expected"])
        if not a or not b:
            invalid.add(row["id"])
            audit.append({"reason": "empty_normalized_text", "ids": [row["id"]]})
        input_expected[(row["language"], a)][b].append(row["id"])
    for (_, input_key), values in sorted(input_expected.items()):
        if len(values) > 1:
            ids = sorted(i for group in values.values() for i in group)
            invalid.update(ids)
            audit.append({"reason": "conflicting_expected", "input_key_sha256": sha256(input_key.encode()), "ids": ids})
    occurrences = defaultdict(list)
    for row in rows:
        # Include even conflicting rows so a conflict cannot hide cross-split exposure.
        for key in set((normalize(row["input"]), normalize(row["expected"]))):
            occurrences[(row["language"], key)].append(row)
    for (language, key), group in sorted(occurrences.items()):
        if len({r["split"] for r in group}) > 1:
            invalid.update(r["id"] for r in group)
            audit.append({"reason": "cross_split_text_collision", "language": language,
                "normalized_text_sha256": sha256(key.encode()),
                "rows": [{"id": r["id"], "split": r["split"]} for r in sorted(group, key=lambda r: r["id"])]})
    seen, kept = {}, []
    for row in sorted(rows, key=lambda r: r["id"]):
        if row["id"] in invalid:
            continue
        key = (row["language"], normalize(row["input"]), normalize(row["expected"]))
        if key in seen:
            audit.append({"reason": "duplicate_pair", "kept_id": seen[key], "removed_id": row["id"]})
        else:
            kept.append(row)
            seen[key] = row["id"]
    return kept, audit


def alignment(original, corrected):
    a, b = list(re.finditer(r"\S+", original)), list(re.finditer(r"\S+", corrected))
    spans = []
    def char_range(tokens, start, end, text):
        if start == end:
            at = tokens[start].start() if start < len(tokens) else len(text)
            return [at, at]
        return [tokens[start].start(), tokens[end-1].end()]
    for op, i, j, k, l in difflib.SequenceMatcher(None, [t.group() for t in a], [t.group() for t in b], autojunk=False).get_opcodes():
        if op != "equal":
            spans.append({"operation": op, "input_tokens": [i, j], "expected_tokens": [k, l],
                          "input_chars": char_range(a, i, j, original), "expected_chars": char_range(b, k, l, corrected)})
    return spans


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--manifest", type=Path, default=Path(__file__).resolve().parents[1] / "context-data-sources.json")
    parser.add_argument("--download", action="store_true")
    args = parser.parse_args()
    output = args.output.resolve()
    repo = Path(__file__).resolve().parents[1]
    if output == repo or repo in output.parents:
        raise SystemExit("Learner data output must stay outside the source repository")
    raw, notices = output / "raw", output / "notices"
    raw.mkdir(parents=True, exist_ok=True)
    notices.mkdir(parents=True, exist_ok=True)
    manifest = json.loads(args.manifest.read_text())
    for notice in manifest.get("license_notices", []):
        path = download_and_verify(notice, raw, args.download)
        (notices / notice["archive"]).write_bytes(path.read_bytes())
    sources = {s["id"]: s for s in manifest["sources"]}
    archives = {key: download_and_verify(source, raw, args.download) for key, source in sources.items()}
    with tarfile.open(archives["boyd-wnut2018"], "r:gz") as archive:
        prefix = "boyd-wnut2018-" + sources["boyd-wnut2018"]["revision"]
        for filename, dest in [("LICENSE", "boyd-repository-CC-BY-SA-4.0.txt"), ("README.md", "boyd-README.md"), ("scripts/LICENSE", "boyd-unused-scripts-GPL-3.0.txt")]:
            (notices / dest).write_text(archive_text(archive, prefix + "/" + filename))
    en, en_prov = read_eracond(archives["eracond"], sources["eracond"], notices)
    de, de_prov = read_german(archives["falko-merlin-data"], sources["falko-merlin-data"], notices)
    original = en + de
    all_provenance = en_prov | de_prov
    kept, audit = split_and_deduplicate(original)
    dump_jsonl(output / "all.jsonl", kept)
    for split in SPLITS:
        dump_jsonl(output / (split + ".jsonl"), (r for r in kept if r["split"] == split))
    dump_jsonl(output / "collisions.jsonl", audit)
    dump_jsonl(output / "provenance.jsonl", ({"id": r["id"], **all_provenance[r["id"]],
        "alignment": alignment(r["input"], r["expected"])} for r in kept))
    dump_json(output / "source-manifest.json", manifest)
    def counts(rows):
        result = {}
        for source in sorted({r["source"] for r in rows}):
            subset = [r for r in rows if r["source"] == source]
            result[source] = {"pairs": len(subset), "documents": len({r["document_id"] for r in subset}),
                "unchanged": sum(r["input"] == r["expected"] for r in subset),
                "splits": {s: sum(r["split"] == s for r in subset) for s in SPLITS}}
        return result
    # Check document and normalized text separation as an independent assertion.
    docs, texts = defaultdict(set), defaultdict(set)
    for row in kept:
        docs[row["document_id"]].add(row["split"])
        for text in (row["input"], row["expected"]):
            texts[(row["language"], normalize(text))].add(row["split"])
    assert all(len(v) == 1 for v in docs.values())
    assert all(len(v) == 1 for v in texts.values())
    assert len({r["id"] for r in kept}) == len(kept)
    report = {"schema_version": 1, "raw_counts": counts(original), "retained_counts": counts(kept),
        "raw_pairs": len(original), "retained_pairs": len(kept), "removed_pairs": len(original)-len(kept),
        "audit_events": dict(Counter(x["reason"] for x in audit)),
        "split_contract": manifest["split"], "checks": {"unique_ids": True, "document_disjoint": True,
            "normalized_input_and_expected_disjoint": True},
        "source_script_sha256": sha256(Path(__file__).read_bytes()),
        "outputs": {f.name: {"bytes": f.stat().st_size, "sha256": sha256(f.read_bytes())}
                    for f in sorted(output.glob("*.jsonl"))}}
    dump_json(output / "report.json", report)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
