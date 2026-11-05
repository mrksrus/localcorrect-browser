// Positive protective vocabulary only. No test cases or correction labels are read.
import{readFileSync,writeFileSync}from'node:fs';import{createHash}from'node:crypto';
const root='packages/core/vendor/protect-vocabulary',manifest=JSON.parse(readFileSync(root+'/sources.json','utf8'));
const software=new Set(),people=new Set();
for(const source of manifest.sources){
 const bytes=readFileSync(root+'/'+source.file);if(createHash('sha256').update(bytes).digest('hex')!==source.sha256)throw Error('Protective vocabulary source changed');
 if(!source.file.endsWith('.txt')||source.file.includes('LICENSE'))continue;
 const words=source.file.startsWith('people-names')?people:software;
 for(const line of bytes.toString('utf8').split(/\r?\n/)){const w=line.trim().replace(/^\+|\+$/g,'');if(/^\p{L}[\p{L}\p{M}-]+$/u.test(w))words.add(w.normalize('NFC').toLowerCase());}
}
// Regular plural variants protect normal technical prose, not arbitrary suffixes.
for(const word of [...software])if(!/(?:s|x|z|ch|sh|y)$/.test(word))software.add(word+'s');
const asset='// CSpell MIT and Homebrew BSD-2-Clause positive vocabulary. See vendor/protect-vocabulary.\nexport const software='+JSON.stringify([...software].sort().join('\n'))+';\nexport const people='+JSON.stringify([...people].sort().join('\n'))+';\n';
writeFileSync('packages/core/src/protect-vocabulary.js',asset);writeFileSync('protect-sources.json',JSON.stringify({source:manifest,words:{software:software.size,people:people.size},assetSha256:createHash('sha256').update(asset).digest('hex')},null,2)+'\n');console.log({software:software.size,people:people.size,bytes:Buffer.byteLength(asset)});
