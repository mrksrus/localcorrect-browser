"""Evaluate frozen head decisions, preserving baseline edits and original spans."""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
from calibrate import sigmoid
from prepare import python_offset

def apply(text,edits):
    result=text
    last_end=0
    for edit in sorted(edits,key=lambda x:x['offset']):
        start=python_offset(text,edit['offset']);end=python_offset(text,edit['offset']+edit['length'])
        assert start>=last_end and text[start:end]==edit['original']
        last_end=end
    for edit in sorted(edits,key=lambda x:x['offset'],reverse=True):
        start=python_offset(text,edit['offset']);end=python_offset(text,edit['offset']+edit['length'])
        result=result[:start]+edit['replacement']+result[end:]
    return result

def run(args):
    data=json.loads(Path(args.proposals).read_text());features=json.loads(Path(args.features).read_text());head=json.loads(Path(args.head).read_text())
    assert hashlib.sha256(Path(args.proposals).read_bytes()).hexdigest()==features['inputSha256']
    assert features['modelSha256']==head['modelSha256']
    assert features['featureNames']==head['featureNames']
    records=features['records']
    scores=sigmoid(np.c_[np.ones(len(records)),(np.array([r['features'] for r in records])-head['mean'])/head['scale']]@np.array(head['weights'])) if records else []
    additions={}
    for record,score in zip(records,scores):
        if score>=head['threshold']:
            additions.setdefault(record['document'],[]).append({**record,'acceptanceScore':float(score)})
    rows=[]
    for row in data['rows']:
        extra=additions.get(row['id'],[]);edits=row['baseline']['edits']+[r['edit'] for r in extra]
        actual=apply(row['input'],edits)
        rows.append({'id':row['id'],'language':row['language'],'kind':row['kind'],'input':row['input'],'expected':row['expected'],'baseline':row['baseline']['text'],'actual':actual,'baselineExact':row['baseline']['text']==row['expected'],'candidateExact':actual==row['expected'],'addedEdits':extra})
    summary={'documents':len(rows),'baselineExact':sum(r['baselineExact'] for r in rows),'candidateExact':sum(r['candidateExact'] for r in rows),'safeDocuments':sum(r['kind']=='safe' for r in rows),'baselinePreservedSafe':sum(r['kind']=='safe' and r['baselineExact'] for r in rows),'candidatePreservedSafe':sum(r['kind']=='safe' and r['candidateExact'] for r in rows),'addedEdits':sum(len(r['addedEdits']) for r in rows)}
    all_added=[r for row in rows for r in row['addedEdits']]
    if all(row.get('edits') is not None for row in data['rows']) and all(r['wanted'] is not None for r in all_added):
        summary.update(addedWanted=sum(bool(r['wanted']) for r in all_added),addedUnwanted=sum(not r['wanted'] for r in all_added))
    report={'summary':summary,'resources':features['resources'],'headSha256':hashlib.sha256(Path(args.head).read_bytes()).hexdigest(),'rows':rows}
    Path(args.output).write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(summary,indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser()
    for name in ['proposals','features','head','output']:p.add_argument('--'+name,required=True)
    run(p.parse_args())
