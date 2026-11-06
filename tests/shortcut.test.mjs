import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {defaults, normalizeSettings, readSettings} from '../extension/settings.js';

test('vocabulary settings preserve booleans and safely default older or invalid values', async () => {
  assert.equal(defaults.mixedLanguage, true);
  assert.equal(normalizeSettings({mixedLanguage: false}).mixedLanguage, false);
  assert.equal(normalizeSettings({mixedLanguage: true}).mixedLanguage, true);
  for (const mixedLanguage of [undefined, null, 'false', 'true', 0, 1, [], {}]) {
    assert.equal(normalizeSettings({mixedLanguage}).mixedLanguage, true);
  }
  assert.equal(normalizeSettings(null).mixedLanguage, true);
  assert.deepEqual(await readSettings({storage: {local: {get: async keys => {
    assert.deepEqual(keys, ['ui', 'language', 'mode', 'mixedLanguage']);
    return {ui: 'de', language: 'en', mode: 'balanced', mixedLanguage: false};
  }}}}), {ui: 'de', language: 'en', mode: 'balanced', mixedLanguage: false});
});

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
    tabs: {query: async () => [{id: 7, windowId: 2, url: 'https://fixture.invalid/'}]},
    windows: {getLastFocused: async () => ({id: 2, focused: true})},
    runtime: {getURL: path => `moz-extension://fixture/${path}`},
    storage: {local: {get: async () => ({language: 'de', mode: 'balanced', mixedLanguage: false})}},
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
  assert.deepEqual(calls[2].args[1], {action: 'correct', language: 'de', mode: 'balanced', mixedLanguage: false, operationId: 31});
});

test('shortcut runner rejects duplicate operations and invalid settings before writing text', async () => {
  const {createRunner} = await import('../extension/runner.js');
  let finish;
  const gate = new Promise(resolve => {finish = resolve;});
  const api = {tabs: {query: async () => [{id: 9, windowId: 2, url: 'https://fixture.invalid/'}]},
    windows: {getLastFocused: async () => ({id: 2, focused: true})},
    runtime: {getURL: x => x}, storage: {local: {get: async () => ({language: 'bad', mode: 'unsafe'})}},
    scripting: {executeScript: async request => {
      if (request.files) return [];
      if (!request.args?.[0]) return [{result:1}];
      assert.deepEqual(request.args[1], {action:'correct',language:'en',mode:'conservative',mixedLanguage:true,operationId:1});
      return [{result:{changed:1,skipped:0}}];
    }}};
  const runner = createRunner(api, async () => {await gate; return {ok:true, text:async ()=>'sample 10000'};});
  const first = runner.run('correct');
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(runner.run('correct'), /already running/i);
  finish();
  assert.deepEqual(await first, {changed:1,skipped:0});
  await assert.rejects(runner.run('unsupported'), /Unknown action/);
});

test('saved vocabulary choice reaches contextual preparation and application without changing text language', async () => {
  const {createRunner} = await import('../extension/runner.js');
  const options = [], predictions = [];
  const api = {
    tabs: {query: async () => [{id: 7, windowId: 2, url: 'https://fixture.invalid/'}]},
    windows: {getLastFocused: async () => ({id: 2, focused: true})},
    runtime: {getURL: path => path},
    storage: {local: {get: async () => ({ui: 'de', language: 'en', mixedLanguage: false})}},
    scripting: {executeScript: async request => {
      if (request.files) return [];
      if (!request.args) return [{result: 41}];
      if (typeof request.args[0] === 'number') return [];
      const selected = request.args.find(value => value?.action === 'correct');
      options.push(structuredClone(selected));
      return request.args.length === 1 ? [{result: {operationId: 41, text: 'a draft'}}] : [{result: {changed: 0, skipped: 1}}];
    }}
  };
  const runner = createRunner(api, async () => ({ok: true, text: async () => 'draft 10000'}), async (text, language) => {
    predictions.push({text, language});return [];
  });
  assert.deepEqual(await runner.run('correct'), {changed: 0, skipped: 1});
  assert.deepEqual(predictions, [{text: 'a draft', language: 'en'}]);
  assert.deepEqual(options, [
    {action: 'correct', language: 'en', mode: 'conservative', mixedLanguage: false, operationId: 41},
    {action: 'correct', language: 'en', mode: 'conservative', mixedLanguage: false, operationId: 41, contextScores: []}
  ]);
});

test('switching browser tab or leaving the browser during dictionary loading refuses application', async () => {
  const {createRunner} = await import('../extension/runner.js');
  for (const change of ['tab', 'window', 'unfocused']) {
    let finish, applied = false, active = {id: 7, windowId: 2, url: 'https://fixture.invalid/'};
    let focused = {id: 2, focused: true};
    const gate = new Promise(resolve => {finish = resolve;});
    const api = {
      tabs: {query: async () => [active]}, windows: {getLastFocused: async () => focused},
      runtime: {getURL: x => x}, storage: {local: {get: async () => ({})}},
      scripting: {executeScript: async request => {
        if (request.files) return [];
        if (!request.args) return [{result: 1}];
        applied = true; return [{result: {changed: 1, skipped: 0}}];
      }}
    };
    const runner = createRunner(api, async () => {await gate; return {ok: true, text: async () => 'sample 10000'};});
    const result = runner.run('correct');
    await new Promise(resolve => setImmediate(resolve));
    if (change === 'tab') active = {...active, id: 8};
    if (change === 'window') focused = {id: 3, focused: true};
    if (change === 'unfocused') focused = {id: 2, focused: false};
    finish();
    await assert.rejects(result, /tab or window changed/i, change);
    assert.equal(applied, false, change);
  }
});
