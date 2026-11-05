// Compile a complete positive EN/DE inventory. No documents, typo labels or tests
// are inputs. The minimal acyclic automaton stores shared suffixes only once.
import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const MAGIC=0x3141434c, VERSION=1;
const sha=value=>createHash('sha256').update(value).digest('hex');
const fnv=bytes=>{let hash=2166136261;for(const byte of bytes)hash=Math.imul(hash^byte,16777619)>>>0;return hash;};

/** Sorted incremental minimization keeps only an unfinished word path alive.
 * The registry contains signatures and numeric IDs, rather than a full trie.
 * Exported for small representation fixtures; production inputs are below. */
export function compileWords(input){
 const words=[...new Set([...input].map(word=>word.toLowerCase()).filter(Boolean))].sort();
 if(!words.length)throw new Error('An ambiguity inventory cannot be empty.');
 const symbols=new Set();let maxLength=0;
 for(const word of words){let length=0;for(const character of word){const symbol=character.codePointAt(0);if(symbol>=0xd800&&symbol<=0xdfff)throw new Error('Unpaired surrogate in ambiguity inventory.');symbols.add(symbol);length++;}maxLength=Math.max(maxLength,length);}
 if(maxLength>255||symbols.size>65535)throw new Error('Ambiguity inventory exceeds format limits.');
 const alphabet=[...symbols].sort((a,b)=>a-b),symbolIds=new Map(alphabet.map((symbol,id)=>[symbol,id]));
 const registry=new Map(),meta=[],targets=[],labels=[],ranges=[];
 const fresh=()=>({terminal:false,edges:new Map()});
 const frontier=[fresh()];let previous=[];
 function minimize(depth){
  while(frontier.length>depth+1){
   const at=frontier.length-1,node=frontier.pop(),edges=[...node.edges].sort((a,b)=>a[0]-b[0]);
   const parts=[node.terminal?1:0];for(const [symbol,target] of edges)parts.push(symbol,target);
   const signature=parts.join(',');let id=registry.get(signature);
   if(id===undefined){
    id=meta.length;registry.set(signature,id);meta.push(targets.length*2+(node.terminal?1:0));
    let min=node.terminal?0:255,max=0;
    for(const [symbol,target] of edges){labels.push(symbolIds.get(symbol));targets.push(target);const range=ranges[target];min=Math.min(min,(range&255)+1);max=Math.max(max,(range>>>8)+1);}
    ranges.push(min+(max<<8));
   }
   frontier[at-1].edges.set(previous[at-1],id);
  }
 }
 for(const word of words){
  const current=Array.from(word,character=>character.codePointAt(0));let common=0;
  while(common<previous.length&&common<current.length&&previous[common]===current[common])common++;
  minimize(common);
  for(let at=common;at<current.length;at++){const node=fresh();frontier[at].edges.set(current[at],node);frontier.push(node);}
  frontier[current.length].terminal=true;previous=current;
 }
 minimize(0);
 // All child IDs precede their parent, including the root. This also permits
 // linear structural validation without a runtime graph or recursion.
 const root=frontier[0],rootId=meta.length,rootEdges=[...root.edges].sort((a,b)=>a[0]-b[0]);
 meta.push(targets.length*2+(root.terminal?1:0));let min=root.terminal?0:255,max=0;
 for(const [symbol,target] of rootEdges){labels.push(symbolIds.get(symbol));targets.push(target);min=Math.min(min,(ranges[target]&255)+1);max=Math.max(max,(ranges[target]>>>8)+1);}
 ranges.push(min+(max<<8));meta.push(targets.length*2);
 const nodes=ranges.length,edges=targets.length;
 const metaAt=32,targetAt=metaAt+meta.length*4,labelAt=targetAt+edges*4,rangeAt=labelAt+edges*2,alphabetAt=(rangeAt+nodes*2+3)&~3;
 const bytes=Buffer.alloc(alphabetAt+alphabet.length*4);
 for(const [at,value] of [MAGIC,VERSION,nodes,edges,alphabet.length,rootId,words.length,maxLength].entries())bytes.writeUInt32LE(value,at*4);
 meta.forEach((value,at)=>bytes.writeUInt32LE(value,metaAt+at*4));
 targets.forEach((value,at)=>bytes.writeUInt32LE(value,targetAt+at*4));
 labels.forEach((value,at)=>bytes.writeUInt16LE(value,labelAt+at*2));
 ranges.forEach((value,at)=>bytes.writeUInt16LE(value,rangeAt+at*2));
 alphabet.forEach((value,at)=>bytes.writeUInt32LE(value,alphabetAt+at*4));
 return {
  asset:{format:VERSION,byteLength:bytes.length,checksum:fnv(bytes),data:bytes.toString('base64')},
  stats:{words:words.length,nodes,edges,symbols:alphabet.length,maxLength,decodedBytes:bytes.length,inventorySha256:sha(words.join('\n')),binarySha256:sha(bytes)}
 };
}

async function main(){
 const sources=[
  {file:'packages/core/src/lexicons/en.js',export:'default',description:'Affix-expanded English US/GB Hunspell inventory; see lexicon-sources.json.'},
  {file:'packages/core/src/lexicons/de.js',export:'default',description:'Affix-expanded German DE/AT Hunspell inventory; see lexicon-sources.json.'},
  {file:'packages/core/src/protect-vocabulary.js',export:'software',description:'Positive CSpell/Homebrew software inventory, including compiled regular plurals; see protect-sources.json.'},
  {file:'packages/core/src/protect-vocabulary.js',export:'people',description:'Positive CSpell people inventory; see protect-sources.json.'}
 ];
 const inventories=[];
 for(const source of sources){const module=await import(pathToFileURL(process.cwd()+'/'+source.file));const text=module[source.export];if(typeof text!=='string'||!text.length)throw new Error('Missing positive ambiguity source: '+source.file);const words=text.split('\n');source.sha256=sha(readFileSync(source.file));source.sourceWords=words.length;source.foldedWords=new Set(words.map(word=>word.toLowerCase())).size;for(const word of words)inventories.push(word);}
 const {asset,stats}=compileWords(inventories);
 const output='// Generated complete casefolded EN/DE positive DAWG. See ambiguity-sources.json.\nexport default '+JSON.stringify(asset)+';\n';
 writeFileSync('packages/core/src/ambiguity-data.js',output);
 writeFileSync('ambiguity-sources.json',JSON.stringify({description:'Complete union of existing positive lexical inventories, lowercased with JavaScript toLowerCase. No NFC rewrite, frequency cutoff, typo priors, evaluation examples or user documents. This conservative inventory proves lexical ambiguity only; it does not authorize corrections.',format:'LCDAWG1: little-endian child-first minimal acyclic automaton; sorted symbol-ID edges; terminal/start metadata; min/max suffix lengths; Unicode scalar alphabet.',inputs:sources,upstreamManifests:{'lexicon-sources.json':sha(readFileSync('lexicon-sources.json')),'protect-sources.json':sha(readFileSync('protect-sources.json'))},...stats,assetBytes:Buffer.byteLength(output),assetSha256:sha(output)},null,2)+'\n');
 console.log(JSON.stringify({...stats,assetBytes:Buffer.byteLength(output),peakRssKiB:process.resourceUsage().maxRSS}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
