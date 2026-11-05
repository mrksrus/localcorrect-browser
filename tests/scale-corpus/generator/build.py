#!/usr/bin/env python3
"""Deterministic corpus authoring. Reads only pinned sources and original context files.
No correction engine, existing fixtures, model service or evaluation result is used.
"""
from pathlib import Path
from zipfile import ZipFile
from collections import Counter, defaultdict
import hashlib, json, random, re, unicodedata
from content import OPENERS, CLOSERS, PARAGRAPHS, SAFE
ROOT=Path(__file__).resolve().parent
OUT=ROOT/'frozen'
SEED=2026110501
RNG=random.Random(SEED)

def norm(s): return unicodedata.normalize('NFKC',s).casefold()
def digest(b): return hashlib.sha256(b).hexdigest()
def write_json(path,obj): path.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n')
def utf16(s): return len(s.encode('utf-16-le'))//2

def load_sources():
    downloads=json.loads((ROOT/'sources/download-manifest.json').read_text())
    for item in downloads:
        b=(ROOT/'sources'/item['file']).read_bytes()
        assert len(b)==item['bytes'] and digest(b)==item['sha256'],item['file']
    assert 'Creative Commons Attribution-Share-Alike License 3.0' in (ROOT/'sources/codespell-README.rst').read_text()
    assert 'CC BY-SA 4.0' in (ROOT/'sources/litkey-access.html').read_text()
    en={}; valid=set()
    for line in (ROOT/'sources/codespell-dictionary.txt').read_text().splitlines():
        if '->' not in line:continue
        a,b=line.split('->',1)
        for t in b.split(','):
            if t.strip().isalpha():valid.add(norm(t.strip()))
        if ',' not in b and a.isalpha() and b.isalpha():en[norm(a),norm(b)]=(a,b)
    de=Counter(); all_targets=set(); csv_count=0
    with ZipFile(ROOT/'sources/Litkey-csv.zip') as z:
        for info in z.infolist():
            if not info.filename.endswith('.csv') or info.filename.startswith('__MACOSX/'):continue
            assert info.file_size<1000000
            csv_count+=1
            for line in z.read(info).decode('utf-8-sig').splitlines():
                cols=line.split('\t')
                if len(cols)!=2:continue
                a,b=cols
                if b.isalpha():all_targets.add(norm(b))
                if a.isalpha() and b.isalpha() and norm(a)!=norm(b) and len(a)>=3 and len(b)>=4:
                    de[a,b]+=1
    assert csv_count==1922
    valid|=all_targets
    return en,de,valid,downloads

FRAMES=[]
for line in (ROOT/'frames.tsv').read_text().splitlines():
    language,target,sentence=line.split('\t')
    assert target.isalpha() and len(re.findall(r'(?<!\w)'+re.escape(target)+r'(?!\w)',sentence))==1,(target,sentence)
    FRAMES.append({'language':language,'target':target,'sentence':sentence,'family':'target:'+{'antworten':'antwort','arbeiten':'arbeit','versucht':'versuch'}.get(norm(target),norm(target))})
assert len({(f['language'],norm(f['target'])) for f in FRAMES})==len(FRAMES)
EN,DE,VALID,DOWNLOADS=load_sources()
VALID|={norm(f['target']) for f in FRAMES}
# Conservative manual vetoes supplement the source-target word sets. These are
# real words, dialect forms, inflections or historically accepted spellings.
VALID|=set('koten persson jace booing einlauf kosen kühe garen flache grind jake peron stude orignal palet wieda costumer planing therefor employe medicin fell form from angel angle sing sine sighed filed tried tired chose lose loose through though than then mart matin mater manor diner dinner ranger wager wage payer layer lager latter latterly fuller follower farther father former frame flame pubic public causal casual station stationary stationery wiesen wider wertig schell graten gelt packet telephon gehn kuckt guckt gans man mann das dass den denn wen wenn viel fiel reist reißt las ließ ist isst war waren warn mus muss par paar weis weiß seit seid haken hacken klage lage lehr lehrend arme armer armen klar klage bade baden bar bare bären bär'.split())

