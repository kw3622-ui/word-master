/* Pure learning and import rules, shared with offline tests. */
(function(root){
  'use strict';
  const LEVELS=['초등기본','초등심화','중등기본','중등심화','고등기본','고등심화'];
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm=s=>String(s??'').trim().toLowerCase().replace(/\s+/g,' ');
  const signature=w=>[w.word,w.meaning,w.level,w.pos||'',w.example||'',w.translation||''].join('\t');
  function canonicalize(words){
    const ids=new Map();
    for(const w of [...words].sort((a,b)=>a.id-b.id)){
      const key=norm(w.word)+'\u0000'+w.meaning.trim();
      if(!ids.has(key))ids.set(key,w.id);
    }
    return words.map(w=>({...w,key:String(ids.get(norm(w.word)+'\u0000'+w.meaning.trim()))}));
  }
  const unique=items=>[...new Map(items.map(w=>[w.key,w])).values()];
  function progressIndex(rows){
    const records={};
    for(const p of rows)for(const [key,val] of Object.entries(p.learning||{})) records[key]=val;
    return records;
  }
  function recordFor(word,records,legacy=[],allWords=[]){
    const rec=records[word.key];
    if(rec) return rec.meaning===word.meaning ? rec : {};
    const old=legacy.find(p=>p.word===word.word && p.level===word.level);
    const matches=allWords.filter(w=>w.word===word.word&&w.level===word.level);
    return old && matches.length===1 && !Object.keys(old.learning||{}).length ? {seen:1,legacy:true} : {};
  }
  const knowsMeaning=r=>(r.e2k?.days||0)>=3;
  const knowsSpelling=r=>(r.k2e?.days||0)>=3;
  const remembered=r=>knowsMeaning(r)||knowsSpelling(r);
  const due=(r,now=Date.now())=>!!r.seen && (!r.due_at || Date.parse(r.due_at)<=now);
  function summary(words,records,legacy,allWords,now=Date.now()){
    const pool=unique(words); let seen=0,known=0,review=0,meaning=0,spelling=0;
    for(const w of pool){const r=recordFor(w,records,legacy,allWords);if(r.seen)seen++;if(remembered(r))known++;if(due(r,now))review++;if(knowsMeaning(r))meaning++;if(knowsSpelling(r))spelling++;}
    return {total:pool.length,seen,known,review,meaning,spelling,unseen:pool.length-seen,learning:seen-known,pct:pool.length?Math.round(seen/pool.length*100):0};
  }
  function shuffle(a,random=Math.random){a=a.slice();for(let i=a.length-1;i>0;i--){let j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
  function plan(words,records,legacy,allWords,newCount=5,reviewCount=10,now=Date.now()){
    const pool=unique(words), rec=w=>recordFor(w,records,legacy,allWords);
    const reviews=pool.filter(w=>due(rec(w),now)).sort((a,b)=>(Date.parse(rec(a).due_at)||0)-(Date.parse(rec(b).due_at)||0)).slice(0,reviewCount);
    const fresh=pool.filter(w=>!rec(w).seen).slice(0,newCount);
    return {reviews,fresh,all:[...reviews,...fresh]};
  }
  function options(word,words,count=4){
    const candidates=words.filter(w=>w.key!==word.key && w.meaning!==word.meaning),meanings=[];
    const sameType=w=>w.word.includes(' ')===word.word.includes(' ');
    for(const tier of [candidates.filter(w=>w.level===word.level&&sameType(w)),candidates.filter(sameType),candidates]){
      for(const w of shuffle(tier)){if(!meanings.includes(w.meaning))meanings.push(w.meaning);if(meanings.length>=count-1)break;}
      if(meanings.length>=count-1)break;
    }
    return shuffle([word.meaning,...meanings.slice(0,count-1)]);
  }
  function checkEnglish(input,answer){return norm(input)===norm(answer);}
  function checkKorean(input,answer){
    const normalize=s=>String(s).replace(/\([^)]*\)/g,'').replace(/\s|[.!?~]/g,'').trim();
    const n=normalize(input);if(!n)return false;
    return answer.split(/[;,/；、]/).some(a=>normalize(a)===n);
  }
  function parseDelimited(text){
    text=String(text).replace(/^\uFEFF/,'').replace(/\r\n/g,'\n');
    const first=text.split('\n')[0]||'',delimiter=first.includes('\t')?'\t':',';
    let rows=[],row=[],value='',quoted=false;
    for(let i=0;i<text.length;i++){
      const c=text[i];
      if(c==='"'){
        if(quoted&&text[i+1]==='"'){value+='"';i++;}
        else if(quoted)quoted=false;
        else if(!value)quoted=true;
        else value+=c;
      }else if(c===delimiter&&!quoted){row.push(value);value='';}
      else if(c==='\n'&&!quoted){row.push(value);if(row.some(x=>x.trim()))rows.push(row);row=[];value='';}
      else value+=c;
    }
    if(quoted)throw Error('따옴표가 닫히지 않은 행이 있습니다.');
    row.push(value);if(row.some(x=>x.trim()))rows.push(row);
    if(rows.length<2)throw Error('제목 행과 단어 행이 필요합니다.');
    const aliases={id:'id','번호':'id',word:'word','단어':'word','영어':'word',meaning:'meaning','뜻':'meaning',level:'level','난이도':'level',pos:'pos','품사':'pos',example:'example','예문':'example',translation:'translation','해석':'translation','예문해석':'translation'};
    const headers=rows.shift().map(h=>aliases[h.replace(/\s/g,'').toLowerCase()]);
    for(const h of ['word','meaning','level'])if(!headers.includes(h))throw Error('단어, 뜻, 난이도 제목이 필요합니다.');
    if(new Set(headers.filter(Boolean)).size!==headers.filter(Boolean).length)throw Error('중복된 제목 열이 있습니다.');
    return rows.map((values,i)=>{if(values.length!==headers.length)throw Error((i+2)+'행의 열 수가 제목과 다릅니다.');const obj={};headers.forEach((h,j)=>{if(h)obj[h]=values[j].trim();});return obj;});
  }
  function previewImport(rows,words){
    if(!rows.length||rows.length>2000)throw Error('한 번에 1~2,000개를 등록해주세요.');
    const used=new Set();
    return rows.map((r,i)=>{
      const row={...r,word:r.word?.trim(),meaning:r.meaning?.trim(),level:r.level?.trim()};
      if(!row.word||row.word.length>120||!row.meaning||row.meaning.length>500||!LEVELS.includes(row.level))throw Error((i+2)+'행의 단어·뜻·난이도를 확인해주세요.');
      for(const [k,max] of [['pos',80],['example',1000],['translation',1000]])if((row[k]||'').length>max)throw Error((i+2)+'행의 설명이 너무 깁니다.');
      let old;
      if(row.id){if(!/^\d+$/.test(String(row.id)))throw Error('id는 숫자여야 합니다.');old=words.find(w=>w.id===Number(row.id));if(!old)throw Error('없는 단어 id: '+row.id);}
      else{const matches=words.filter(w=>norm(w.word)===norm(row.word)&&w.level===row.level);if(matches.length>1)throw Error(row.word+': 중복 항목이 있어 id가 필요합니다.');old=matches[0];}
      if(old&&(old.word!==row.word||old.level!==row.level))throw Error('기존 단어의 철자·난이도는 새 항목으로 추가해주세요.');
      const key=old?'id:'+old.id:norm(row.word)+'|'+row.level;
      if(used.has(key))throw Error('파일 안에 중복 단어가 있습니다: '+row.word);used.add(key);
      if(old){row.id=old.id;row.expected=signature(old);for(const k of ['pos','example','translation'])if(row[k]===undefined)row[k]=old[k]||'';}
      return {...row,action:!old?'추가':signature({...old,...row})===signature(old)?'동일':'수정',before:old?.meaning||''};
    });
  }
  function csv(rows){const heads=['id','word','meaning','level','pos','example','translation'];const quote=s=>'"'+String(s??'').replace(/"/g,'""')+'"';return '\uFEFF'+[heads.join(','),...rows.map(r=>heads.map(h=>quote(/^[=+@-]/.test(String(r[h]??''))?"'"+r[h]:r[h])).join(','))].join('\r\n');}
  const api={LEVELS,esc,norm,signature,canonicalize,unique,progressIndex,recordFor,knowsMeaning,knowsSpelling,remembered,due,summary,shuffle,plan,options,checkEnglish,checkKorean,parseDelimited,previewImport,csv};
  if(typeof module!=='undefined')module.exports=api;else root.WM=api;
})(typeof globalThis!=='undefined'?globalThis:this);
