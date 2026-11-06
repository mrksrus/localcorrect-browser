"""Prepare masked-word training from known synthetic development examples only."""
import argparse
import hashlib
import json
from pathlib import Path
import random
import re

def tokenizer(model_dir):
    from tokenizers import BertWordPieceTokenizer
    return BertWordPieceTokenizer(str(Path(model_dir)/'vocab.txt'),lowercase=False,strip_accents=False)

def word_id(tok, word):
    ids=tok.encode(word,add_special_tokens=False).ids
    return ids[0] if len(ids)==1 and ids[0]!=tok.token_to_id('[UNK]') else None

def context(tok,text,start,end):
    # Construct from separately encoded sides to avoid byte/UTF-16 offset errors.
    left=tok.encode(text[:start],add_special_tokens=False).ids[-30:]
    right=tok.encode(text[end:],add_special_tokens=False).ids[:30]
    ids=[tok.token_to_id('[CLS]')]+left+[tok.token_to_id('[MASK]')]+right+[tok.token_to_id('[SEP]')]
    return ids,len(left)+1

def python_offset(text, offset):
    raw=text.encode('utf-16-le')
    return len(raw[:offset*2].decode('utf-16-le'))

def prepare(args):
    tok=tokenizer(args.model)
    raw=Path(args.input).read_bytes();data=json.loads(raw)
    rng=random.Random(137)
    examples=[]
    for row in data['rows']:
        # Gold sentences are allowed in training. No calibration or fresh audit
        # data is read by this command. Unique contexts reduce template repeats.
        text=row['expected']
        words=list(re.finditer(r'[^\W\d_]+',text,re.UNICODE))
        eligible=[w for w in words if len(w[0])>=3 and word_id(tok,w[0]) is not None]
        rng.shuffle(eligible)
        for match in eligible[:4]:
            ids,pos=context(tok,text,match.start(),match.end())
            examples.append({'input_ids':ids,'position':pos,'target_id':word_id(tok,match[0])})
    unique={json.dumps(e,sort_keys=True):e for e in examples}
    examples=list(unique.values());rng.shuffle(examples)
    path=Path(args.output);path.write_text(''.join(json.dumps(e)+'\n' for e in examples))
    manifest={'inputSha256':hashlib.sha256(raw).hexdigest(),'trainingSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'sourceDocuments':len(data['rows']),'uniqueMaskedExamples':len(examples),'seed':137,'maxWordsPerDocument':4,'scope':'known synthetic development expected text, no heldout or fresh text'}
    path.with_suffix('.manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps(manifest,indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--model',required=True);p.add_argument('--input',required=True);p.add_argument('--output',required=True)
    prepare(p.parse_args())
