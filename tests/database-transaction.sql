-- All fixture rows and mutations are rolled back. Serial sequences may advance.
begin;
set local role anon;
do $$
declare
 u uuid:=gen_random_uuid(); round_id uuid:=gen_random_uuid(); w1 integer; w2 integer; w3 integer;
 name text:='__wm_test_'||gen_random_uuid()::text; p jsonb; r jsonb; n integer; secret text; before_count integer;
begin
 insert into public.profiles(id,name,password) values(u,name,'test-only');
 insert into public.words(word,meaning,level) values(name,'첫 뜻','초등기본') returning id into w1;
 insert into public.words(word,meaning,level) values(name,'첫 뜻','중등기본') returning id into w2;
 insert into public.words(word,meaning,level) values(name,'다른 뜻','고등기본') returning id into w3;
 p:=jsonb_build_array(jsonb_build_object('wordId',w1,'type','e2k','correct',true,'requeued',false));
 perform public.wm_save_round_v1(u,'test-only',round_id,'{}',p);
 perform public.wm_save_round_v1(u,'test-only',round_id,'{}',p);
 select count(*) into n from public.rounds where user_id=u;assert n=1,'idempotence failed';
 perform public.wm_save_round_v1(u,'test-only',gen_random_uuid(),'{}',jsonb_build_array(jsonb_build_object('wordId',w2,'type','e2k','correct',true)));
 select learning into r from public.progress where user_id=u and word=name;
 assert (r->w1::text->'e2k'->>'days')::integer=1,'same-day mastery inflation';
 assert not (r ? w2::text),'same-meaning duplicate identity';
 perform public.wm_save_round_v1(u,'test-only',gen_random_uuid(),'{}',jsonb_build_array(jsonb_build_object('wordId',w3,'type','k2e','correct',true)));
 select learning into r from public.progress where user_id=u and word=name;
 assert (r ? w1::text) and (r ? w3::text),'different meaning overwritten';
 perform public.wm_save_round_v1(u,'test-only',gen_random_uuid(),'{}',jsonb_build_array(jsonb_build_object('wordId',w1,'type','k2e','correct',false)));
 select learning into r from public.progress where user_id=u and word=name;
 assert (r->w1::text->'e2k'->>'days')::integer=1,'spelling failure erased meaning';
 begin
   perform public.wm_save_round_v1(u,'wrong-password',gen_random_uuid(),'{}',p);
   raise exception 'TEST failed: wrong password accepted';
 exception when others then
   if sqlerrm like 'TEST failed:%' then raise; end if;
 end;
 select count(*) into before_count from public.rounds where user_id=u;
 begin
   perform public.wm_save_round_v1(u,'test-only',gen_random_uuid(),'{}',p||jsonb_build_array(jsonb_build_object('wordId',w1,'type','invalid','correct',true)));
   raise exception 'TEST failed: invalid answer accepted';
 exception when others then
   if sqlerrm like 'TEST failed:%' then raise; end if;
 end;
 select count(*) into n from public.rounds where user_id=u;assert n=before_count,'invalid round partly saved';
 select learning into p from public.progress where user_id=u and word=name;
 assert p=r,'progress not rolled back with invalid round';
 select value into secret from public.app_settings where key='admin_password';
 perform public.wm_import_words_v1(secret,jsonb_build_array(jsonb_build_object('id',w1,'word',name,'meaning','바뀐 뜻','level','초등기본','example','Original example.')));
 assert (select meaning from public.words where id=w1)='바뀐 뜻','import update failed';
 assert (select count(*) from public.progress where user_id=u)=1,'import deleted progress';
 begin
   perform public.wm_import_words_v1(secret,jsonb_build_array(jsonb_build_object('id',w1,'word',name,'meaning','또 변경','level','초등기본','expected','stale')));
   raise exception 'TEST failed: stale update accepted';
 exception when others then if sqlerrm like 'TEST failed:%' then raise; end if;end;
 begin
   perform public.wm_import_words_v1('wrong-password',jsonb_build_array(jsonb_build_object('word','test','meaning','시험','level','초등기본')));
   raise exception 'TEST failed: unauthenticated import accepted';
 exception when others then if sqlerrm like 'TEST failed:%' then raise; end if;end;
end $$;
select 'Database integration assertions passed; all test rows rolled back.' as verification;
rollback;
