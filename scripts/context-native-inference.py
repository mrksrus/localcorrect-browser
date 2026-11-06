"""Build-only, bounded stdio CPU inference. Never log or persist request text."""
import os

# The parent supplies these before process creation as well. Set them before
# importing ORT so native initializers cannot precede the opt-outs.
os.environ['ORT_DISABLE_TELEMETRY'] = '1'
os.environ['ORT_RUNNING_UNIT_TESTS'] = '1'

import argparse
import hashlib
import json
import math
from pathlib import Path
import sys

sys.dont_write_bytecode = True

MAX_BYTES = 10 * 1024 * 1024
INPUTS = ('input_ids', 'attention_mask', 'word_positions', 'candidate_ids', 'candidate_mask')


def emit(value):
    data = json.dumps(value, ensure_ascii=True, allow_nan=False, separators=(',', ':')).encode('utf-8') + b'\n'
    if len(data) > MAX_BYTES:
        raise ValueError()
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


def tensor(value, shape, floating=False, mask=False):
    def check(node, depth):
        if depth == len(shape):
            if isinstance(node, bool) or not isinstance(node, (int, float) if floating else int):
                raise ValueError()
            if not math.isfinite(node) or (mask and node not in (0, 1)) or (not floating and not 0 <= node < 2**63):
                raise ValueError()
            return
        if not isinstance(node, list) or len(node) != shape[depth]:
            raise ValueError()
        for item in node:
            check(item, depth + 1)
    check(value, 0)
    return value


def infer(session, np, chunks):
    if not isinstance(chunks, list) or len(chunks) > 3000:
        raise ValueError()
    scores = []
    previous = -1
    for chunk in chunks:
        if not isinstance(chunk, dict) or set(chunk) != set(INPUTS) | {'words'}:
            raise ValueError()
        words = chunk['words']
        if not isinstance(words, list) or not 1 <= len(words) <= 128:
            raise ValueError()
        ids = chunk['input_ids']
        if not isinstance(ids, list) or len(ids) != 1 or not isinstance(ids[0], list) or not 2 <= len(ids[0]) <= 128:
            raise ValueError()
        sequence, count = len(ids[0]), len(words)
        feeds = {}
        for name in INPUTS:
            shape = (1, sequence) if name in ('input_ids', 'attention_mask') else (1, count) if name == 'word_positions' else (1, count, 9)
            floating = name == 'candidate_mask'
            value = tensor(chunk[name], shape, floating, name in ('attention_mask', 'candidate_mask'))
            feeds[name] = np.asarray(value, dtype=np.float32 if floating else np.int64)
        if np.any(feeds['word_positions'] >= sequence):
            raise ValueError()
        output = session.run(['logits'], feeds)[0]
        if output.shape != (1, count, 9) or not np.isfinite(output).all():
            raise ValueError()
        for index, word in enumerate(words):
            token_index = word.get('tokenIndex') if isinstance(word, dict) and set(word) == {'tokenIndex'} else None
            if type(token_index) is not int or not previous < token_index <= 20000:
                raise ValueError()
            previous = token_index
            scores.append({'tokenIndex': token_index, 'logits': output[0, index].tolist()})
            if len(scores) > 3000:
                raise ValueError()
    return scores


def main():
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument('--model', required=True)
    parser.add_argument('--sha256', required=True)
    args = parser.parse_args()
    path = Path(args.model)
    if not path.is_absolute() or not 1 <= path.stat().st_size <= 64 * 1024 * 1024:
        return 2
    model = path.read_bytes()
    if hashlib.sha256(model).hexdigest() != args.sha256:
        return 2
    import numpy as np
    import onnxruntime as ort
    if ort.__version__ != '1.31.1':
        return 2
    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    options.inter_op_num_threads = 1
    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    options.log_severity_level = 4
    session = ort.InferenceSession(model, sess_options=options, providers=['CPUExecutionProvider'])
    session.disable_fallback()
    inputs = {item.name: item.type for item in session.get_inputs()}
    if inputs != {name: 'tensor(float)' if name == 'candidate_mask' else 'tensor(int64)' for name in INPUTS}:
        return 2
    if [(item.name, item.type) for item in session.get_outputs()] != [('logits', 'tensor(float)')]:
        return 2
    emit({'id': 0, 'ready': {'backend': 'onnxruntime-python-cpu', 'ortVersion': ort.__version__, 'threads': 2, 'modelSha256': args.sha256}})
    while True:
        line = sys.stdin.buffer.readline(MAX_BYTES + 1)
        if not line:
            return 0
        if len(line) > MAX_BYTES or not line.endswith(b'\n'):
            return 2
        request = json.loads(line.decode('utf-8'))
        if not isinstance(request, dict) or set(request) != {'id', 'chunks'} or type(request['id']) is not int or not 1 <= request['id'] <= 2**53 - 1:
            return 2
        emit({'id': request['id'], 'scores': infer(session, np, request['chunks'])})


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception:
        raise SystemExit(1)  # Deliberately suppress exceptions and input fragments.
