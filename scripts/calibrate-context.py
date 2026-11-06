"""Conservative action thresholds from declared calibration/regression inputs.

No neural weight training. The fresh audit and human test split are not inputs.
"""
import argparse
from collections import defaultdict
import difflib
import hashlib
import importlib.util
import json
import math
from pathlib import Path

def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def load_tokenizer():
    spec=importlib.util.spec_from_file_location('context_trainer',Path(__file__).with_name('train-context.py'))
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module.tokenize

def edit_key(edit):return(edit['offset'],edit['length'],edit['original'],edit['replacement'])

def wanted_keys(row,tokenize):
    if row.get('edits') is not None:
        return{edit_key(e) if 'offset' in e else (e['start'],e['end']-e['start'],row['input'].encode('utf-16-le')[e['start']*2:e['end']*2].decode('utf-16-le'),e['replacement']) for e in row['edits']}
    original=row['input'];src=tokenize(original);dst=tokenize(row['expected'])
    result=set()
    for tag,i,j,k,l in difflib.SequenceMatcher(None,[x[0] for x in src],[x[0] for x in dst],autojunk=False).get_opcodes():
        if tag=='replace' and j-i==l-k==1:
            word,start,end=src[i];offset=len(original[:start].encode('utf-16-le'))//2
            result.add((offset,len(word.encode('utf-16-le'))//2,word,dst[k][0]))
    return result

def accepted(proposal,limit):
    return limit is not None and proposal['trainCount']>=limit['minTrainCount'] and proposal['margin']>=limit['minMargin'] and proposal['gap']>=limit['minGap'] and proposal['probability']>=limit['minProbability']

def calibrate(args):
    model=json.loads(Path(args.model).read_text());tokenize=load_tokenizer()
    groups=defaultdict(list);inputs={};source_counts={}
    for path in args.input:
        data=json.loads(Path(path).read_text());assert data['modelSha256']==sha(args.model)
        if model.get('modelSha256'):
            assert data.get('onnxSha256')==model['modelSha256'], 'Score ONNX identity mismatch'
        runtime_root=Path(__file__).resolve().parents[1]/'packages/core/src'
        for name, expected_hash in data.get('runtimeSha256',{}).items():
            assert '/' not in name and sha(runtime_root/name)==expected_hash, 'Scored runtime source has changed: '+name
        # Role supplied by filename here is provenance only. No synthetic target
        # is used as a new gradient-training example.
        role=Path(path).stem;source_counts[role]={'documents':len(data['rows']),'proposals':0}
        inputs[Path(path).name]=sha(path)
        for row in data['rows']:
            gold=wanted_keys(row,tokenize)
            for proposal in row['proposals']:
                wanted=edit_key(proposal) in gold
                groups[proposal['actionId']].append((proposal,wanted,row['document_id'],role))
                source_counts[role]['proposals']+=1
    actions={};details=[]
    for action_id,records in groups.items():
        action=model['actions'][action_id]
        positives=[r for r in records if r[1]];negatives=[r for r in records if not r[1]]
        human_positive_documents={r[2] for r in positives if r[3]+'.json' in args.human_calibration_name}
        synthetic_positive_documents={r[2] for r in positives if r[3]+'.json' in args.support_calibration_name}
        # Require repeat support in human calibration documents or the separately
        # declared development-only synthetic set. Synthetic support is not
        # independent validation and cannot establish a population error rate.
        if action['trainCount']<4 or (len(human_positive_documents)<2 and len(synthetic_positive_documents)<8):continue
        margin=max(args.min_margin,max((r[0]['margin'] for r in negatives),default=0)+0.5)
        limit={'minTrainCount':4,'minMargin':margin,'minGap':2.0,'minProbability':args.min_probability}
        chosen=[r for r in records if accepted(r[0],limit)]
        true=[r for r in chosen if r[1]];false=[r for r in chosen if not r[1]]
        synthetic_survivors=[r for r in true if r[3]+'.json' in args.support_calibration_name]
        if not true or false or (len(human_positive_documents)<2 and len(synthetic_survivors)<3):continue
        actions[str(action_id)]=limit
        details.append({'actionId':action_id,**action,'calibrationWanted':len(true),'calibrationUnwanted':len(false),'humanPositiveDocuments':len(human_positive_documents),'syntheticPositiveDocuments':len(synthetic_positive_documents),'syntheticSurvivingEdits':len(synthetic_survivors),'observedNegatives':len(negatives),'minMargin':margin})
    policy={'schemaVersion':1,'modelSha256':sha(args.model),'onnxSha256':model.get('modelSha256'),'actions':actions,'calibrationInputs':inputs,'humanCalibrationInputs':args.human_calibration_name,'syntheticSupportInputs':args.support_calibration_name,'method':f'per-action thresholds with >=2 human or >=8 synthetic development calibration support documents (>=3 surviving synthetic edits), >=4 train occurrences, logit KEEP margin >={args.min_margin} and >=max observed negative margin+0.5; probability>={args.min_probability} and competing-action gap>=2','warning':'empirical calibration, no universal or population zero-error guarantee; test and fresh audit not read'}
    Path(args.output).write_text(json.dumps(policy,indent=2)+'\n')
    report={'enabledActions':len(actions),'details':details,'sources':source_counts,'policySha256':sha(args.output),'modelSha256':sha(args.model)}
    Path(args.report).write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--model',required=True);p.add_argument('--input',action='append',required=True);p.add_argument('--output',required=True);p.add_argument('--report',required=True);p.add_argument('--human-calibration-name',action='append',default=['calibration-scores.json']);p.add_argument('--support-calibration-name',action='append',default=[]);p.add_argument('--min-margin',type=float,default=5.3);p.add_argument('--min-probability',type=float,default=.995)
    calibrate(p.parse_args())
