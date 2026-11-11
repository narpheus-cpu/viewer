#!/usr/bin/env python3
"""Attach evidence-checked v2 reading insights JSON to a TXT without rewriting novel bytes.

Usage:
  python tools/pack-reader-insights-v2.py original.txt insights.json combined.txt

The resulting TXT is directly importable in the GitHub EPUB/TXT reader.
"""
import argparse
import json
from pathlib import Path

BEGIN = "<<<READER_INSIGHTS_V2_BEGIN>>>"
END = "<<<READER_INSIGHTS_V2_END>>>"
TYPES = {"event", "relation", "character", "clue"}
CERTAINTY = {"fact", "strong_inference", "tentative"}


def occurrence_end(text, phrase, occurrence):
    start = 0
    for _ in range(occurrence):
        found = text.find(phrase, start)
        if found < 0:
            return -1
        start = found + len(phrase)
    return start


def validate(novel, document):
    if not isinstance(document, dict) or document.get("schema_version") != 2:
        raise ValueError("schema_version must be 2")
    records = document.get("records")
    if not isinstance(records, list) or len(records) > 3000:
        raise ValueError("records must be an array of at most 3000 entries")
    previous = {}
    for number, record in enumerate(records, 1):
        if not isinstance(record, dict):
            raise ValueError(f"Record {number} must be an object")
        rid = record.get("id")
        if not isinstance(rid, str) or not rid.strip() or rid in previous:
            raise ValueError(f"Duplicate/missing id at {number}")
        if record.get("category") not in TYPES:
            raise ValueError(f"{rid}: invalid category")
        if record.get("confidence") not in CERTAINTY:
            raise ValueError(f"{rid}: invalid confidence")
        for field in ("title", "text", "evidence"):
            if not isinstance(record.get(field), str) or not record[field].strip():
                raise ValueError(f"{rid}: missing {field}")
        reveal = record.get("reveal")
        if not isinstance(reveal, dict):
            raise ValueError(f"{rid}: missing reveal")
        phrase, occurrence = reveal.get("quote"), reveal.get("occurrence")
        if not isinstance(phrase, str) or not 20 <= len(phrase) <= 500:
            raise ValueError(f"{rid}: reveal.quote must have 20-500 chars")
        if type(occurrence) is not int or not 1 <= occurrence <= 100000:
            raise ValueError(f"{rid}: invalid reveal.occurrence")
        end = occurrence_end(novel, phrase, occurrence)
        if end < 0:
            raise ValueError(f"{rid}: reveal quote does not exist in the novel")
        if novel.rfind(record["evidence"], 0, end) < 0:
            raise ValueError(f"{rid}: evidence is not before unlock point")
        replaced = record.get("replaces")
        if replaced is not None and (replaced not in previous or previous[replaced] > end):
            raise ValueError(f"{rid}: replaces must refer to an earlier unlocked record")
        order = record.get("story_order")
        if order is not None and (type(order) is not int or order < 1):
            raise ValueError(f"{rid}: invalid story_order")
        previous[rid] = end
    return len(records)


def main():
    arg = argparse.ArgumentParser(description="Build an integrated TXT without rewriting the original novel")
    arg.add_argument("novel", type=Path, help="original UTF-8 TXT")
    arg.add_argument("metadata", type=Path, help="reading insights v2 JSON")
    arg.add_argument("output", type=Path, help="combined TXT destination")
    opts = arg.parse_args()
    if opts.output.resolve() in {opts.novel.resolve(), opts.metadata.resolve()}:
        arg.error("Output must be a separate file to protect the original.")
    original = opts.novel.read_bytes()
    novel = original.decode("utf-8-sig")
    if BEGIN in novel or END in novel:
        arg.error("Source already contains a reading insights marker.")
    data = json.loads(opts.metadata.read_text(encoding="utf-8-sig"))
    count = validate(novel, data)
    encoded = json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")
    # Only append to the original byte stream, leaving everything before the separator intact.
    result = original + ("\n\n" + BEGIN + "\n").encode("utf-8") + encoded + ("\n" + END + "\n").encode("utf-8")
    opts.output.write_bytes(result)
    print(f"Created: {opts.output} | {len(original)} original bytes intact | {count} insights")


if __name__ == "__main__":
    main()
