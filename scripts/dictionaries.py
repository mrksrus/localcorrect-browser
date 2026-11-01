#!/usr/bin/env python3
"""Reproduce CC BY-SA 4.0 dictionary data from pinned public sources.
Network is used by this maintainer-only script, never by correction runtime.
"""
from pathlib import Path
import hashlib
import json
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
REVISION = '525f9b560de45753a5ea01069454e72e9aa541c6'
BASE = f'https://raw.githubusercontent.com/hermitdave/FrequencyWords/{REVISION}/'
TARGET = ROOT / 'packages/core/dictionaries'
TARGET.mkdir(parents=True, exist_ok=True)
NOTICES = ROOT / 'licenses'
NOTICES.mkdir(exist_ok=True)


def download(url):
    with urllib.request.urlopen(url, timeout=45) as response:
        return response.read()


sources = {}
for language in ['en', 'de']:
    url = BASE + f'content/2018/{language}/{language}_50k.txt'
    raw = download(url)
    entries = []
    for line in raw.decode('utf-8').splitlines():
        word, count = line.rsplit(' ', 1)
        # Single lowercase alphabetic tokens, useful length, minimum frequency.
        # Keep corpus order; no invented probabilities or curated replacements.
        if 2 <= len(word) <= 24 and word.isalpha() and word == word.lower() and int(count) >= 150:
            entries.append((word, int(count)))
    entries = entries[:30000]
    output = ''.join(f'{word} {count}\n' for word, count in entries).encode()
    (TARGET / f'{language}.txt').write_bytes(output)
    sources[language] = dict(url=url, source_sha256=hashlib.sha256(raw).hexdigest(),
                             output_sha256=hashlib.sha256(output).hexdigest(), words=len(entries))
for name in ['README.md', 'LICENSE']:
    (NOTICES / ('FrequencyWords-' + name)).write_bytes(download(BASE + name))
(NOTICES / 'CC-BY-SA-4.0.txt').write_bytes(download('https://raw.githubusercontent.com/spdx/license-list-data/main/text/CC-BY-SA-4.0.txt'))
(ROOT / 'LICENSE').write_bytes(download('https://raw.githubusercontent.com/spdx/license-list-data/main/text/GPL-3.0-only.txt'))
(ROOT / 'dictionary-sources.json').write_text(json.dumps(dict(revision=REVISION, license='CC-BY-SA-4.0', sources=sources), indent=2) + '\n')
print(json.dumps(sources, indent=2))
