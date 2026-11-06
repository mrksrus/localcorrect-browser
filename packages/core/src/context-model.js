/* SPDX-License-Identifier: GPL-3.0-only */
import{contextTokens,contextScore,contextFold}from'./context-score.js';
import{protectedWord}from'./candidate-lookup.js';
const simpleWord=/^[A-Za-zÀ-ÖØ-öø-ÿĀ-ž]+$/u;
const polarity=new Set(['no','not','never','without','neither','nor','nicht','nie','kein','keine','keinen','keinem','keiner','keines','ohne']);
// Public software inventories include ordinary auxiliaries such as "has".
// Literal/identifier protection is checked separately against original spans.
const auxiliaries=new Set(['a','an','am','is','are','was','were','has','have','do','does']);
const overlaps=(a,b,spans)=>spans.some(span=>a<span[1]&&b>span[0]);

/** Score input-only original spans. Gold and thresholds are never read here. */
export function contextProposals(model,text,language,protectedSpans=[],blocked=[],providedScores=null){
 if(!model||!['localcorrect-context-edit-v1','localcorrect-context-encoder-v1'].includes(model.format)||!['en','de'].includes(language))return[];
 const tokens=contextTokens(text);if(tokens.length>10000)return[];
 const prohibited=protectedSpans.concat(blocked.map(e=>[e.offset,e.offset+e.length]));
 const proposals=[];
 const scoreMap=new Map();
 if(providedScores!==null){
  if(!Array.isArray(providedScores)||providedScores.length>3000)return[];
  for(const record of providedScores){const index=record?.tokenIndex;if(Number.isInteger(index)&&index>=0&&index<tokens.length&&!scoreMap.has(index))scoreMap.set(index,record.logits);}
 }
 for(let i=0;i<tokens.length;i++){
  const token=tokens[i],word=token.text,folded=contextFold(word),ids=model.candidatesByTrigger[language+'|'+word];
  if(!token.word||!ids||word.length>32||overlaps(token.start,token.end,prohibited))continue;
  // The compact model tokenizer must never edit a Latin fragment of a larger
  // marked, joined, numeric or non-Latin identifier in the original document.
  const left=text.slice(Math.max(0,token.start-2),token.start),right=text.slice(token.end,token.end+2);
  if(/[\p{L}\p{M}\p{N}\p{Pc}\p{Cf}$%]$/u.test(left)||/^[\p{L}\p{M}\p{N}\p{Pc}\p{Cf}$%]/u.test(right))continue;
  if((word===word.toUpperCase()&&word.length<=5)||(protectedWord('software',folded)&&!auxiliaries.has(folded))||(word[0]!==folded[0]&&protectedWord('people',folded)))continue;
  const previous=text.slice(Math.max(0,token.start-128),token.start);
  if(/\b(?:Herrn?|Frau|Dr\.?|Prof\.?|Mr\.?|Mrs\.?|Ms\.?|Dear|Hello|Hi|Hallo|Liebe|Lieber)(?:[ \t]+\p{Lu}[\p{L}\p{M}-]*){0,2}[ \t]+$/u.test(previous))continue;
  const neighborhood=tokens.slice(Math.max(0,i-3),i+4).map(t=>t.text).join(' ');
  if([...neighborhood].some(c=>/\p{L}/u.test(c)&&!/[A-Za-zÀ-ÖØ-öø-ÿĀ-ž]/u.test(c)))continue;
  const rows=[0,...ids];
  let logits;
  if(providedScores!==null){const values=scoreMap.get(i);if(!Array.isArray(values)||values.length<rows.length||values.length>9||values.some(v=>typeof v!=='number'||!Number.isFinite(v)))continue;logits=values.slice(0,rows.length);}
  else{if(!model.weights)continue;logits=contextScore(model,tokens,i,language,rows).logits;}
  const maximum=Math.max(...logits),exp=logits.map(v=>Math.exp(v-maximum)),total=exp.reduce((a,b)=>a+b,0);
  const score={logits,probabilities:exp.map(v=>v/total)};
  let best=0;for(let at=1;at<rows.length;at++)if(score.logits[at]>score.logits[best])best=at;
  if(best===0)continue;
  const actionId=rows[best],action=model.actions[actionId];
  if(action.kind!=='REPLACE'||action.language!==language||action.trigger!==word||!simpleWord.test(action.replacement)||action.replacement===word||action.replacement.length>32)continue;
  if(polarity.has(folded)||polarity.has(contextFold(action.replacement)))continue;
  const competitors=score.logits.filter((_,at)=>at!==best);
  proposals.push({offset:token.start,length:token.end-token.start,original:word,replacement:action.replacement,actionId,probability:score.probabilities[best],margin:score.logits[best]-score.logits[0],gap:score.logits[best]-Math.max(...competitors),trainCount:action.trainCount});

 }
 return proposals;
}

/** A disabled/missing policy always abstains. Thresholds use an explicit margin
 * buffer over observed negatives; numerical parity alone cannot promise safety. */
export function acceptedContextEdits(model,policy,text,language,protectedSpans=[],blocked=[],providedScores=null){
 if(!policy||policy.schemaVersion!==1)return[];
 if(model?.format==='localcorrect-context-encoder-v1'&&(!model.modelSha256||!model.metadataSha256||policy.onnxSha256!==model.modelSha256||policy.modelSha256!==model.metadataSha256))return[];
 return contextProposals(model,text,language,protectedSpans,blocked,providedScores).filter(proposal=>{
  const limit=policy.actions?.[String(proposal.actionId)];
  return limit&&proposal.trainCount>=limit.minTrainCount&&proposal.margin>=limit.minMargin&&proposal.gap>=limit.minGap&&proposal.probability>=limit.minProbability;
 }).map(({offset,length,original,replacement})=>({offset,length,original,replacement}));
}

export function acceptedContextScores(model,policy,text,language,scores,protectedSpans=[],blocked=[]){return acceptedContextEdits(model,policy,text,language,protectedSpans,blocked,scores);}