# Hold out whole normalized target families globally, including shared EN/DE
# words such as Computer/computer. Splitting happens before any case is made.
FAMILIES=sorted({f['family'] for f in FRAMES},key=lambda x:hashlib.sha256(('family-v1:'+x).encode()).hexdigest())
SPLITS={family:('dev' if i<round(.6*len(FAMILIES)) else 'holdout') for i,family in enumerate(FAMILIES)}
FRAME_BY={(f['language'],norm(f['target'])):f for f in FRAMES}
PUBLIC=[]; REJECTED=[]
for line in (ROOT/'public-pairs.txt').read_text().splitlines():
    if not line or line.startswith('#'):continue
    lang,target,typo=line.split()
    f=FRAME_BY[lang,norm(target)]
    if norm(typo) in VALID or norm(typo)==norm(target):
        REJECTED.append({'language':lang,'typo':typo,'target':target,'reason':'valid-word-or-case-only-veto'});continue
    if lang=='en':
        observed=EN.get((norm(typo),norm(target)))
        if not observed:
            REJECTED.append({'language':lang,'typo':typo,'target':target,'reason':'not-an-exact-single-candidate-source-pair'});continue
        source='codespell';license='CC-BY-SA-3.0';frequency=None
    else:
        matches=[(a,b,n) for (a,b),n in DE.items() if norm(a)==norm(typo) and norm(b)==norm(target)]
        if not matches:
            REJECTED.append({'language':lang,'typo':typo,'target':target,'reason':'not-observed-in-source'});continue
        a,b,frequency=sorted(matches,key=lambda x:(-x[2],x[0],x[1]))[0]
        observed=(a,b);source='litkey';license='CC-BY-SA-4.0'
    # Match the curated frame's grammatical capitalization without turning a
    # capitalization issue into a spelling case. This never alters letters.
    typo=typo[:1].upper()+typo[1:] if target[:1].isupper() else typo[:1].lower()+typo[1:]
    PUBLIC.append({'language':lang,'typo':typo,'target':target,'pairFamily':f['family'],'split':SPLITS[f['family']],
        'provenance':'public-source-pair','source':source,'license':license,
        'observedSourcePair':list(observed),'sourceCaseAdapted':list(observed)!=[typo,target],
        **({'sourceOccurrences':frequency} if frequency is not None else {})})

# A small fixed family of common keyboard operations, applied only to curated
# intended words. No random dictionary entries become intended corrections.
# The source-target validity veto excludes known real words, but cannot prove
# the absence of rare words in every language or every possible proper name.
NEIGHBOUR={'a':'s','b':'v','c':'x','d':'f','e':'r','f':'g','g':'h','h':'j','i':'o','j':'k','k':'l','l':'k','m':'n','n':'m','o':'p','p':'o','q':'w','r':'t','s':'a','t':'z','u':'i','v':'c','w':'e','x':'y','y':'x','z':'u','ä':'a','ö':'o','ü':'u','ß':'s'}
PAIRS=list(PUBLIC)
seen={(p['language'],norm(p['typo']),norm(p['target'])) for p in PAIRS}
for f in FRAMES:
    word=f['target'];base=word.lower();n=len(word)
    candidates=[]
    positions=sorted(range(1,n-1),key=lambda j:(abs(j-n/2),j))
    for j in positions:
        candidates.extend([(word[:j]+word[j+1:],'deletion'),
          (word[:j]+word[j+1]+word[j]+word[j+2:],'transposition')])
    for j in positions:
        candidates.append((word[:j]+word[j]*2+word[j+1:],'repeat'))
    for j in positions:
        if base[j] in NEIGHBOUR:
            candidates.append((word[:j]+NEIGHBOUR[base[j]]+word[j+1:],'keyboard-neighbour'))
    # Two variants per operation where available gives broad coverage while
    # avoiding a pool dominated by one repeated-letter recipe.
    chosen=[];operation_counts=Counter()
    for operation in ['deletion','transposition','repeat','keyboard-neighbour']:
        for typo,op in candidates:
            key=(f['language'],norm(typo),norm(word))
            if op!=operation or typo==word or not typo.isalpha() or len(typo)<3 or norm(typo) in VALID or key in seen:continue
            if operation_counts[op]>=1:break
            seen.add(key);operation_counts[op]+=1
            chosen.append({'language':f['language'],'typo':typo,'target':word,'pairFamily':f['family'],'split':SPLITS[f['family']],
                 'provenance':'controlled-mutation','source':'original-keyboard-mutation','license':'CC0-1.0','operation':op})
    PAIRS.extend(chosen)

# Stable IDs do not depend on source file order.
PAIRS.sort(key=lambda p:(p['language'],p['pairFamily'],p['typo'],p['provenance']))
for i,p in enumerate(PAIRS):p['pairId']=f'pair-{i+1:05d}'
PUBLIC=[p for p in PAIRS if p['provenance']=='public-source-pair']
POOLS={}
for lang in ['en','de']:
    for split in ['dev','holdout']:
        a=[p for p in PAIRS if p['language']==lang and p['split']==split]
        RNG.shuffle(a);POOLS[lang,split]=a
CURSORS=Counter()

