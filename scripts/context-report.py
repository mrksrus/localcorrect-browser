"""Evaluate saved input-only neural proposals without repeating inference.

Real-corpus edit counts cover unambiguous single-token replacements only.
Whole-document exactness always compares the complete reference string.
Reports contain aggregates and IDs, never document text.
"""
import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path
from importlib.util import spec_from_file_location, module_from_spec

spec = spec_from_file_location('calibration', Path(__file__).with_name('calibrate-context.py'))
calibration = module_from_spec(spec)
spec.loader.exec_module(calibration)

def evaluate(path, policy):
    data = json.loads(Path(path).read_text())
    if data['modelSha256'] != policy['modelSha256'] or data.get('onnxSha256') != policy.get('onnxSha256'):
        raise ValueError('Score/policy model identity mismatch')
    tokenize = calibration.load_tokenizer()
    groups = defaultdict(lambda: defaultdict(int))
    changed_ids = []
    for row in data['rows']:
        gold = calibration.wanted_keys(row, tokenize)
        additions = [p for p in row['proposals'] if calibration.accepted(p, policy['actions'].get(str(p['actionId'])))]
        baseline = row['baseline']['edits']
        modes = [('baseline', baseline), ('candidate', baseline + additions), ('neural-additions', additions)]
        for mode, edits in modes:
            ordered = sorted(edits, key=lambda e: e['offset'])
            encoded = row['input'].encode('utf-16-le')
            end = 0
            output = bytearray()
            for e in ordered:
                start, stop = e['offset']*2, (e['offset']+e['length'])*2
                assert start >= end and encoded[start:stop].decode('utf-16-le') == e['original']
                output.extend(encoded[end:start]); output.extend(e['replacement'].encode('utf-16-le')); end = stop
            output.extend(encoded[end:])
            exact = output.decode('utf-16-le') == row['expected']
            true = sum(calibration.edit_key(e) in gold for e in edits)
            clean = row['input'] == row['expected']
            for language in ('all', row['language']):
                g = groups[(mode, language)]
                for key, value in {'documents':1, 'exactDocuments':int(exact), 'wantedEdits':true,
                    'unwantedEdits':len(edits)-true, 'missedSupportedEdits':len(gold)-true,
                    'cleanDocuments':int(clean), 'preservedCleanDocuments':int(clean and not edits)}.items():
                    g[key] += value
        if additions:
            changed_ids.append({'id':row['id'],'language':row['language'], 'addedWanted':sum(calibration.edit_key(e) in gold for e in additions),
                'addedUnwanted':sum(calibration.edit_key(e) not in gold for e in additions)})
    return {'scoresSha256':calibration.sha(path), 'inputSha256':data['inputSha256'], 'backend':data.get('backend'),
        'summary':[{'mode':mode,'language':language,**metrics} for (mode,language),metrics in sorted(groups.items())],
        'changedDocuments':changed_ids}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scores', required=True)
    parser.add_argument('--policy', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    policy = json.loads(Path(args.policy).read_text())
    result = {'policySha256':calibration.sha(args.policy), 'modelSha256':policy['modelSha256'],
        'onnxSha256':policy.get('onnxSha256'), **evaluate(args.scores, policy),
        'limits':'Real-corpus wanted/missed edit counts include single-token replacement gold only. Whole-document exactness uses the entire unchanged reference. A different valid correction can count as unwanted against a single reference.'}
    Path(args.output).write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps({key:value for key,value in result.items() if key!='changedDocuments'},indent=2))
