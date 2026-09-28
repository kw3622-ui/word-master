-- Additive upgrade: legacy profiles, notebook, rounds and streaks are preserved.
-- Uses existing table permissions (legacy shared-family access model).
-- No SECURITY DEFINER or new exposed tables.
alter table public.words add column if not exists pos text not null default '';
alter table public.words add column if not exists example text not null default '';
alter table public.words add column if not exists translation text not null default '';
alter table public.progress add column if not exists learning jsonb not null default '{}'::jsonb;
alter table public.rounds add column if not exists client_round_id uuid;
alter table public.rounds add column if not exists answer_details jsonb;
create unique index if not exists rounds_client_round_id_unique on public.rounds(client_round_id) where client_round_id is not null;

create or replace function public.wm_save_round_v1(p_user uuid, p_password text, p_round uuid, p_settings jsonb, p_results jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  a jsonb; w public.words%rowtype; c public.words%rowtype; pg public.progress%rowtype;
  rec jsonb; skill jsonb; typ text; ok boolean; stage integer; days integer;
  day_text text := (now() at time zone 'Asia/Seoul')::date::text;
  delay_days integer; nb public.notebook%rowtype; graduates text[] := '{}';
  total integer; first_correct integer; wrongs text; result_id integer;
begin
  if p_round is null or p_user is null then raise exception '회차와 프로필 정보가 필요합니다.'; end if;
  perform 1 from public.profiles where id=p_user and password=p_password for update;
  if not found then raise exception '프로필 인증이 만료됐습니다. 다시 로그인해주세요.'; end if;
  if exists(select 1 from public.rounds where client_round_id=p_round and user_id<>p_user) then raise exception '잘못된 회차입니다.'; end if;
  if exists(select 1 from public.rounds where client_round_id=p_round) then return jsonb_build_object('saved',true,'duplicate',true); end if;
  if jsonb_typeof(p_results) is distinct from 'array' or jsonb_array_length(p_results) not between 1 and 20000 then raise exception '저장할 답안이 올바르지 않습니다.'; end if;
  for a in select value from jsonb_array_elements(p_results) loop
    select * into w from public.words where id=(a->>'wordId')::integer;
    if not found then raise exception '삭제되었거나 없는 단어입니다.'; end if;
    typ:=a->>'type';
    if typ is null or typ not in ('mcq','e2k','k2e') or jsonb_typeof(a->'correct') is distinct from 'boolean' then raise exception '잘못된 채점 결과입니다.'; end if;
    ok:=(a->>'correct')::boolean;
    select * into c from public.words where lower(btrim(word))=lower(btrim(w.word)) and btrim(meaning)=btrim(w.meaning) order by id limit 1;
    insert into public.progress(user_id,word,level) values(p_user,c.word,c.level) on conflict(user_id,word) do nothing;
    select * into pg from public.progress where user_id=p_user and word=c.word for update;
    rec:=coalesce(pg.learning->c.id::text,'{}'::jsonb);
    if rec->>'meaning' is distinct from c.meaning then rec:='{}'::jsonb; end if;
    skill:=coalesce(rec->typ,'{}'::jsonb);
    days:=coalesce((skill->>'days')::integer,0);
    stage:=coalesce((rec->>'stage')::integer,0);
    if ok then
      if skill->>'last_day' is distinct from day_text then days:=least(days+1,10000); end if;
      skill:=skill||jsonb_build_object('days',days,'last_day',day_text);
      if rec->>'success_day' is distinct from day_text then stage:=least(stage+1,5); end if;
      rec:=rec||jsonb_build_object('success_day',day_text);
      delay_days:=(array[1,3,7,14,30])[greatest(stage,1)];
    else
      -- A wrong spelling answer only resets spelling, not meaning recall.
      skill:=skill||jsonb_build_object('days',0,'last_day',day_text);
      stage:=0; delay_days:=1;
      rec:=rec||jsonb_build_object('success_day',day_text);
    end if;
    rec:=rec||jsonb_build_object('meaning',c.meaning,'seen',coalesce((rec->>'seen')::integer,0)+1,
      'stage',stage,'last_review',now(),'due_at',now()+make_interval(days=>delay_days),typ,skill);
    update public.progress set learning=jsonb_set(learning,array[c.id::text],rec,true),last_answered=now() where id=pg.id;
    -- Retain the original notebook semantics for existing families.
    select * into nb from public.notebook where user_id=p_user and word=w.word for update;
    if ok then
      if found then
        if nb.correct_streak+1>=2 then
          delete from public.notebook where id=nb.id;
          graduates:=array_append(graduates,w.word);
        else update public.notebook set correct_streak=correct_streak+1 where id=nb.id; end if;
      end if;
    else
      insert into public.notebook(user_id,word,wrong_count,correct_streak,last_wrong_at) values(p_user,w.word,1,0,now())
      on conflict(user_id,word) do update set wrong_count=public.notebook.wrong_count+1,correct_streak=0,last_wrong_at=now();
    end if;
  end loop;
  select count(distinct (x->>'wordId')),
    count(*) filter(where (x->>'correct')::boolean and not coalesce((x->>'requeued')::boolean,false))
  into total, first_correct from jsonb_array_elements(p_results) x;
  select string_agg(distinct ww.word,', ') into wrongs from jsonb_array_elements(p_results) x join public.words ww on ww.id=(x->>'wordId')::integer where not (x->>'correct')::boolean;
  insert into public.rounds(user_id,question_type,spell_direction,mcq_option_count,total_words,correct_first_try,wrong_words,mastered_words,levels,client_round_id,answer_details)
  values(p_user,coalesce(p_settings->>'questionType','mixed'),coalesce(p_settings->>'spellDirection','mixed'),coalesce((p_settings->>'mcqOptionCount')::integer,4),total,first_correct,coalesce(wrongs,''),array_to_string(graduates,', '),coalesce(p_settings->>'levels',''),p_round,p_results)
  returning id into result_id;
  return jsonb_build_object('saved',true,'id',result_id,'mastered',graduates);
end $$;
revoke all on function public.wm_save_round_v1(uuid,text,uuid,jsonb,jsonb) from public;
grant execute on function public.wm_save_round_v1(uuid,text,uuid,jsonb,jsonb) to anon,authenticated;

create or replace function public.wm_import_words_v1(p_password text,p_rows jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r jsonb; wid integer; existing public.words%rowtype; adds integer:=0; edits integer:=0; unchanged integer:=0; cnt integer;
begin
  perform 1 from public.app_settings where key='admin_password' and value=p_password for update;
  if not found then raise exception '관리자 비밀번호를 확인해주세요.'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 2000 then raise exception '한 번에 1~2,000개를 등록해주세요.'; end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    if length(btrim(coalesce(r->>'word',''))) not between 1 and 120 or length(btrim(coalesce(r->>'meaning',''))) not between 1 and 500 then raise exception '단어 또는 뜻이 올바르지 않습니다.'; end if;
    if coalesce(r->>'level','') not in ('초등기본','초등심화','중등기본','중등심화','고등기본','고등심화') then raise exception '난이도를 확인해주세요.'; end if;
    if length(coalesce(r->>'pos',''))>80 or length(coalesce(r->>'example',''))>1000 or length(coalesce(r->>'translation',''))>1000 then raise exception '설명 또는 예문이 너무 깁니다.'; end if;
    wid:=nullif(r->>'id','')::integer;
    if wid is null then
      select count(*),min(id) into cnt,wid from public.words where lower(btrim(word))=lower(btrim(r->>'word')) and level=r->>'level';
      if cnt>1 then raise exception '같은 단어가 여러 개입니다. 내보내기 파일의 id로 수정해주세요: %',r->>'word'; end if;
    end if;
    if wid is not null then
      select * into existing from public.words where id=wid for update;
      if not found then raise exception '없는 단어 id입니다.'; end if;
      if r ? 'expected' and (r->>'expected') is distinct from (existing.word||chr(9)||existing.meaning||chr(9)||existing.level||chr(9)||existing.pos||chr(9)||existing.example||chr(9)||existing.translation) then raise exception '미리보기 이후 단어가 변경됐습니다. 다시 미리보기 해주세요.'; end if;
      if existing.word<>btrim(r->>'word') or existing.level<>r->>'level' then raise exception '기존 단어의 철자와 난이도는 바꾸지 않고 새 항목으로 추가해주세요.'; end if;
      if existing.meaning=btrim(r->>'meaning') and existing.pos=coalesce(r->>'pos',existing.pos) and existing.example=coalesce(r->>'example',existing.example) and existing.translation=coalesce(r->>'translation',existing.translation) then unchanged:=unchanged+1;
      else
        update public.words set meaning=btrim(r->>'meaning'),pos=coalesce(r->>'pos',pos),example=coalesce(r->>'example',example),translation=coalesce(r->>'translation',translation) where id=wid;
        edits:=edits+1;
      end if;
    else
      insert into public.words(word,meaning,level,pos,example,translation) values(btrim(r->>'word'),btrim(r->>'meaning'),r->>'level',coalesce(r->>'pos',''),coalesce(r->>'example',''),coalesce(r->>'translation',''));
      adds:=adds+1;
    end if;
  end loop;
  return jsonb_build_object('added',adds,'updated',edits,'unchanged',unchanged);
end $$;
revoke all on function public.wm_import_words_v1(text,jsonb) from public;
grant execute on function public.wm_import_words_v1(text,jsonb) to anon,authenticated;