def pick_pairs(lang,split,count):
    pool=POOLS[lang,split];chosen=[];families=set();attempts=0
    while len(chosen)<count:
        p=pool[CURSORS[lang,split]%len(pool)];CURSORS[lang,split]+=1;attempts+=1
        if p['pairFamily'] in families:continue
        chosen.append(p);families.add(p['pairFamily'])
        assert attempts<10000
    return chosen

def sentence_with_marker(p,i):
    text=FRAME_BY[p['language'],norm(p['target'])]['sentence']
    return re.sub(r'(?<!\w)'+re.escape(p['target'])+r'(?!\w)',f'⟪EDIT{i}⟫',text,count=1)

def reconstruct(marked,pairs):
    input_text='';expected='';edits=[];cursor=0
    matches=list(re.finditer(r'⟪EDIT(\d+)⟫',marked))
    assert len(matches)==len(pairs)
    for m in matches:
        i=int(m.group(1));p=pairs[i]
        prefix=marked[cursor:m.start()];input_text+=prefix;expected+=prefix
        edits.append({'offset':utf16(input_text),'length':utf16(p['typo']),'original':p['typo'],'replacement':p['target'],
            'pairId':p['pairId'],'pairFamily':p['pairFamily'],'provenance':p['provenance'],'source':p['source']})
        input_text+=p['typo'];expected+=p['target'];cursor=m.end()
    input_text+=marked[cursor:];expected+=marked[cursor:]
    return input_text,expected,edits

