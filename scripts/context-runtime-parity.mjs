import{readFileSync}from'node:fs';
import{contextTokens,contextScore}from'../packages/core/src/context-score.js';
const[modelPath,probesPath]=process.argv.slice(2);
const model=JSON.parse(readFileSync(modelPath,'utf8')),input=JSON.parse(readFileSync(probesPath,'utf8'));
const tokenRows=input.tokenizerProbes||[];
const tokenizerProbes=tokenRows.map(row=>({text:row.text,tokens:contextTokens(row.text)}));
const probes=(input.probes||[]).map(row=>contextScore(model,row.tokens,row.tokenIndex,row.language,row.candidateRowIds));
process.stdout.write(JSON.stringify({tokenizerProbes,probes}));
