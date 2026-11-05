#!/usr/bin/env python3
"""Fetch missing authoring sources with fixed size/hash bounds; never install anything."""
from pathlib import Path
import hashlib,json,urllib.request
root=Path(__file__).resolve().parent/'sources'
manifest=json.loads((root/'download-manifest.json').read_text())
for item in manifest:
    path=root/item['file']
    if path.exists():
        data=path.read_bytes()
    else:
        request=urllib.request.Request(item['url'],headers={'User-Agent':'LocalCorrect-dataset-research/1.0'})
        with urllib.request.urlopen(request,timeout=25) as response:
            data=response.read(item['bytes']+1)
        assert len(data)==item['bytes'],f"Unexpected source length: {item['file']}"
        assert hashlib.sha256(data).hexdigest()==item['sha256'],f"Source drift: {item['file']}"
        path.write_bytes(data)
    assert len(data)==item['bytes'] and hashlib.sha256(data).hexdigest()==item['sha256'],item['file']
print('All seven bounded sources match the recorded SHA-256 values.')
