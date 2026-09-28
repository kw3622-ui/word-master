const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../learning-core_v0.0.1.js');
const source=fs.readFileSync(require.resolve('../app_v0.0.4.js'),'utf8').split('(async()=>{try{if(DEMO)initDemo();')[0];
function app(){
  const events={},storage=new Map(),node={innerHTML:'',focus(){},querySelector(){return {focus(){}}},addEventListener:(name,fn)=>events[name]=fn};
  const ctx=vm.createContext({window:{WM:C,addEventListener(){}},document:{getElementById:()=>node},location:{search:'?demo=1'},URLSearchParams,localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)},crypto:{randomUUID:()=> 'test'},setTimeout,clearTimeout});
  vm.runInContext(source,ctx);
  vm.runInContext("user={id:'one'};words=C.canonicalize([{id:1,word:'apple',meaning:'사과',level:'초등기본'},{id:2,word:'school',meaning:'학교',level:'초등기본'}]);",ctx);
  return {run:code=>vm.runInContext(code,ctx),html:()=>node.innerHTML,events};
}
test('recall hides answer choices and exposes immediate reveal and pronunciation',()=>{
  const a=app();a.run("startQuiz(words,{questionType:'mcq',recallFirst:true,mcqOptionCount:4});");
  assert.match(a.html(),/보기 확인하기/);assert.match(a.html(),/발음 듣기/);
  assert.doesNotMatch(a.html(),/사과|학교|data-action="pick"|id="answer"|data-action="unknown"/);
});
test('revealing is ungraded; response remains MCQ; next question hides choices again',async()=>{
  const a=app();a.run("startQuiz(words,{questionType:'mcq',recallFirst:true,mcqOptionCount:4});");
  await a.run("action('unknown');action('pick','0');");assert.equal(a.run('quiz.results.length'),0);
  await a.run("action('show-options');");assert.match(a.html(),/data-action="pick"/);assert.equal(a.run('quiz.results.length'),0);
  await a.run("action('pick',String(quiz.options.indexOf('사과')));");
  assert.equal(a.run('quiz.results[0].type'),'mcq');assert.equal(a.run('quiz.results[0].correct'),true);
  await a.run("quiz.feedbackReadyAt=0;action('next');");assert.match(a.html(),/보기 확인하기/);assert.doesNotMatch(a.html(),/data-action="pick"/);
});
test('off and free learning show choices immediately',()=>{
  for(const setting of ['false','undefined']){const a=app();a.run(`startQuiz(words,{questionType:'mcq',recallFirst:${setting},mcqOptionCount:4});`);assert.match(a.html(),/data-action="pick"/);assert.doesNotMatch(a.html(),/보기 확인하기/);}
});
test('subjective questions are not gated',()=>{
  for(const type of ['e2k','k2e']){const a=app();a.run(`startQuiz(words,{questionType:'${type}',recallFirst:true,mcqOptionCount:4});`);assert.match(a.html(),/id="answer"/);assert.doesNotMatch(a.html(),/보기 확인하기/);}
});
test('mixed quiz gates only MCQ',()=>{
  for(const n of [0,.4,.8]){const a=app();a.run(`Math.random=()=>${n};startQuiz(words,{questionType:'mixed',recallFirst:true,mcqOptionCount:4});`);assert.equal(a.html().includes('보기 확인하기'),n===0);}
});
test('preference defaults on, is profile scoped and reaches daily quiz',async()=>{
  const a=app();assert.equal(a.run('recallFirst()'),true);
  await a.events.change({target:{id:'home-recall',value:'off'}});assert.equal(a.run('recallFirst()'),false);
  a.run('today();');assert.equal(a.run('quiz.settings.recallFirst'),false);assert.match(a.html(),/사과/);
  a.run("user={id:'two'};");assert.equal(a.run('recallFirst()'),true);
  a.run("user={id:'one'};");assert.equal(a.run('recallFirst()'),false);
});
