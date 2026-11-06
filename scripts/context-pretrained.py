"""Restore the public, hash-pinned pretrained base. Never execute remote code."""
import argparse
import hashlib
import json
from pathlib import Path
import urllib.request

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--download', action='store_true')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
manifest = json.loads((root/'context-pretrained-sources.json').read_text())
args.output.mkdir(parents=True, exist_ok=True)
for name, record in manifest['files'].items():
    if Path(name).name != name:
        raise ValueError('Invalid pinned filename')
    destination = args.output/name
    if not destination.exists():
        if not args.download:
            raise SystemExit('Missing pinned base file. Use --download: '+name)
        temporary = destination.with_suffix(destination.suffix+'.part')
        with urllib.request.urlopen(record['url'], timeout=60) as response, temporary.open('wb') as target:
            while chunk := response.read(1024*1024):
                target.write(chunk)
        temporary.replace(destination)
    data = destination.read_bytes()
    if len(data) != record['bytes'] or hashlib.sha256(data).hexdigest() != record['sha256']:
        raise SystemExit('Pinned base file mismatch: '+name)
base_manifest={key:manifest[key] for key in ('repo','revision','files')}
(args.output/'manifest.json').write_text(json.dumps(base_manifest,indent=2)+'\n')
print(json.dumps({'verified':True,'repo':manifest['repo'],'revision':manifest['revision']}))
