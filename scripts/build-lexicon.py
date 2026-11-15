"""Rebuild extension/data/{en,de}.lex: corpus words that Hunspell accepts, with real casing.

Maintainer-only; the generated lists are committed. Needs network and a venv:
  python3 -m venv .venv && .venv/bin/pip install spylls==0.1.7
  .venv/bin/python scripts/build-lexicon.py
Frequency source: FrequencyWords (OpenSubtitles 2018, CC BY-SA 4.0), pinned revision.
Validity: Hunspell dictionaries from npm dictionary-en 4.0.0 / dictionary-de 3.0.0, checked
with spylls (a complete Hunspell port; nspell mis-handles the German affix rules).
"""
import io, re, sys, tarfile, urllib.request
from pathlib import Path
from spylls.hunspell import Dictionary

ROOT = Path(__file__).resolve().parents[1]
REV = '525f9b560de45753a5ea01069454e72e9aa541c6'
FREQ = 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/{rev}/content/2018/{lang}/{lang}_full.txt'
DICT = {'en': 'https://registry.npmjs.org/dictionary-en/-/dictionary-en-4.0.0.tgz',
        'de': 'https://registry.npmjs.org/dictionary-de/-/dictionary-de-3.0.0.tgz'}
MIN_COUNT = 3
WORD = re.compile(r'^[^\W\d_]{2,40}$')

def fetch(url):
    with urllib.request.urlopen(url) as r:
        return r.read()

def build(lang, work):
    with tarfile.open(fileobj=io.BytesIO(fetch(DICT[lang]))) as t:
        for name in ('index.aff', 'index.dic'):
            (work / f'{lang}.{name[6:]}').write_bytes(t.extractfile(f'package/{name}').read())
    hunspell = Dictionary.from_files(str(work / lang))
    out = []
    for line in fetch(FREQ.format(rev=REV, lang=lang)).decode('utf-8').splitlines():
        word, count = line.split()
        if int(count) < MIN_COUNT: break
        if not WORD.match(word): continue
        # The corpus is lower-cased; keep each casing Hunspell accepts ("Haus", "sie"/"Sie").
        for form in dict.fromkeys([word, word[0].upper() + word[1:]]):
            try: ok = hunspell.lookup(form)
            except IndexError: ok = False  # spylls casing bug on a few odd tokens
            if ok: out.append(f'{form} {count}')
    (ROOT / 'extension' / 'data' / f'{lang}.lex').write_text('\n'.join(out) + '\n', encoding='utf-8')
    print(lang, len(out), 'entries')

if __name__ == '__main__':
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        for lang in sys.argv[1:] or ['en', 'de']:
            build(lang, Path(tmp))