def build_case(lang,split,kind,format,j,long,global_id):
    rng=random.Random(SEED+global_id*104729)
    # 1-5 intentional edits, with singles most common. A short case with five
    # points is still a plausible short checklist, not necessarily one line.
    counts=[1,1,1,1,1,1,2,2,3,4,5]
    pairs=pick_pairs(lang,split,counts[j%len(counts)]) if kind=='correction' else []
    points=[sentence_with_marker(p,i) for i,p in enumerate(pairs)]
    safe_category=None
    if kind=='safe':
        safe_category,safe_text=SAFE[lang][j%len(SAFE[lang])]
        points=[safe_text]
    rng.shuffle(points)
    if lang=='en':
        greet=rng.choice(['Hello Alex,','Hi Robin,','Hello Sam,','Dear Jordan,','Hi everyone,','Good morning,','Hello Kim,','Dear team,'])
        title=rng.choice(['Arrangements for the coming week','A few practical details','Notes before the next discussion','Update on the remaining points','A short planning update','Details for the next step','Practical notes for our records','Checking the current arrangements'])
        lead=rng.choice(['Here are the points I noted:','The latest details are as follows:','I have these updates for our notes:','Please keep the following points in mind:','These details should help with the next step:','I have written down the practical points below:'])
        tail=rng.choice(['I can check the remaining details after lunch.','We can discuss any open questions tomorrow.','Please keep this note with the other papers.','A short reply when you have time would be helpful.','I will share any further changes in writing.','We can agree on the next step at our next call.'])
        short_prefix=rng.choice(['A quick update: ','For our notes: ','Just to confirm: ','One practical point: ','Before the next call: ','From my notes this morning: ','For the next step: ','A short reminder: ','Here is the latest: ','To keep everyone informed: ','One update for today: ','For the shared list: '])
        ref=f'Reference: W{global_id:05d}'
        section='Additional notes for the workshop team'
    else:
        greet=rng.choice(['Hallo Alex,','Hallo Robin,','Guten Morgen Sam,','Liebe Kim,','Hallo zusammen,','Guten Morgen,','Hallo Mara,','Liebes Team,'])
        title=rng.choice(['Absprachen für die kommende Woche','Ein paar praktische Einzelheiten','Notizen vor dem nächsten Gespräch','Aktueller Stand der offenen Punkte','Kurzer Zwischenstand zur Planung','Angaben für den nächsten Schritt','Praktische Notizen für unsere Unterlagen','Prüfung der aktuellen Absprachen'])
        lead=rng.choice(['Diese Punkte habe ich festgehalten:','Die aktuellen Einzelheiten lauten wie folgt:','Für unsere Notizen gibt es diese Ergänzungen:','Bitte die folgenden Punkte beachten:','Diese Angaben helfen bei der weiteren Abstimmung:','Die praktischen Punkte habe ich hier aufgeschrieben:'])
        tail=rng.choice(['Die restlichen Einzelheiten kann ich nach dem Mittagessen prüfen.','Offene Fragen können wir morgen besprechen.','Bitte lege diese Nachricht zu den übrigen Unterlagen.','Eine kurze Antwort bei Gelegenheit wäre hilfreich.','Weitere Änderungen teile ich schriftlich mit.','Den nächsten Schritt stimmen wir beim nächsten Anruf ab.'])
        short_prefix=rng.choice(['Ein kurzer Zwischenstand: ','Für unsere Notizen: ','Nur zur Bestätigung: ','Ein praktischer Punkt: ','Vor dem nächsten Anruf: ','Aus meinen Notizen von heute: ','Für den nächsten Schritt: ','Eine kurze Erinnerung: ','Hier ist der aktuelle Stand: ','Damit alle Bescheid wissen: ','Eine Ergänzung für heute: ','Für die gemeinsame Liste: '])
        ref=f'Aktennotiz: W{global_id:05d}'
        section='Weitere Hinweise für das Workshopteam'
    opener=OPENERS[lang][rng.randrange(len(OPENERS[lang]))]
    close=CLOSERS[lang][rng.randrange(len(CLOSERS[lang]))]
    paragraphs=list(PARAGRAPHS[lang]);rng.shuffle(paragraphs)
    if format=='short':
        marked=short_prefix+' '.join(points)+' '+tail
        # A visible timestamp naturally distinguishes otherwise identical chat
        # notes. No real timestamp, user identity or message is used.
        day=1+(j//25)%28;hour=8+j%10;minute=(j*7)%60
        marked+=f' [{day:02d}.11., {hour:02d}:{minute:02d}]'
    elif format=='paragraphs':
        parts=[opener,lead+'\n'+'\n'.join(points),paragraphs.pop(),tail,ref]
        if j%3==0:parts.insert(2,paragraphs.pop())
        marked='\n\n'.join(parts)
    else:
        email_opener=opener[:1].lower()+opener[1:] if lang=='de' else opener
        parts=[('Subject: ' if lang=='en' else 'Betreff: ')+title+'\n'+ref,greet,email_opener,lead+'\n'+'\n'.join(points)]
        if global_id%4==0:parts.insert(3,'📌 '+('Please keep this note for reference.' if lang=='en' else 'Bitte diese Notiz aufbewahren.'))
        parts.append(paragraphs.pop())
        if long:
            parts.append(section)
            while len(' '.join(parts+[close]).split())<970:
                assert paragraphs,'Not enough non-repeated long context'
                parts.append(paragraphs.pop())
        parts.append(close)
        marked='\n\n'.join(parts)
    input_text,expected,edits=reconstruct(marked,pairs)
    families=sorted({p['pairFamily'] for p in pairs})
    return {'id':f'scale-{split}-{lang}-{global_id:05d}','split':split,'language':lang,'kind':kind,'format':format,
      'input':input_text,'expected':expected,'edits':edits,'source':sorted({p['source'] for p in pairs}) if pairs else ['original-invented-safe-control'],
      'pairFamily':families[0] if len(families)==1 else None,'pairFamilies':families,
      'pairIds':[e['pairId'] for e in edits],'longEmail':long,'wordCount':len(expected.split()),
      'safetyCategory':safe_category,'contextProvenance':'original-invented-template',
      'templateFamily':'community-workshop-and-practical-correspondence-v1'}

CASES=[];counter=0
for split,total in [('dev',1500),('holdout',1000)]:
    for lang in ['en','de']:
        for kind,ratio in [('correction',.6),('safe',.4)]:
            size=round(total*ratio);j=0
            for fmt,fratio in [('email',.4),('paragraphs',.4),('short',.2)]:
                count=round(size*fratio)
                for k in range(count):
                    counter+=1
                    is_long=fmt=='email' and k<(15 if kind=='correction' else 10)
                    CASES.append(build_case(lang,split,kind,fmt,j,is_long,counter));j+=1
assert len(CASES)==5000
# File order is deterministic but does not group all corrections before controls.
RNG.shuffle(CASES)

def validate():
    ids=set();inputs=set();family_split={};used=set();edit_counts=Counter()
    for row in CASES:
        assert row['id'] not in ids;ids.add(row['id'])
        assert row['input'] not in inputs,row['id'];inputs.add(row['input'])
        assert row['kind']=='safe' or 1<=len(row['edits'])<=5
        assert (row['kind']=='safe')==(row['input']==row['expected'])
        b=row['input'].encode('utf-16-le');out=b'';last=0
        for e in row['edits']:
            start=e['offset']*2;end=start+e['length']*2
            assert start>=last and b[start:end].decode('utf-16-le')==e['original']
            assert e['original'].isalpha() and e['replacement'].isalpha()
            assert norm(e['original'])!=norm(e['replacement'])
            out+=b[last:start]+e['replacement'].encode('utf-16-le');last=end
            assert family_split.setdefault(e['pairFamily'],row['split'])==row['split']
            used.add(e['pairId']);edit_counts[e['provenance']]+=1
        out+=b[last:];assert out.decode('utf-16-le')==row['expected']
        assert utf16(row['input'])<20000
        if row['format']!='short':assert len(row['input'].split('\n\n')) >= (5 if row['format']=='email' else 2)
        if row['longEmail']:assert row['format']=='email' and 950<=row['wordCount']<=1060,row['wordCount']
    assert len(used)>=1000,len(used)
    assert len([r for r in CASES if r['longEmail']])==100
    for split,n in [('dev',3000),('holdout',2000)]:
        assert sum(r['split']==split for r in CASES)==n
    for lang in ['en','de']:
        rows=[r for r in CASES if r['language']==lang]
        assert len(rows)==2500 and sum(r['kind']=='correction' for r in rows)==1500
    for fmt,n in [('email',2000),('paragraphs',2000),('short',1000)]:assert sum(r['format']==fmt for r in CASES)==n
    return used,edit_counts
USED,EDIT_COUNTS=validate()
OUT.mkdir(exist_ok=True)
metadata={'name':'LocalCorrect public synthetic scale corpus','version':1,'seed':SEED,'cases':5000,'license':'CC-BY-SA-4.0',
    'description':'Invented, templated adult EN/DE documents with source-derived isolated typo pairs and controlled keyboard mutations. Not natural message samples or independent real-world accuracy evidence.',
    'offsetUnit':'UTF-16 code units','splitPolicy':'normalized target families, global across languages; assigned before generation',
    'sourceDictionaryOverlap':'Public pairs may also occur in a runtime prior; report such overlap separately. Fresh context does not make a known pair independent.',
    'templateDependency':'Both splits share authored frame and paragraph design; family split prevents targeted-pair leakage, not template or topic dependence.'}
write_json(OUT/'dev.json',{**metadata,'split':'dev','cases':[r for r in CASES if r['split']=='dev']})
write_json(OUT/'holdout.json',{**metadata,'split':'holdout','cases':[r for r in CASES if r['split']=='holdout']})
write_json(OUT/'public-source-pairs.json',{'notes':'Deidentified manually selected isolated word pairs only. No source stories, child identifiers, personal metadata, or source file names. Original per-pair licenses retained.',
    'pairs':PUBLIC})
write_json(OUT/'pair-pool.json',{'pairs':PAIRS})
write_json(OUT/'source-selection-rejections.json',{'notes':'Authoring rejects before engine evaluation. Absence from sources or valid-word veto; no engine outputs used.','pairs':REJECTED})
write_json(OUT/'family-split.json',{'policy':metadata['splitPolicy'],'families':SPLITS})
counts={'cases':len(CASES),'splits':dict(Counter(r['split'] for r in CASES)),'languages':dict(Counter(r['language'] for r in CASES)),
  'kinds':dict(Counter(r['kind'] for r in CASES)),'formats':dict(Counter(r['format'] for r in CASES)),
  'longEmails':sum(r['longEmail'] for r in CASES),'longWordRange':[min(r['wordCount'] for r in CASES if r['longEmail']),max(r['wordCount'] for r in CASES if r['longEmail'])],
  'pairPool':len(PAIRS),'distinctPairsUsed':len(USED),'publicPairs':len(PUBLIC),'controlledPairs':sum(p['provenance']=='controlled-mutation' for p in PAIRS),
  'publicBySource':dict(Counter(p['source'] for p in PUBLIC)),'pairsByLanguage':dict(Counter(p['language'] for p in PAIRS)),
  'intendedEdits':sum(len(r['edits']) for r in CASES),'editOrigins':dict(EDIT_COUNTS),
  'editCountHistogram':dict(sorted(Counter(len(r['edits']) for r in CASES if r['kind']=='correction').items())),
  'targetFamilies':len(FAMILIES),'familyOverlap':0,'utf16NonBmpBeforeEditDocuments':sum(any(ord(c)>65535 for c in r['input'][:r['edits'][0]['offset']]) for r in CASES if r['edits']),
  'strata':dict(Counter('|'.join([r['split'],r['language'],r['kind'],r['format']]) for r in CASES))}
write_json(OUT/'counts.json',counts)
write_json(OUT/'source-manifest.json',{'downloads':DOWNLOADS,'codeRevision':'author-script-v1','seed':SEED,
    'sourcesKeptPrivate':['Litkey-csv.zip'], 'publicArtefactsExclude':'Raw source archive, original child stories, source file names and child identifiers.'})
print(json.dumps(counts,ensure_ascii=False,indent=2))
