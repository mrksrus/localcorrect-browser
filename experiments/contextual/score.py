"""Offline selected-token ONNX scoring. Imports no training framework."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import resource
import time

import numpy as np
import onnxruntime as ort
from prepare import context,python_offset,tokenizer,word_id

FEATURES=['candidateLogProbability','candidateMargin','originalMargin','logFrequency','foreignKnown','options','originalPieces','titlecase','lengthDifference','german','logGlobalRank','globalMaxMargin']

def run(args):
    tok=tokenizer(args.tokenizer)
    options=ort.SessionOptions();options.intra_op_num_threads=2;options.inter_op_num_threads=1
    options.enable_cpu_mem_arena=False
    start=time.perf_counter()
    session=ort.InferenceSession(args.model,options,providers=['CPUExecutionProvider'])
    load_seconds=time.perf_counter()-start
    raw=Path(args.input).read_bytes();data=json.loads(raw)
    jobs=[];records=[]
    for row in data['rows']:
        for offer in row['offers']:
            choices=[]
            for c in offer['options']:
                token_id=word_id(tok,c['replacement'])
                if token_id is not None:choices.append({**c,'id':token_id})
            if not choices:continue
            start=python_offset(row['input'],offer['offset']);end=python_offset(row['input'],offer['offset']+offer['length'])
            ids,position=context(tok,row['input'],start,end)
            jobs.append((row,offer,choices,ids,position))
    inference_ms=[]
    for begin in range(0,len(jobs),8):
        batch=jobs[begin:begin+8];length=max(len(j[3]) for j in batch)
        ids=np.zeros((len(batch),length),dtype=np.int64);attention=np.zeros_like(ids)
        positions=np.array([j[4] for j in batch],dtype=np.int64)
        for i,job in enumerate(batch):ids[i,:len(job[3])]=job[3];attention[i,:len(job[3])]=1
        feed={'input_ids':ids,'attention_mask':attention,'positions':positions}
        start=time.perf_counter();logits=session.run(None,{x.name:feed[x.name] for x in session.get_inputs()})[0]
        inference_ms.append((time.perf_counter()-start)*1000)
        assert logits.shape==(len(batch),32000),logits.shape
        for i,(row,offer,choices,_,_) in enumerate(batch):
            values=logits[i].astype(np.float64);maximum=float(values.max());log_z=maximum+math.log(float(np.exp(values-maximum).sum()))
            ranked=sorted(choices,key=lambda x:float(values[x['id']]),reverse=True);best=ranked[0];best_value=float(values[best['id']])
            original_id=word_id(tok,offer['original']);original_value=float(values[original_id]) if original_id is not None else -20.0
            alternatives=[float(values[x['id']]) for x in ranked[1:]]
            if original_id is not None:alternatives.append(original_value)
            margin=min(20.0,best_value-max(alternatives)) if alternatives else 20.0
            features=[best_value-log_z,margin,best_value-original_value,math.log1p(best['frequency']),float(offer['foreignKnown']),len(choices),min(5,len(tok.encode(offer['original'],add_special_tokens=False).ids)),float(offer['original'][0].isupper()),len(best['replacement'])-len(offer['original']),float(row['language']=='de'),math.log1p(int((values>best_value).sum())),best_value-maximum]
            edit={k:offer[k] for k in ('offset','length','original')};edit['replacement']=best['replacement']
            # Gold is used for supervised labels/evaluation only, never generation
            # or neural context scoring. Fresh audit may omit edit-level gold.
            wanted=None
            if row.get('edits') is not None:
                wanted=any(all(e.get(k)==edit[k] for k in edit) for e in row['edits'])
            records.append({'document':row['id'],'edit':edit,'features':features,'wanted':wanted,'candidateLogProbability':features[0]})
    output={'schema':1,'modelSha256':hashlib.sha256(Path(args.model).read_bytes()).hexdigest(),'inputSha256':hashlib.sha256(raw).hexdigest(),'featureNames':FEATURES,'records':records,'resources':{'loadSeconds':load_seconds,'batches':len(inference_ms),'batchSize':8,'inferenceBatchMs':inference_ms,'inferenceTotalMs':sum(inference_ms),'peakRssMiB':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024,'threads':2,'scope':'isolated ONNX context scorer only; excludes separate Node proposal generation, editor, and production integration'}}
    Path(args.output).write_text(json.dumps(output,indent=2)+'\n')
    print(json.dumps({'output':args.output,'records':len(records),'resources':{k:v for k,v in output['resources'].items() if k!='inferenceBatchMs'}},indent=2))

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    for name in ['model','tokenizer','input','output']:parser.add_argument('--'+name,required=True)
    run(parser.parse_args())
