/* SPDX-License-Identifier: GPL-3.0-only
 * Declarative neural edit scorer. Weights are trained separately on attributed
 * correction pairs. No document text or context is retained between calls.
 */
export const contextTokenExpression = /[A-Za-zÀ-ÖØ-öø-ÿĀ-ž]+(?:['’][A-Za-zÀ-ÖØ-öø-ÿĀ-ž]+)*|[^\s]/gu;
const wordExpression=/^[A-Za-zÀ-ÖØ-öø-ÿĀ-ž]+(?:['’][A-Za-zÀ-ÖØ-öø-ÿĀ-ž]+)*$/u;
const upper='ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÜẞ',lower='abcdefghijklmnopqrstuvwxyzäöüß';
export function contextFold(text){let out='';for(const c of text){const i=upper.indexOf(c);out+=i<0?c:lower[i];}return out;}
export function contextBucket(text,language,buckets=8192){let hash=2166136261;const value=language+'|'+contextFold(text);for(let i=0;i<value.length;i++)hash=Math.imul(hash^value.charCodeAt(i),16777619)>>>0;return 2+hash%(buckets-2);}
export function contextScalars(text){const letters=[...text].filter(c=>upper.includes(c)||lower.includes(c));const isUpper=letters.length>0&&letters.every(c=>upper.includes(c)),isLower=letters.length>0&&letters.every(c=>lower.includes(c));const isTitle=letters.length>0&&upper.includes(letters[0])&&letters.slice(1).every(c=>lower.includes(c));return[wordExpression.test(text)?1:0,isTitle?1:0,isUpper?1:0,isLower?1:0];}
export function contextTokens(text){return [...text.matchAll(new RegExp(contextTokenExpression.source,'gu'))].map(match=>({text:match[0],start:match.index,end:match.index+match[0].length,word:wordExpression.test(match[0])}));}

export function contextFeatures(model,tokens,index,language){
 const radius=model.featureSpec?.radius??model.config?.radius??model.radius??3,buckets=model.featureSpec?.buckets??model.config?.buckets??model.buckets??8192;
 const features=[],bucketIds=[],slotScalars=[];
 for(let at=index-radius;at<=index+radius;at++){
  const token=tokens[at],text=typeof token==='string'?token:token?.text;
  const bucket=at<0?0:at>=tokens.length?1:contextBucket(text,language,buckets);
  const scalars=at<0||at>=tokens.length?[0,0,0,0]:contextScalars(text);
  bucketIds.push(bucket);slotScalars.push(scalars);
  features.push(...model.weights.embedding[bucket],...scalars);
 }
 features.push(language==='en'?1:0,language==='de'?1:0);
 return{inputFeatures:features,bucketIds,slotScalars};
}

export function contextScore(model,tokens,index,language,rowIds){
 const result=contextFeatures(model,tokens,index,language),input=result.inputFeatures,w=model.weights,hidden=[];
 for(let h=0;h<w.hiddenWeight.length;h++){let value=w.hiddenBias[h];const row=w.hiddenWeight[h];for(let i=0;i<input.length;i++)value+=row[i]*input[i];hidden.push(Math.tanh(value));}
 const logits=[];
 for(const id of rowIds){let value=w.outputBias[id];const row=w.outputWeight[id];for(let h=0;h<hidden.length;h++)value+=row[h]*hidden[h];logits.push(value);}
 const maximum=Math.max(...logits),exp=logits.map(v=>Math.exp(v-maximum)),total=exp.reduce((a,b)=>a+b,0);
 return{...result,hidden,logits,probabilities:exp.map(v=>v/total)};
}
