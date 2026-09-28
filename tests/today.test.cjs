const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const C=require('../learning-core_v0.0.1.js');
const source=fs.readFileSync(require.resolve('../app_v0.0.5.js'),'utf8').split('(async()=>{try{if(DEMO)initDemo();')[0];
function app(){
  const events={},elements={app:{addEventListener:(name,fn)=>events[name]=fn}};
  const ctx=vm.createContext({window:{WM:C,addEventListener(){}},document:{getElementById:id=>elements[id]||{}},location:{search:'?demo=1'},URLSearchParams,localStorage:{getItem:()=>null,setItem(){}},crypto:{randomUUID:()=> 'test-round'},setTimeout,clearTimeout});
  vm.runInContext(source,ctx);
  vm.runInContext(`user={id:'test'};words=C.canonicalize([{id:1,word:'apple',meaning:'사과',level:'초등기본'}]);renderQuiz=()=>{};studyScreen=()=>{};`,ctx);
  return {run:code=>vm.runInContext(code,ctx),events};
}
test('today defaults to MCQ even with legacy study history',()=>{
  const a=app();
  a.run("progress=[{word:'apple',level:'초등기본',learning:{}}];today();");
  assert.equal(a.run('quiz.type'),'mcq');
});
for(const type of ['mcq','e2k','k2e','mixed']) test('today respects '+type+' for both review and new words',async()=>{
  for(const review of [true,false]){
    const a=app();
    await a.events.change({target:{id:'home-type',value:type}});
    if(review)a.run("records={'1':{seen:2,meaning:'사과',e2k:{days:3}}};");
    a.run('today();');
    assert.equal(a.run('quiz.settings.questionType'),type);
    if(!review)a.run('startQuiz(quiz.planned,quiz.settings);');
    const actual=a.run('quiz.type');
    if(type==='mixed')assert.ok(['mcq','e2k','k2e'].includes(actual));
    else assert.equal(actual,type);
  }
});
