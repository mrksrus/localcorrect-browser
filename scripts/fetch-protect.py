"""Restore the exact attributed protective sources from their pinned manifest.
Offline builds only need the vendored files; running this script uses the network.
"""
from pathlib import Path
import hashlib
import json
import urllib.request

root = Path(__file__).resolve().parents[1] / 'packages/core/vendor/protect-vocabulary'
manifest = json.loads((root / 'sources.json').read_text())

def fetch(url, limit):
    request = urllib.request.Request(url, headers={'User-Agent': 'LocalCorrect-source-restore'})
    with urllib.request.urlopen(request, timeout=45) as response:
        data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError('Source exceeds the bounded download size')
    return data

for source in manifest['sources']:
    if source['file'] == 'homebrew--formula-names.txt':
        project = next(p for p in manifest['additionalProjects'] if 'treeUrl' in p)
        raw = fetch(project['treeUrl'], 16_000_000)
        if hashlib.sha256(raw).hexdigest() != project['treeSha256']:
            raise ValueError('Pinned Homebrew source tree changed')
        tree = json.loads(raw)
        if tree.get('truncated'):
            raise ValueError('Incomplete Homebrew source tree')
        paths = [r['path'] for r in tree['tree'] if r['path'].startswith('Formula/') and r['path'].endswith('.rb')]
        if len(paths) != project['formulaPaths']:
            raise ValueError('Homebrew source count changed')
        data = ('\n'.join(sorted({Path(p).stem for p in paths})) + '\n').encode()
    else:
        data = fetch(source['url'], 500_000)
    if len(data) != source['bytes'] or hashlib.sha256(data).hexdigest() != source['sha256']:
        raise ValueError('Pinned protective source changed: ' + source['file'])
    (root / source['file']).write_bytes(data)
print('Restored', len(manifest['sources']), 'hash-verified protective source files.')
