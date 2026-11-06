import{readFileSync,writeFileSync}from'node:fs';
import{createHash}from'node:crypto';
import{createCorrector,protectedRanges}from'../packages/core/src/index.js';
import{contextProposals}from'../packages/core/src/context-model.js';
const[modelPath,inputPath,outputPath]=process.argv.slice(2);
if(!modelPath||!inputPath||!outputPath)throw new Error('Usage: context-predict.mjs MODEL INPUT OUTPUT');
const modelBytes=readFileSync(modelPath),model=JSON.parse(modelBytes),bytes=readFileSync(inputPath);
let cases;if(inputPath.endsWith('.jsonl'))cases=bytes.toString().trim().split('\n').map(x=>JSON.parse(x));else{const data=JSON.parse(bytes);cases=data.cases||data;}
const corrector=createCorrector(Object.fromEntries(['en','de'].map(l=>[l,readFileSync(new URL(`../packages/core/dictionaries/${l}.txt`,import.meta.url),'utf8')])));
const rows=[];
for(const row of cases){
 const baseline=corrector.correct(row.input,{language:row.language,contextual:false});
 const proposals=contextProposals(model,row.input,row.language,protectedRanges(row.input),baseline.edits);
 rows.push({id:row.id,language:row.language,document_id:row.document_id||row.id,source:row.source||null,input:row.input,expected:row.expected,kind:row.kind||null,edits:row.edits||null,baseline,proposals});
}
const runtimeSha256=Object.fromEntries(['context-score.js','context-model.js','index.js'].map(name=>[name,createHash('sha256').update(readFileSync(new URL('../packages/core/src/'+name,import.meta.url))).digest('hex')]));
const output={schemaVersion:1,modelSha256:createHash('sha256').update(modelBytes).digest('hex'),inputSha256:createHash('sha256').update(bytes).digest('hex'),runtimeSha256,rows};
writeFileSync(outputPath,JSON.stringify(output));
console.log(JSON.stringify({documents:rows.length,proposals:rows.reduce((sum,row)=>sum+row.proposals.length,0),output:outputPath}));
