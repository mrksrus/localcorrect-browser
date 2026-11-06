#!/usr/bin/env python3
"""Prepare strict real Wiki pairs and train-only fixed-family inverse noise.

Default is offline. --download fetches only manifest-pinned public source files.
Outputs must stay outside Git. No models, private user text or project quality
fixtures are read; original corpus splits are read only for duplicate exclusion.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import difflib
import hashlib
import json
from pathlib import Path
import re
import unicodedata
import urllib.parse
import urllib.request


TOKEN = re.compile(r"[A-Za-zÀ-ÖØ-öø-ÿĀ-ž]+(?:['’][A-Za-zÀ-ÖØ-öø-ÿĀ-ž]+)*|[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]")
WORD = re.compile(r"[a-z]+\Z")
NUMBER = re.compile(r"\d+(?:[.,]\d+)*")
SPLITS = ("train", "calibration", "test")
NUMBER_WORDS = set("zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand million billion first second third fourth fifth sixth seventh eighth ninth tenth last next former latter earlier later".split())
NEGATIONS = set("no not never none neither nor without cannot nothing nobody nowhere".split())
INVERSE_FAMILIES = (("a", "an"), ("is", "are"), ("was", "were"), ("has", "have"),
                    ("does", "do"), ("from", "form"), ("their", "there"),
                    ("then", "than"), ("where", "were"), ("to", "too"))


def digest(data):
    return hashlib.sha256(data).hexdigest()


def normalized(text):
    return "".join(c for c in unicodedata.normalize("NFKC", text).casefold() if c.isalnum())


def split_for(document_id):
    value = int(digest(("localcorrect-context-v1\0" + document_id).encode())[:8], 16) % 100
    return "train" if value < 80 else "calibration" if value < 90 else "test"


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_jsonl(path, rows):
    with path.open("w", encoding="utf-8") as target:
        for row in rows:
            target.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")


def acquire(source, raw, allow_download):
    path = raw / source["file"]
    if not path.exists():
        if not allow_download:
            raise SystemExit(f"Missing pinned source {path}; use --download")
        temporary = path.with_suffix(path.suffix + ".part")
        with urllib.request.urlopen(source["url"]) as response, temporary.open("wb") as target:
            while chunk := response.read(1024*1024):
                target.write(chunk)
        temporary.replace(path)
    data = path.read_bytes()
    if len(data) != source["bytes"] or digest(data) != source["sha256"]:
        raise SystemExit(f"Pinned source SHA-256/size mismatch: {path}")
    return path


def distance(a, b):
    previous = list(range(len(b)+1))
    for i, x in enumerate(a, 1):
        current = [i]
        for j, y in enumerate(b, 1):
            current.append(min(current[-1]+1, previous[j]+1, previous[j-1]+(x != y)))
        previous = current
    return previous[-1]


def inventory(root, manifest):
    for source in manifest["local_inputs"]:
        if digest((root/source["file"]).read_bytes()) != source["sha256"]:
            raise SystemExit("Public inventory does not match pinned input: " + source["file"])
    code = (root/"packages/core/src/lexicons/en.js").read_text()
    match = re.search(r"\bexport default\s+", code)
    words, end = json.JSONDecoder().raw_decode(code[match.end():])
    if not isinstance(words, str):
        raise ValueError("Expected public English inventory string")
    known = set(words.splitlines())
    known.update(word.lower() for word in tuple(known))
    frequencies = {}
    for line in (root/"packages/core/dictionaries/en.txt").read_text().splitlines():
        fields = line.split()
        if len(fields) != 2 or not fields[1].isdigit():
            raise ValueError("Malformed public frequency inventory")
        frequencies[fields[0]] = int(fields[1])
    known.update(frequencies)
    return known, frequencies


def read_base(directory, manifest):
    original, texts, identities = {}, set(), set()
    for split, source in manifest["immutable_base"].items():
        data = (directory/source["file"]).read_bytes()
        if digest(data) != source["sha256"]:
            raise SystemExit("Immutable original split differs: " + split)
        rows = [json.loads(line) for line in data.decode().splitlines()]
        if len(rows) != source["rows"] or any(row["split"] != split for row in rows):
            raise ValueError("Invalid immutable original split")
        for row in rows:
            if row["id"] in identities:
                raise ValueError("Duplicate immutable original ID")
            identities.add(row["id"])
            for text in (row["input"], row["expected"]):
                texts.add(normalized(text))
        original[split] = data
    return original, texts, identities


def article_identity(url):
    parsed = urllib.parse.urlparse(url)
    query = urllib.parse.parse_qs(parsed.query)
    if parsed.scheme != "https" or parsed.hostname != "en.wikipedia.org" or parsed.path != "/w/index.php" or len(query.get("curid", [])) != 1 or not query["curid"][0].isdigit():
        raise ValueError("Missing canonical English Wikipedia article ID")
    article = query["curid"][0]
    return "wikiedits-en:" + article, {
        "article_url": "https://en.wikipedia.org/?curid=" + article,
        "history_url": "https://en.wikipedia.org/w/index.php?curid=" + article + "&action=history",
        "diff_url": url, "article_title": query.get("title", [None])[0],
        "old_revision": query.get("oldid", [None])[0], "new_revision": query.get("diff", [None])[0]}


def filter_pair(row, metadata, known, frequencies, families):
    original, corrected = row["text"], row["correction"]
    if not isinstance(original, str) or not isinstance(corrected, str) or not original.strip() or not corrected.strip():
        return "empty_text", None
    if max(len(original.encode("utf-16-le"))//2, len(corrected.encode("utf-16-le"))//2) > 20000:
        return "oversized", None
    if NUMBER.findall(original) != NUMBER.findall(corrected):
        return "numeric_change", None
    source, target = list(TOKEN.finditer(original)), list(TOKEN.finditer(corrected))
    a, b = [m.group() for m in source], [m.group() for m in target]
    hunks = [op for op in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes() if op[0] != "equal"]
    if not hunks:
        return "no_supported_word_change", None
    if any(tag != "replace" or j-i != 1 or l-k != 1 for tag, i, j, k, l in hunks):
        return "unsupported_hunk", None
    replacements = []
    for _, i, j, k, l in hunks:
        old, new = a[i], b[k]
        if not WORD.fullmatch(old) or not WORD.fullmatch(new):
            return "case_name_punctuation_or_non_ascii", None
        agreement = any(old in family and new in family for family in families)
        if not agreement and (abs(len(old)-len(new)) > 2 or distance(old, new) > 2):
            return "nonminimal_lexical_change", None
        if old in NUMBER_WORDS or new in NUMBER_WORDS or old in NEGATIONS or new in NEGATIONS:
            return "number_word_or_negation", None
        if frequencies.get(new, 0) < 1000:
            return "rare_target", None
        if not agreement and old in known:
            return "attested_real_word_style_or_semantic_change", None
        if not agreement and len(old) < 3:
            return "short_unknown_fragment", None
        # Changed lower-case names and link labels can still be encyclopedic
        # entities. Reject any changed word appearing in an original/target link.
        linked = " ".join(re.findall(r"\[\[[^\]]*\]\]", str(metadata.get("text_del", "")) + " " + str(metadata.get("text_ins", ""))))
        if any(re.search(r"(?<![\w])" + re.escape(word) + r"(?![\w])", linked, re.IGNORECASE) for word in (old, new)):
            return "linked_entity_edit", None
        start, end = source[i].span()
        # Do not infer that a quote is a factual correction target.
        quoted = re.findall(r'"[^"\n]*"|“[^”\n]*”|‘[^’\n]*’', original)
        if any(re.search(r"\b" + re.escape(old) + r"\b", quote, re.IGNORECASE) for quote in quoted):
            return "quoted_word_edit", None
        replacements.append({"input_start": start, "input_end": end, "original": old,
                             "replacement": new, "agreement_family": agreement})
    rebuilt = original
    for edit in reversed(replacements):
        rebuilt = rebuilt[:edit["input_start"]] + edit["replacement"] + rebuilt[edit["input_end"]:]
    if rebuilt != corrected:
        return "concealed_whitespace_or_unrepresented_change", None
    return None, replacements


def deduplicate(rows, base_texts):
    rejected, audit = set(), []
    for row in rows:
        if any(normalized(row[field]) in base_texts for field in ("input", "expected")):
            rejected.add(row["id"])
            audit.append({"reason": "overlap_with_immutable_original_text", "ids": [row["id"]]})
    occurrences, targets = defaultdict(list), defaultdict(lambda: defaultdict(list))
    for row in rows:
        keys = set((normalized(row["input"]), normalized(row["expected"])))
        if "" in keys:
            rejected.add(row["id"])
            audit.append({"reason": "empty_normalized_text", "ids": [row["id"]]})
        for key in keys:
            occurrences[key].append(row)
        targets[normalized(row["input"])][normalized(row["expected"])].append(row["id"])
    for key, group in sorted(occurrences.items()):
        if len({row["split"] for row in group}) > 1:
            rejected.update(row["id"] for row in group)
            audit.append({"reason": "cross_split_wikipedia_text_collision", "key_sha256": digest(key.encode()),
                          "rows": [{"id": row["id"], "split": row["split"]} for row in group]})
    for key, values in sorted(targets.items()):
        if len(values) > 1:
            ids = sorted(identity for group in values.values() for identity in group)
            rejected.update(ids)
            audit.append({"reason": "conflicting_expected", "input_key_sha256": digest(key.encode()), "ids": ids})
    kept, seen = [], {}
    for row in sorted(rows, key=lambda row: row["id"]):
        if row["id"] in rejected:
            continue
        key = normalized(row["input"]), normalized(row["expected"])
        if key in seen:
            audit.append({"reason": "duplicate_pair", "kept_id": seen[key], "removed_id": row["id"]})
        else:
            seen[key] = row["id"]
            kept.append(row)
    return kept, audit


def reference_rejection(text):
    """A mechanical weak-clean screen, never a claim of grammatical correctness."""
    if not isinstance(text, str) or not text.strip():
        return "empty_reference"
    if text != text.strip() or "\n" in text or "\r" in text:
        return "reference_whitespace_or_multiline"
    if len(text.encode("utf-16-le"))//2 > 20000:
        return "oversized_reference"
    if re.search(r"[\"'“”‘’«»‹›`]|https?://|www\.|\b\w+://|\b\S+@\S+", text, re.IGNORECASE):
        return "reference_quote_code_or_url"
    if re.search(r"[<>{}\[\]()\\|_=~#*]|&(?:[A-Za-z]+|#\d+);", text):
        return "reference_markup_code_or_parenthesis"
    words = [match.group().lower() for match in TOKEN.finditer(text) if match.group().isalpha()]
    if any(char.isdigit() for char in text) or set(words) & NUMBER_WORDS:
        return "reference_number"
    if set(words) & NEGATIONS or re.search(r"\b\w+n['’]t\b", text, re.IGNORECASE):
        return "reference_negation"
    # Keep complete prose paragraphs, not extracted clauses, lists or headings.
    # Each sentence must have a capitalized start, a final full stop, and enough
    # words to exclude short fragments. This is deliberately only a weak screen.
    if not re.fullmatch(r"[A-Z][\s\S]*\.", text) or re.search(r"[!?;:]|\.\.|[–—]", text):
        return "reference_fragment_or_complex_punctuation"
    sentences = re.split(r"(?<=\.)\s+", text)
    for sentence in sentences:
        tokens = list(TOKEN.finditer(sentence))
        count = sum(match.group().isalpha() for match in tokens)
        if not re.fullmatch(r"[A-Z][\s\S]*\.", sentence) or count < 8 or count > 160:
            return "reference_fragment_or_sentence_length"
    return None


def inverse_noise(english, by_index, strict, base_texts, manifest):
    config = manifest["inverse_noise"]
    if config["families"] != [list(family) for family in INVERSE_FAMILIES]:
        raise ValueError("Inverse-noise families must match the fixed authorized families")
    if (config["max_total"], config["max_per_reference"], config["max_per_direction"]) != (30000, 6, 4000):
        raise ValueError("Inverse-noise caps differ from the fixed authorized limits")
    # Check every publisher input/reference, including rows rejected by the
    # strict real-pair filter, to avoid carrying a repeated paragraph across
    # article-hash splits. These are public source records, not quality gold.
    source_splits = defaultdict(set)
    for row in english:
        document_id, _ = article_identity(by_index[row["index"]]["url"])
        split = split_for(document_id)
        for text in (row["text"], row["correction"]):
            if isinstance(text, str):
                source_splits[normalized(text)].add(split)
    strict_text_splits = defaultdict(set)
    for row in strict:
        for text in (row["input"], row["expected"]):
            strict_text_splits[normalized(text)].add(row["split"])
    candidates, provenance, audit = [], {}, []
    references = set()
    for row in english:
        document_id, attribution = article_identity(by_index[row["index"]]["url"])
        if split_for(document_id) != "train":
            continue
        reference_id = f"{document_id}:{row['index']}"
        reference = row["correction"]
        reason = reference_rejection(reference)
        if reason:
            audit.append({"reference_id": reference_id, "reason": reason})
            continue
        reference_key = normalized(reference)
        if reference_key in base_texts:
            audit.append({"reference_id": reference_id, "reason": "reference_overlap_with_immutable_base"})
            continue
        if source_splits[reference_key] != {"train"}:
            audit.append({"reference_id": reference_id, "reason": "reference_wiki_cross_split_collision"})
            continue
        references.add(reference_id)
        for token in TOKEN.finditer(reference):
            target = token.group()
            for family in INVERSE_FAMILIES:
                if target not in family:
                    continue
                original = family[1] if target == family[0] else family[0]
                start = token.start()
                corrupted = reference[:start] + original + reference[token.end():]
                identity = f"{reference_id}:inverse:{start}:{original}-{target}"
                key = normalized(corrupted)
                if key in base_texts or source_splits.get(key, {"train"}) != {"train"} or strict_text_splits.get(key, {"train"}) != {"train"}:
                    audit.append({"id": identity, "reason": "mutation_base_or_wiki_cross_split_collision"})
                    continue
                # Validate one exact word mutation and byte-for-byte restoration.
                end = start + len(original)
                if corrupted[start:end] != original or corrupted[:start] + target + corrupted[end:] != reference:
                    raise ValueError("Inverse-noise restoration failed")
                a = [match.group() for match in TOKEN.finditer(corrupted)]
                b = [match.group() for match in TOKEN.finditer(reference)]
                hunks = [op for op in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes() if op[0] != "equal"]
                if len(hunks) != 1 or hunks[0][0] != "replace" or hunks[0][2]-hunks[0][1] != 1 or hunks[0][4]-hunks[0][3] != 1:
                    raise ValueError("Inverse-noise must contain exactly one word replacement")
                candidate = {"id": identity, "document_id": document_id, "language": "en",
                    "source": "wikiedits-multigec-en-inverse-noise", "input": corrupted, "expected": reference,
                    "split": "train", "target_quality": "weakly_clean_publisher_correction_not_verified",
                    "synthetic": True, "reference_id": reference_id, "direction": original + "->" + target}
                candidates.append(candidate)
                provenance[identity] = {"id": identity, "reference_id": reference_id, "source_index": row["index"],
                    "dataset_revision": manifest["revision"], **attribution,
                    "license": "CC-BY-SA-4.0 underlying article text; MIT publisher dataset-card declaration",
                    "modification": "One fixed-family word mutation of an exact whole publisher correction reference, for training only.",
                    "target_quality": candidate["target_quality"], "synthetic": True,
                    "reference_sha256": digest(reference.encode()), "input_sha256": digest(corrupted.encode()),
                    "edits": [{"input_start": start, "input_end": end, "original": original, "replacement": target}],
                    "selection_sha256": digest(("localcorrect-inverse-v1\0" + identity).encode())}
    # Detect ambiguous input labels before imposing caps, so selection cannot
    # hide conflicts. Strict real pairs always retain priority.
    all_targets = defaultdict(set)
    for row in strict + candidates:
        all_targets[normalized(row["input"])].add(normalized(row["expected"]))
    per_reference, per_direction, selected, seen = Counter(), Counter(), [], set()
    strict_pairs = {(normalized(row["input"]), normalized(row["expected"])) for row in strict}
    for row in sorted(candidates, key=lambda item: (provenance[item["id"]]["selection_sha256"], item["id"])):
        pair = normalized(row["input"]), normalized(row["expected"])
        if len(all_targets[pair[0]]) != 1:
            reason = "conflicting_expected"
        elif pair in strict_pairs or pair in seen:
            reason = "duplicate_pair"
        elif len(selected) >= config["max_total"]:
            reason = "total_cap"
        elif per_reference[row["reference_id"]] >= config["max_per_reference"]:
            reason = "reference_cap"
        elif per_direction[row["direction"]] >= config["max_per_direction"]:
            reason = "direction_cap"
        else:
            selected.append(row)
            seen.add(pair)
            per_reference[row["reference_id"]] += 1
            per_direction[row["direction"]] += 1
            continue
        audit.append({"id": row["id"], "reason": reason})
    selected.sort(key=lambda row: row["id"])
    report = {"quality": "weakly_clean_publisher_correction_not_verified", "synthetic": True, "split": "train",
        "mechanically_eligible_references": len(references), "candidate_mutations": len(candidates),
        "retained_rows": len(selected), "retained_references": len(per_reference),
        "retained_articles": len({row["document_id"] for row in selected}),
        "direction_counts": {direction: per_direction[direction] for direction in sorted({a + "->" + b for family in INVERSE_FAMILIES for a in family for b in family if a != b})},
        "max_selected_per_reference": max(per_reference.values(), default=0),
        "audit_reasons": dict(Counter(item["reason"] for item in audit))}
    return selected, [provenance[row["id"]] for row in selected], audit, report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--base", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, default=Path(__file__).resolve().parents[1]/"context-wikipedia-sources.json")
    parser.add_argument("--download", action="store_true")
    args = parser.parse_args()
    import pyarrow
    import pyarrow.parquet as parquet
    root, output, base = Path(__file__).resolve().parents[1], args.output.resolve(), args.base.resolve()
    if output == root or root in output.parents or output == base or base in output.parents:
        raise SystemExit("Output must be outside the repository and immutable original corpus")
    output.mkdir(parents=True, exist_ok=True)
    raw = output/"raw"
    raw.mkdir(exist_ok=True)
    manifest = json.loads(args.manifest.read_text())
    paths = {source["file"]: acquire(source, raw, args.download) for source in manifest["downloads"]}
    known, frequencies = inventory(root, manifest)
    original, base_texts, original_ids = read_base(base, manifest)
    main_table = parquet.read_table(paths["wikiedits_multi_gec.parquet"])
    metadata_table = parquet.read_table(paths["wikiedits_multi_gec_metadata.parquet"])
    all_rows, meta_rows = main_table.to_pylist(), metadata_table.to_pylist()
    if len({row["index"] for row in all_rows}) != len(all_rows) or len({row["index"] for row in meta_rows}) != len(meta_rows):
        raise ValueError("Source index is not unique")
    by_index = {row["index"]: row for row in meta_rows}
    if set(by_index) != {row["index"] for row in all_rows}:
        raise ValueError("Main and metadata source indices differ")
    candidates, provenance, rejected = [], {}, []
    families = [set(value) for value in manifest["selection"]["agreement_families"]]
    english = [row for row in all_rows if row["language"] == "english"]
    for row in english:
        metadata = by_index[row["index"]]
        if metadata["language"] != row["language"]:
            raise ValueError("Joined language differs")
        document_id, attribution = article_identity(metadata["url"])
        identity = f"{document_id}:{row['index']}"
        if identity in original_ids:
            raise ValueError("Wikipedia ID collides with original ID")
        reason, edits = filter_pair(row, metadata, known, frequencies, families)
        if reason:
            rejected.append({"id": identity, "source_index": row["index"], "reason": reason})
            continue
        candidate = {"id": identity, "document_id": document_id, "language": "en", "source": "wikiedits-multigec-en",
                     "input": row["text"], "expected": row["correction"], "split": split_for(document_id)}
        candidates.append(candidate)
        provenance[identity] = {"id": identity, "source_index": row["index"], "dataset_revision": manifest["revision"],
            **attribution, "license": "CC-BY-SA-4.0 underlying article text; MIT publisher dataset-card declaration",
            "modification": "Original publisher-provided paragraph pairs preserved exactly; mechanically selected, not manually rewritten.",
            "input_sha256": digest(row["text"].encode()), "expected_sha256": digest(row["correction"].encode()), "edits": edits}
    kept, collisions = deduplicate(candidates, base_texts)
    synthetic, synthetic_provenance, synthetic_audit, synthetic_report = inverse_noise(english, by_index, kept, base_texts, manifest)
    write_jsonl(output/"wiki-all.jsonl", kept)
    write_jsonl(output/"wiki-inverse-train.jsonl", synthetic)
    write_jsonl(output/"wiki-inverse-provenance.jsonl", synthetic_provenance)
    write_jsonl(output/"wiki-inverse-audit.jsonl", synthetic_audit)
    for split in SPLITS:
        rows = [row for row in kept if row["split"] == split]
        destination = output/("wiki-" + split + ".jsonl")
        write_jsonl(destination, rows)
        combined = original[split] + destination.read_bytes() + ((output/"wiki-inverse-train.jsonl").read_bytes() if split == "train" else b"")
        if not original[split].endswith(b"\n"):
            raise ValueError("Immutable original lacks its JSONL newline")
        (output/(split + "-v2.jsonl")).write_bytes(combined)
        assert combined[:len(original[split])] == original[split]
    write_jsonl(output/"wiki-provenance.jsonl", (provenance[row["id"]] for row in kept))
    write_jsonl(output/"filter-audit.jsonl", rejected)
    write_jsonl(output/"collision-audit.jsonl", collisions)
    write_json(output/"source-manifest.json", manifest)
    documents, texts = defaultdict(set), defaultdict(set)
    for row in kept + synthetic:
        documents[row["document_id"]].add(row["split"])
        for value in (row["input"], row["expected"]):
            key = normalized(value)
            assert key not in base_texts
            texts[key].add(row["split"])
    assert all(len(values) == 1 for values in documents.values())
    assert all(len(values) == 1 for values in texts.values())
    report = {"schema_version": 1, "dataset_revision": manifest["revision"], "pyarrow_version": pyarrow.__version__,
        "main_source_rows": len(all_rows), "metadata_source_rows": len(meta_rows), "english_source_rows": len(english),
        "mechanically_selected_rows": len(candidates), "retained_wikipedia_rows": len(kept),
        "retained_articles": len({row["document_id"] for row in kept}), "filter_reasons": dict(Counter(row["reason"] for row in rejected)),
        "collision_reasons": dict(Counter(row["reason"] for row in collisions)),
        "inverse_noise": synthetic_report,
        "wikipedia_splits": {split: {"rows": sum(row["split"] == split for row in kept),
                                   "articles": len({row["document_id"] for row in kept if row["split"] == split})} for split in SPLITS},
        "combined_rows": {split: manifest["immutable_base"][split]["rows"] + sum(row["split"] == split for row in kept) + (len(synthetic) if split == "train" else 0) for split in SPLITS},
        "checks": {"source_join_one_to_one": True, "original_split_bytes_preserved": True,
                   "no_overlap_with_any_original_normalized_text": True, "wikipedia_articles_split_disjoint": True,
                   "wikipedia_input_and_expected_text_split_disjoint": True,
                   "synthetic_train_only": all(row["split"] == "train" and split_for(row["document_id"]) == "train" for row in synthetic),
                   "synthetic_exact_single_mutation_restoration": True,
                   "synthetic_caps_respected": len(synthetic) <= 30000 and synthetic_report["max_selected_per_reference"] <= 6 and max(synthetic_report["direction_counts"].values(), default=0) <= 4000,
                   "synthetic_reference_screened": True, "quality_gold_or_model_used": False},
        "limitations": ["Mechanically selected Wikipedia revisions are not certified grammar corrections.",
                        "Strict real pairs preserve whole publisher paragraphs; no filter widening or extraction occurs.",
                        "Train-only inverse noise targets are weakly clean publisher corrections, not verified error-free text. Mutations may occasionally remain valid; this is noisy training supervision, never evaluation gold.",
                        "Original learner text and derived article paragraphs remain private work data."],
        "script_sha256": digest(Path(__file__).read_bytes()),
        "outputs": {path.name: {"bytes": path.stat().st_size, "sha256": digest(path.read_bytes())} for path in sorted(output.glob("*.jsonl"))}}
    write_json(output/"report.json", report)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
