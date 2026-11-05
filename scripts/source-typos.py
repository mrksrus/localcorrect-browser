#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
from pathlib import Path
from collections import defaultdict,Counter
import zipfile,hashlib,json,shutil
import argparse,urllib.request
root=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description='Recreate the attributed, deidentified typo source subset.')
parser.add_argument('--source-dir',type=Path,default=root/'work/typo-input')
parser.add_argument('--download',action='store_true')
args=parser.parse_args();sources=args.source_dir;sources.mkdir(parents=True,exist_ok=True)
files={
 'codespell-dictionary.txt':('https://raw.githubusercontent.com/codespell-project/codespell/b53e95197f7c799674c785028a182e2dfd1df881/codespell_lib/data/dictionary.txt',1499567,'154078a5877ef228b8c8b28d5c69991b053947ea8685717599044988e172ddd7'),
 'Litkey-csv.zip':('https://linguistics.rub.de/litkeycorpus/corpus/Litkey-csv.zip',1294650,'6d8db45fa079c1dc6128e9e8db2d181c0fbcbb9d51693ebbc1ecb7785e2d649c')}
for name,(url,size,digest) in files.items():
 path=sources/name
 if not path.exists():
  if not args.download:raise SystemExit('Missing '+name+'; use --download for pinned sources.')
  with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'LocalCorrect-source-reproduction'}),timeout=30) as response:payload=response.read(size+1)
  if len(payload)!=size or hashlib.sha256(payload).hexdigest()!=digest:raise SystemExit('Source changed: '+name)
  path.write_bytes(payload)
 payload=path.read_bytes()
 if len(payload)!=size or hashlib.sha256(payload).hexdigest()!=digest:raise SystemExit('Source hash mismatch: '+name)
v=root/'packages/core/vendor/typo-data';v.mkdir(parents=True,exist_ok=True)
codespell=(sources/'codespell-dictionary.txt').read_bytes()
assert hashlib.sha256(codespell).hexdigest()=='154078a5877ef228b8c8b28d5c69991b053947ea8685717599044988e172ddd7'
(v/'codespell.txt').write_bytes(codespell)
# Upstream README and complete legalcode snapshots are already vendored.
# Extract only short alphabetic spelling pairs, never raw pupil text, names or stories.
# Exclude ambiguous originals across the entire source, even if a target is common.
pairs=defaultdict(Counter)
with zipfile.ZipFile(sources/'Litkey-csv.zip') as z:
 for n in z.namelist():
  if not n.startswith('litkey-csv/') or not n.endswith('.csv') or Path(n).name.startswith('.'):continue
  raw=z.read(n)
  content=raw.decode('utf-8-sig')
  for line in content.splitlines():
   cols=line.split('\t')
   if len(cols)<2:continue
   a,b=cols[:2]
   if a.isalpha() and b.isalpha() and a.lower()!=b.lower() and 5<=len(a)<=24 and 3<=len(b)<=24:
    pairs[a.lower()][b.lower()]+=1
freq=dict(line.split() for line in (root/'packages/core/dictionaries/de.txt').read_text(encoding='utf-8').splitlines() if line and not line.startswith('#'))
selected=[]
for a,targets in sorted(pairs.items()):
 if len(targets)!=1:continue
 b,count=next(iter(targets.items()))
 if int(freq.get(b,0))>=1000:selected.append((a,b,count))
(v/'litkey-pairs.tsv').write_bytes(''.join(f'{a}\t{b}\t{n}\n' for a,b,n in selected).encode('utf-8'))
meta={'codespell':{'revision':'b53e95197f7c799674c785028a182e2dfd1df881','url':'https://github.com/codespell-project/codespell','license':'CC-BY-SA-3.0','sha256':hashlib.sha256(codespell).hexdigest()},'litkey':{'url':'https://linguistics.rub.de/litkeycorpus/corpus/Litkey-csv.zip','license':'CC-BY-SA-4.0','archiveSha256':hashlib.sha256((sources/'Litkey-csv.zip').read_bytes()).hexdigest(),'extractedPairs':len(selected),'changes':'Alphabetic single-word pairs only; lowercased; source length5-24, target3-24; globally unambiguous original; targetFrequency>=1000. No raw texts.'}}
(v/'provenance.json').write_bytes((json.dumps(meta,indent=2)+'\n').encode('utf-8'))
print(json.dumps(meta))
