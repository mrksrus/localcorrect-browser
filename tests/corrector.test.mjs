import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createCorrector} from '../extension/corrector.js';

const data = code => readFileSync(new URL(`../extension/data/${code}.lex`, import.meta.url), 'utf8');
const c = createCorrector({en: data('en'), de: data('de')});
const fix = (text, language) => c.correct(text, {language}).text;

const FIXES = [
  ['I recieve teh email yesterday and wil anser it tomorow.', 'I receive the email yesterday and will answer it tomorrow.'],
  ['Thsi is a realy importnat mesage abuot our project.', 'This is a really important message about our project.'],
  ['Can you plese send me the documnet?', 'Can you please send me the document?'],
  ['i dont think we can make it, im sorry.', "I don't think we can make it, I'm sorry."],
  ['We shoud definately meet nxet week.', 'We should definitely meet next week.'],
  ['Ich habe die Email gestren bekomen und werde morgne antworen.', 'Ich habe die Email gestern bekommen und werde morgen antworten.'],
  ['Könnten Sie mir bitte das Dokumnet schiken?', 'Könnten Sie mir bitte das Dokument schicken?'],
  ['Vielen Dnak fur Ihre schnelel Antwrot.', 'Vielen Dank für Ihre schnelle Antwort.'],
  ['Ich wuerde gerne ueber das Thema reden.', 'Ich würde gerne über das Thema reden.'],
  ['Das haus ist gross.', 'Das Haus ist groß.'],
  ['Wir haben das Problem leider noch nicht gelöst, aber wir arbieten daran.', 'Wir haben das Problem leider noch nicht gelöst, aber wir arbeiten daran.'],
];
const UNCHANGED = [
  'Meeting with Sam Markus and Joahnnes at https://exmaple.com/teh-page.',
  'Mail teh.user@exmaple.com or ping @tehdev about #recieve.',
  'Run npm install --save-dev and check src/utils/helpr.js, then call getUsr(id).',
  'Version 2.0.1 ships on 15.11.2026 with ID abc123.',
  '> I recieve teh quoted line\nThanks!',
  'NASA and the EU use HTML, JSON and OAuth.',
  'Hallo Sam, wie gehts? Ich freue mich auf die Kundenanfrage zur Rechnungsadresse.',
  'Die Projektbesprechungstermine sind am Montag, Grüße an Herrn Schmidtke.',
  'Das Deployment im Büro ist fertig, das Meeting war gut.',
  'This is a perfectly normal sentence without any mistakes.',
  'Dies ist ein ganz normaler Satz ohne Fehler.',
];

test('fixes common typos', () => { for (const [input, want] of FIXES) assert.equal(fix(input), want); });
test('leaves names, links, code, numbers, quotes and valid text alone', () => {
  for (const input of UNCHANGED) assert.equal(fix(input), input);
});
test('language detection and forced language', () => {
  assert.equal(c.correct('Das ist gut, danke für alles.').language, 'de');
  assert.equal(c.correct('This is good, thanks for everything.').language, 'en');
  assert.equal(fix('Das ist gut, danke fur alles.'), 'Das ist gut, danke für alles.');
  assert.equal(fix('Das ist gut, danke fur alles.', 'en'), 'Das ist gut, danke fur alles.');
});
test('edit offsets point into the original text', () => {
  const text = 'A teh B wil C', {edits} = c.correct(text);
  for (const e of edits) assert.equal(text.slice(e.offset, e.offset + e.length), e.original);
});
test('a 1,000-word email takes well under a second', () => {
  const email = 'Hallo zusammen, ich habe die Unterlagen gestren bekomen und schike sie morgne weiter. '.repeat(80);
  const start = performance.now();
  c.correct(email);
  assert.ok(performance.now() - start < 1000);
});
