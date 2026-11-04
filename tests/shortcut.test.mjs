import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('shipping Firefox and Chrome expose explicit correction/undo shortcuts', async () => {
  for (const browser of ['firefox', 'chrome']) {
    const manifest = JSON.parse(await readFile(`build/${browser}/manifest.json`, 'utf8'));
    assert.equal(manifest.commands?.['correct-text']?.suggested_key?.default, 'Alt+Shift+C');
    assert.equal(manifest.commands?.['undo-correction']?.suggested_key?.default, 'Alt+Shift+Z');
    assert.ok(manifest.permissions.includes('storage'));
    assert.equal(manifest.host_permissions, undefined);
    assert.equal(manifest.content_scripts, undefined);
    assert.ok(browser === 'firefox' ? manifest.background?.scripts?.includes('background.js') : manifest.background?.service_worker === 'background.js');
    assert.equal(manifest.options_ui?.page, 'options.html');
  }
});

test('shortcut runner pins the focused target before dictionary loading and uses saved choices', async () => {
  const {createRunner} = await import('../extension/runner.js');
  const calls = [];
  const api = {
    tabs: {query: async () => [{id: 7, url: 'https://fixture.invalid/'}]},
    runtime: {getURL: path => `moz-extension://fixture/${path}`},
    storage: {local: {get: async () => ({language: 'de', mode: 'balanced'})}},
    scripting: {executeScript: async request => {
      calls.push(request);
      if (request.files) return [{result: undefined}];
      if (!request.args?.[0]) return [{result: 31}];
      return [{result: {changed: 2, skipped: 0}}];
    }}
  };
  const runner = createRunner(api, async url => {
    assert.equal(calls.length, 2, 'focused field must be pinned before asynchronous dictionary reads');
    return {ok: true, text: async () => url.includes('/de.') ? 'bitte 100000' : 'please 100000'};
  });
  assert.deepEqual(await runner.run('correct'), {changed: 2, skipped: 0});
  assert.deepEqual(calls[0].target, {tabId: 7});
  assert.deepEqual(calls[2].args[1], {action: 'correct', language: 'de', mode: 'balanced', operationId: 31});
});

test('shortcut runner rejects duplicate operations and invalid settings before writing text', async () => {
  const {createRunner} = await import('../extension/runner.js');
  let finish;
  const gate = new Promise(resolve => {finish = resolve;});
  const api = {tabs: {query: async () => [{id: 9, url: 'https://fixture.invalid/'}]},
    runtime: {getURL: x => x}, storage: {local: {get: async () => ({language: 'bad', mode: 'unsafe'})}},
    scripting: {executeScript: async request => request.files ? [] : request.args?.[0] ? [{result:{changed:1,skipped:0}}] : [{result:1}]}};
  const runner = createRunner(api, async () => {await gate; return {ok:true, text:async ()=>'sample 10000'};});
  const first = runner.run('correct');
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(runner.run('correct'), /already running/i);
  finish();
  assert.deepEqual(await first, {changed:1,skipped:0});
  await assert.rejects(runner.run('unsupported'), /Unknown action/);
});
