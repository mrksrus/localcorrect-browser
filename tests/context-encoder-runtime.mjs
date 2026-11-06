// Fixed public arithmetic fixtures only. This test does not read quality data.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {encodeContext, contextIdentity} from '../packages/core/src/index.js';
import policy from '../packages/core/src/context-policy.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
let reportPath = resolve(root, 'test-results/context-encoder-runtime.json');
let runtimeOutputPath;
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--report' && args[index + 1]) reportPath = resolve(args[++index]);
  else if (args[index] === '--runtime-output' && args[index + 1]) runtimeOutputPath = resolve(args[++index]);
  else throw new Error('Usage: context-encoder-runtime.mjs [--report REPORT.json] [--runtime-output OUTPUT.json]');
}
const started = performance.now();
const read = path => readFileSync(new URL('../' + path, import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceNames = ['index.js', 'context-score.js', 'context-encode.js', 'context-encoder-data.js', 'context-policy.js'];
const sourceHashes = Object.fromEntries(sourceNames.map(name => [name, hash(read('packages/core/src/' + name))]));
const metadataBytes = read('packages/core/models/context-encoder-metadata.json');
const metadata = JSON.parse(metadataBytes);
const fixtureBytes = read('packages/core/models/context-encoder-parity.json');
const fixtures = JSON.parse(fixtureBytes);
const modelBytes = read('packages/core/models/context-encoder.onnx');
const wasmBytes = read('node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm');
const identity = contextIdentity();
assert.equal(fixtures.format, 'localcorrect-context-encoder-parity-v1');
assert.equal(hash(modelBytes), fixtures.modelSha256);
assert.equal(hash(modelBytes), identity.modelSha256);
assert.equal(modelBytes.length, identity.modelBytes);
assert.equal(hash(metadataBytes), identity.metadataSha256);
assert.equal(fixtures.absoluteTolerance, 0.0001);
assert.equal(fixtures.tokenizerProbes.length, 25);
assert.equal(fixtures.probes.length, 40);
assert.equal(hash(wasmBytes), '4b884c203b0fa48d057be3332c65513ff85aa3c5bddd6946acc0fab7ecda001d');

const encodings = new Map();
const keyFor = row => JSON.stringify([row.language, row.text]);
let fullChunks = 0, prunedChunks = 0;
const validPolicy = policy.schemaVersion === 1 && policy.onnxSha256 === identity.modelSha256 && policy.modelSha256 === identity.metadataSha256;
const activeActions = validPolicy ? policy.actions : {};
const tokenizerProbes = fixtures.tokenizerProbes.map((fixture, index) => {
  const encoded = encodeContext(fixture.text, fixture.language);
  encodings.set(keyFor(fixture), encoded);
  const actual = {language: fixture.language, text: fixture.text,
    tokens: encoded.tokens.map(({text, start, end, pieceIds}) => ({text, start, end, pieceIds})),
    chunks: encoded.tokenChunks};
  assert.deepEqual(actual, fixture, 'Tokenizer and WordPiece fixture ' + index);
  const pruned = encodeContext(fixture.text, fixture.language, {policyOnly: true});
  assert.deepEqual(pruned.tokens, encoded.tokens, 'Pruning preserves original token spans');
  assert.deepEqual(pruned.tokenChunks, encoded.tokenChunks, 'Pruning preserves full tokenizer chunks');
  const expected = encoded.chunks.filter(chunk => chunk.words.some(word => word.candidateRowIds.some(id => id !== 0 && activeActions[String(id)])));
  assert.deepEqual(pruned.chunks, expected, 'Pruning retains complete tensors and all competitors for enabled chunks');
  fullChunks += encoded.chunks.length;
  prunedChunks += pruned.chunks.length;
  return actual;
});

const inputNames = ['input_ids', 'attention_mask', 'word_positions', 'candidate_ids', 'candidate_mask'];
for (const [index, fixture] of fixtures.probes.entries()) {
  const encoded = encodings.get(keyFor(fixture));
  assert.ok(encoded, 'Raw fixture has a tokenizer fixture');
  const chunks = encoded.chunks.filter(chunk => JSON.stringify(chunk.words.map(word => word.tokenIndex)) === JSON.stringify(fixture.tokenIndices));
  assert.equal(chunks.length, 1, 'Unambiguous selected words for raw fixture ' + index);
  const inputs = Object.fromEntries(inputNames.map(name => [name, chunks[0][name]]));
  assert.deepEqual(inputs, fixture.inputs, 'Exact full-mode tensor map ' + index);
}

const originalFetch = globalThis.fetch, originalWorker = globalThis.Worker;
let fetchAttempts = 0, workerAttempts = 0, session;
globalThis.fetch = async () => { fetchAttempts++; throw new Error('Network fetch forbidden in local WASM parity'); };
globalThis.Worker = class { constructor() { workerAttempts++; throw new Error('Workers forbidden in single-thread WASM parity'); } };
const probes = [];
let maximumAbsoluteError = 0, inferenceMilliseconds = 0, sessionLoadMilliseconds = 0;
try {
  const ort = await import('onnxruntime-web/wasm');
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmBinary = wasmBytes;
  const loadStarted = performance.now();
  session = await ort.InferenceSession.create(modelBytes, {executionProviders: ['wasm'], graphOptimizationLevel: 'all'});
  sessionLoadMilliseconds = performance.now() - loadStarted;
  for (const [index, fixture] of fixtures.probes.entries()) {
    const inputs = fixture.inputs, batch = inputs.input_ids.length;
    const sequence = inputs.input_ids[0].length, words = inputs.word_positions[0].length;
    const feeds = Object.fromEntries(inputNames.map(name => {
      const values = inputs[name], candidates = name === 'candidate_ids' || name === 'candidate_mask';
      const dimensions = candidates ? [batch, words, 9] : [batch, name === 'word_positions' ? words : sequence];
      const tensor = name === 'candidate_mask'
        ? new ort.Tensor('float32', Float32Array.from(values.flat(2)), dimensions)
        : new ort.Tensor('int64', BigInt64Array.from(values.flat(2), BigInt), dimensions);
      return [name, tensor];
    }));
    let output;
    try {
      const inferenceStarted = performance.now();
      output = await session.run(feeds);
      inferenceMilliseconds += performance.now() - inferenceStarted;
      assert.deepEqual(output.logits.dims, [batch, words, 9]);
      const values = Array.from(output.logits.data);
      const expected = fixture.logitsFloat32.flat(2), mask = inputs.candidate_mask.flat(2);
      assert.equal(values.length, expected.length);
      for (let offset = 0; offset < values.length; offset++) {
        assert.ok(Number.isFinite(values[offset]), 'Finite WASM logit');
        const error = Math.abs(values[offset] - expected[offset]);
        maximumAbsoluteError = Math.max(maximumAbsoluteError, error);
        assert.ok(error <= fixtures.absoluteTolerance, `WASM probe ${index}, logit ${offset}: ${error} > ${fixtures.absoluteTolerance}`);
        if (!mask[offset]) assert.equal(values[offset], -10000, 'Masked candidate logit');
      }
      probes.push({logits: Array.from({length: batch}, (_, b) => Array.from({length: words}, (_, word) => values.slice((b * words + word) * 9, (b * words + word + 1) * 9)))});
    } finally {
      for (const tensor of Object.values(feeds)) tensor.dispose();
      if (output) for (const tensor of Object.values(output)) tensor.dispose();
    }
  }
} finally {
  if (session) await session.release();
  globalThis.fetch = originalFetch;
  if (originalWorker === undefined) delete globalThis.Worker;
  else globalThis.Worker = originalWorker;
}
assert.equal(fetchAttempts, 0);
assert.equal(workerAttempts, 0);
for (const [name, expected] of Object.entries(sourceHashes)) assert.equal(hash(read('packages/core/src/' + name)), expected, 'Source changed during parity: ' + name);
assert.equal(hash(read('packages/core/models/context-encoder.onnx')), identity.modelSha256);
assert.equal(hash(read('packages/core/models/context-encoder-metadata.json')), identity.metadataSha256);
const runtime = {tokenizerProbes, probes};
if (runtimeOutputPath) {
  mkdirSync(dirname(runtimeOutputPath), {recursive: true});
  writeFileSync(runtimeOutputPath, JSON.stringify(runtime) + '\n');
}
const report = {status: 'pass', backend: 'onnxruntime-web 1.31.1 CPU/WASM', threads: 1,
  modelSha256: identity.modelSha256, metadataSha256: identity.metadataSha256,
  fixtureSha256: hash(fixtureBytes), wasmSha256: hash(wasmBytes), functionalSourceSha256: sourceHashes,
  tokenizerProbes: tokenizerProbes.length, exactTensorMaps: probes.length, rawLogitProbes: probes.length,
  maximumAbsoluteError, absoluteTolerance: fixtures.absoluteTolerance,
  sparseCandidateMasks: 'pass', fullDefaultEncoding: 'pass',
  policyPruning: {status: 'pass', policyIdentityValid: validPolicy, enabledActions: Object.keys(activeActions).length,
    fullChunks, retainedChunks: prunedChunks, completeUsedChunksUnchanged: true},
  fetchAttempts, workerAttempts, sessionLoadMilliseconds, inferenceMilliseconds,
  totalMilliseconds: performance.now() - started, peakRssKiB: process.resourceUsage().maxRSS,
  scope: 'Fixed public synthetic tokenizer, tensors and raw arithmetic portability; no correction-quality data.'};
mkdirSync(dirname(reportPath), {recursive: true});
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
