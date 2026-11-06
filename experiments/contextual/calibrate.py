"""Train a small acceptance head and choose an abstention threshold on calibration.

The threshold is empirical, not a probability or a guarantee of zero errors.
"""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np

def load(path):return json.loads(Path(path).read_text())
def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def sigmoid(x):return 1/(1+np.exp(-np.clip(x,-30,30)))

def fit(args):
    train=load(args.train);calibration=load(args.calibration)
    assert train['modelSha256']==calibration['modelSha256']
    assert train['featureNames']==calibration['featureNames']
    rows=train['records'];x=np.array([r['features'] for r in rows]);y=np.array([r['wanted'] for r in rows],dtype=float)
    assert all(r['wanted'] is not None for r in rows)
    assert len(set(y))==2
    mean=x.mean(0);scale=x.std(0);scale=np.where(scale<1e-8,1,scale)
    z=np.c_[np.ones(len(x)),(x-mean)/scale];weights=np.zeros(z.shape[1])
    # Deterministic full-batch logistic regression, L2 regularized. No tokens,
    # phrase IDs, or gold replacements enter the feature vector.
    for _ in range(2000):
        error=sigmoid(z@weights)-y
        gradient=z.T@error/len(y)+0.02*np.r_[0,weights[1:]]
        weights-=0.08*gradient
    def scores(records):
        a=np.array([r['features'] for r in records]);return sigmoid(np.c_[np.ones(len(a)),(a-mean)/scale]@weights)
    cal=calibration['records'];values=scores(cal)
    assert all(r['wanted'] is not None for r in cal)
    negatives=[v for r,v in zip(cal,values) if not r['wanted']]
    # Never use fresh evaluation to choose or adjust this threshold.
    threshold=float(np.nextafter(max(0.99,max(negatives,default=0)),np.inf))
    accepted=[r for r,v in zip(cal,values) if v>=threshold]
    model={'schema':1,'modelSha256':train['modelSha256'],'featureNames':train['featureNames'],'mean':mean.tolist(),'scale':scale.tolist(),'weights':weights.tolist(),'threshold':threshold,'trainingRows':len(rows),'calibrationRows':len(cal),'calibrationAddedWanted':sum(r['wanted'] for r in accepted),'calibrationAddedUnwanted':sum(not r['wanted'] for r in accepted),'trainingFeaturesSha256':digest(args.train),'calibrationFeaturesSha256':digest(args.calibration),'method':'logistic regression 2000 full-batch steps lr0.08 L2=0.02; threshold next representable score above max(0.99, every observed calibration negative)','warning':'fitted sigmoid scores are not calibrated probabilities or an error guarantee'}
    Path(args.output).write_text(json.dumps(model,indent=2)+'\n')
    print(json.dumps({k:v for k,v in model.items() if k not in ['featureNames','mean','scale','weights']},indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser()
    for name in ['train','calibration','output']:p.add_argument('--'+name,required=True)
    fit(p.parse_args())
