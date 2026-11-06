"""Transfer exact tested bytes by copying unchanged RC6 byte ranges. No build."""
import gzip,hashlib,json,os,re,subprocess,tempfile
from pathlib import Path

REPO='mrksrus/localcorrect-browser'
RID=436655991
TAG='v1.0.0-rc.7'
COMMIT='3a7b7aecfc628a49e2dd65f987e79bd360d67cfb'
assert os.environ.get('GITHUB_ACTIONS')=='true' and os.environ.get('GITHUB_REPOSITORY')==REPO and os.environ.get('GH_REPO')==REPO
assert os.environ.get('GITHUB_EVENT_NAME')=='pull_request'
event=json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text());head=event['pull_request']['head']
assert head['repo']['full_name']==REPO and head['ref']=='ops/rc7-asset-transfer'
assert subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()==head['sha']
manifest=json.loads(Path(__file__).with_name('rc7-manifest.json').read_text())
assert (manifest['repository'],manifest['releaseId'],manifest['tag'],manifest['commit'])==(REPO,RID,TAG,COMMIT)

def api(path):return json.loads(subprocess.check_output(['gh','api',path],text=True,timeout=120))
def release():
 r=api(f'repos/{REPO}/releases/{RID}')
 assert r['draft'] is True and r['prerelease'] is True and r['tag_name']==TAG and r['target_commitish']==COMMIT
 return r
def digest(path):
 with path.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def expected(asset,row):return asset['state']=='uploaded' and asset['size']==row['bytes'] and asset['digest']=='sha256:'+row['sha256']

assert len(manifest['artifacts'])==2
assert {r['file'] for r in manifest['artifacts']}=={'localcorrect-chrome-1.0.0-rc.7.zip','localcorrect-firefox-1.0.0-rc.7.zip'}
payload=Path(__file__).parent/'payload'
with tempfile.TemporaryDirectory(prefix='rc7-exact-transfer-') as directory:
 folder=Path(directory)
 for row in manifest['artifacts']:
  base=row['base'];delta=row['delta']
  from_previous=base['tag']=='v1.0.0-rc.6'
  if from_previous:
   assert base['file']==row['file'].replace('rc.7','rc.6')
  else:
   assert row['file']=='localcorrect-firefox-1.0.0-rc.7.zip' and base['tag']==TAG
   assert base['file']=='localcorrect-chrome-1.0.0-rc.7.zip' and base['bytes']==119180726
   assert base['sha256']=='c0ba7b57abf880f8c50508e0fe13ebe98020ad9ea74e64af71d3c8b0c8fe435f'
  assert delta['file']==row['file']+'.delta.gz'
  assert all(re.fullmatch(r'[a-f0-9]{64}',r['sha256']) for r in (row,base,delta))
  assert 0<row['bytes']<200*1024*1024 and 0<base['bytes']<200*1024*1024
  assert 0<delta['bytes']<20*1024*1024 and 0<delta['literalBytes']<30*1024*1024
  assert 1<=len(delta['parts'])<=256
  assert sum(p['bytes'] for p in delta['parts'])==delta['bytes']
  chunk=folder/delta['file']
  with chunk.open('wb') as joined:
   for index,part in enumerate(delta['parts']):
    assert part['file']==delta['file']+f'.{index:03}.part' and 0<part['bytes']<=512*1024
    piece=payload/part['file']
    assert piece.is_file() and piece.stat().st_size==part['bytes'] and digest(piece)==part['sha256']
    joined.write(piece.read_bytes())
  assert chunk.stat().st_size==delta['bytes'] and digest(chunk)==delta['sha256']
  if from_previous:
   subprocess.run(['gh','release','download',base['tag'],'--repo',REPO,'--pattern',base['file'],'--dir',str(folder)],check=True,timeout=600)
  original=folder/base['file']
  assert original.stat().st_size==base['bytes'] and digest(original)==base['sha256']
  with gzip.open(chunk,'rb') as stream:
   literal=stream.read(delta['literalBytes']+1)
   assert len(literal)==delta['literalBytes'] and not stream.read(1)
  output=folder/row['file'];written=0
  with output.open('wb') as combined,original.open('rb') as source:
   for kind,offset,length in row['instructions']:
    assert kind in ('base','literal') and type(offset) is int and type(length) is int and offset>=0 and length>0
    limit=base['bytes'] if kind=='base' else len(literal)
    assert offset+length<=limit and written+length<=row['bytes']
    if kind=='literal':combined.write(literal[offset:offset+length])
    else:
     source.seek(offset);remaining=length
     while remaining:
      data=source.read(min(1024*1024,remaining));assert data
      combined.write(data);remaining-=len(data)
    written+=length
  assert written==row['bytes'] and digest(output)==row['sha256']
  current={a['name']:a for a in release()['assets']};already=current.get(row['file'])
  if already and expected(already,row):print('Whole asset already matches:',row['file'],flush=True);continue
  if already:
   assert already['state']=='starter','Refusing to replace a different completed asset'
   subprocess.run(['gh','api','-X','DELETE',f'repos/{REPO}/releases/assets/{already["id"]}'],check=True,timeout=120)
  subprocess.run(['gh','release','upload',TAG,str(output),'--repo',REPO],check=True,timeout=600)
  current={a['name']:a for a in release()['assets']};assert expected(current[row['file']],row)
  print('Promoted exact tested asset:',row['file'],row['sha256'],flush=True)
 current={a['name']:a for a in release()['assets']}
 assert all(expected(current[row['file']],row) for row in manifest['artifacts'])
 for part in manifest['cleanupParts']:
  assert re.fullmatch(r'rc7-transfer-(?:chrome|firefox)-\d{3}\.part',part['file'])
  asset=current.get(part['file'])
  if asset is None:continue
  assert asset['state']=='starter' or expected(asset,part)
  subprocess.run(['gh','api','-X','DELETE',f'repos/{REPO}/releases/assets/{int(asset["id"])}'],check=True,timeout=120)
 print(json.dumps({'draftStillUnpublished':release()['draft'],'assets':[{k:a[k] for k in ['name','size','digest']} for a in release()['assets']]}),flush=True)
