import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync, mkdtempSync, cpSync, rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCorrector} from '../packages/core/src/index.js';
import enLexicon from '../packages/core/src/lexicons/en.js';

const dictionaries = Object.fromEntries(['en', 'de'].map(language => [language,
  readFileSync(new URL(`../packages/core/dictionaries/${language}.txt`, import.meta.url), 'utf8')]));
const corrector = createCorrector(dictionaries);
const modes = ['conservative', 'balanced'];

test('lexical inventory fails closed on unordered or repeated entries', () => {
  const dir = mkdtempSync(join(tmpdir(), 'localcorrect-lexical-order-'));
  try {
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
    mkdirSync(join(dir, 'lexicons'));
    cpSync(new URL('../packages/core/src/index.js', import.meta.url), join(dir, 'index.js'));
    for (const name of ['typos.js','typos-language-data.js', 'candidate-lookup.js', 'candidates.js', 'protect-vocabulary.js', 'ambiguity-lookup.js', 'ambiguity-data.js','ambiguity-language-data.js', 'inflection-data.js','context-encoder-data.js','context-policy.js','context-model.js','context-score.js','context-encode.js'])
      cpSync(new URL(`../packages/core/src/${name}`, import.meta.url), join(dir, name));
    writeFileSync(join(dir, 'lexicons/de.js'), 'export default "";');
    const firstEnd = enLexicon.indexOf('\n'), secondEnd = enLexicon.indexOf('\n', firstEnd + 1);
    const first = enLexicon.slice(0, firstEnd), second = enLexicon.slice(firstEnd + 1, secondEnd);
    const variants = [
      second + '\n' + first + enLexicon.slice(secondEnd),
      first + '\n' + enLexicon,
      ('hello\n').repeat(60000),
    ];
    for (const source of variants) {
      writeFileSync(join(dir, 'lexicons/en.js'), `export default ${JSON.stringify(source)};`);
      const probe = `import {createCorrector} from ${JSON.stringify(join(dir, 'index.js'))};createCorrector({en:'hello 10000',de:'hallo 10000'}).correct('hello',{language:'en'});`;
      assert.throws(() => execFileSync(process.execPath, ['--input-type=module', '-e', probe], {stdio:'pipe'}),
        error => /Bundled spelling-validity lexicon/.test(error.stderr.toString()));
    }
  } finally { rmSync(dir, {recursive:true, force:true}); }
});

test('literal syntax remains unchanged while surrounding prose is corrected', () => {
  const literals = [
    '```js\nconst recieve = "seperate";\n```',
    '~~~python\nrecieve = "seperate"\n~~~',
    '```js\nconst recieve = "seperate";',
    '``recieve ` seperate``',
    'recieve()', '@recieve #seperate', '--seperate --recieve',
    '~/seperate /recieve', 'C:\\recieve\\seperate',
    'recieve-value', 'ftp://example.invalid/recieve',
    'const recieved = true;',
  ];
  for (const mode of modes) for (const literal of literals) {
    const input = `Please send teh document.\n${literal}`;
    const expected = `Please send the document.\n${literal}`;
    const result = corrector.correct(input, {language: 'en', mode});
    assert.equal(result.text, expected, `${mode}: ${literal}`);
    assert.equal(result.edits.length, 1);
    const edit = result.edits[0];
    assert.equal(input.slice(edit.offset, edit.offset + edit.length), edit.original);
  }
  for (const mode of modes) {
    const input = '```js\nrecieve\n```\nPlease send teh document.';
    assert.equal(corrector.correct(input, {language: 'en', mode}).text,
      '```js\nrecieve\n```\nPlease send the document.');
  }
});

test('German technical nouns and recognized English words are preserved', () => {
  for (const mode of modes) {
    const input = 'Bitte starte das Deployment nach dem Merge.';
    assert.equal(corrector.correct(input, {language: 'de', mode}).text, input);
  }
  assert.equal(corrector.correct('Kannst du das bite prüfen.', {language: 'de', mode: 'balanced'}).text,
    'Kannst du das bite prüfen.');
});

test('narrow context rules correct common initial typos and avoid replacing email with a name', () => {
  const cases = [
    ['en', 'Thsi works well.', 'This works well.'],
    ['en', 'Thsi is ready.', 'This is ready.'],
    ['de', 'Kanst du später anrufen?', 'Kannst du später anrufen?'],
    ['de', 'Ich habe dir eine Eamil geschickt.', 'Ich habe dir eine E-Mail geschickt.'],
  ];
  for (const mode of modes) for (const [language, input, expected] of cases) {
    const result = corrector.correct(input, {language, mode});
    assert.equal(result.text, expected);
    assert.equal(corrector.correct(result.text, {language, mode}).text, expected);
  }
  const controls = [
    ['en', 'Thsi visited Vienna.'], ['en', 'Dear Thsi, hello.'],
    ['de', 'Herr Kanst kommt morgen.'], ['de', 'Eamil kommt morgen.'],
    ['de', 'Ich schreibe an Eamil.'], ['de', 'Eine Emil genannte Person kommt.'],
    ['de', 'Wir prüfen den Eamil.'], ['de', 'eamil'],
    ['en', 'Use `Thsi works well.` unchanged.'],
  ];
  for (const mode of modes) for (const [language, input] of controls)
    assert.equal(corrector.correct(input, {language, mode}).text, input);
});
