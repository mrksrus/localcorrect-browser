"""Cold sequential research CLI timing, not a browser/Outlook benchmark."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time

def main(args):
    repo=Path(__file__).resolve().parents[2];lab=Path(args.lab).resolve()
    source=json.loads((lab/'calibration-proposals.json').read_text())['rows']
    root=lab/'benchmark';root.mkdir(exist_ok=True)
    results=[]
    for language in ['en','de']:
        row=max((r for r in source if r['language']==language),key=lambda r:len(r['offers']))
        words=row['input'].split();text=' '.join((words*(1000//len(words)+1))[:1000])
        corpus=root/f'{language}-1000.json';corpus.write_text(json.dumps({'cases':[{'id':f'bench-{language}','language':language,'kind':'safe','format':'short','input':text,'expected':text}]}))
        for repeat in range(3):
            proposals=root/f'{language}-proposals.json';features=root/f'{language}-features.json';report=root/f'{language}-report.json'
            commands=[
                ['node',str(repo/'experiments/contextual/proposals.mjs'),str(corpus),str(proposals)],
                [sys.executable,str(repo/'experiments/contextual/score.py'),'--model',str(lab/'trained-mini/onnx/selected-mlm.fp32.onnx'),'--tokenizer',str(lab/'mini'),'--input',str(proposals),'--output',str(features)],
                [sys.executable,str(repo/'experiments/contextual/evaluate.py'),'--proposals',str(proposals),'--features',str(features),'--head',str(lab/'trained-head.json'),'--output',str(report)],
            ]
            timings=[];peaks=[]
            for number,command in enumerate(commands):
                started=time.perf_counter()
                process=subprocess.Popen(command,cwd=repo,stdout=subprocess.DEVNULL)
                _,status,usage=os.wait4(process.pid,0)
                process.returncode=os.waitstatus_to_exitcode(status)
                if process.returncode:raise subprocess.CalledProcessError(process.returncode,command)
                timings.append(time.perf_counter()-started);peaks.append(usage.ru_maxrss/1024)
            context=json.loads(features.read_text())
            results.append({'language':language,'words':len(text.split()),'repeat':repeat,'coldStageSeconds':dict(zip(['nodeProposalAndBaseline','pythonTokenizerContextAndOnnx','pythonHeadAndApplication'],timings)),'coldTotalSeconds':sum(timings),'stagePeakRssMiB':peaks,'contextProposals':len(context['records']),'contextInferenceMs':context['resources']['inferenceTotalMs']})
    result={'scope':'Sequential research CLIs, three fresh process stages each repeat. No resident warm full-pipeline result, browser/Office integration, or concurrent combined RSS claim. Separate stages release memory before the next starts. Inputs are synthetic stress fixtures, expected output is not quality-scored.','hardware':'Intel i5-1038NG7 4C/8T, Linux, CPU only; ONNX intra threads2 inter threads1','results':results}
    (lab/'benchmark.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--lab',required=True);main(p.parse_args())
