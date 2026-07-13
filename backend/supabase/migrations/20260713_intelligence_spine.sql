-- Canonical Life Directed Intelligence contract.
-- Generated manually because the Supabase CLI is not installed in this checkout.
-- Run through the project's normal migration workflow before enabling DATA_BACKEND=postgres.

alter table public.topics
  add column if not exists owner_user_id uuid references auth.users(id) on delete cascade,
  add column if not exists instruction text,
  add column if not exists intended_outcome text,
  add column if not exists included_concepts_json jsonb default '[]'::jsonb,
  add column if not exists excluded_concepts_json jsonb default '[]'::jsonb,
  add column if not exists entities_json jsonb default '[]'::jsonb,
  add column if not exists locations_json jsonb default '[]'::jsonb,
  add column if not exists languages_json jsonb default '["en"]'::jsonb,
  add column if not exists content_types_json jsonb default '["written","video"]'::jsonb,
  add column if not exists importance_threshold text default 'important',
  add column if not exists notification_policy_json jsonb default '{}'::jsonb,
  add column if not exists search_queries_json jsonb default '[]'::jsonb,
  add column if not exists source_discovery_queries_json jsonb default '[]'::jsonb,
  add column if not exists linked_goals_json jsonb default '[]'::jsonb,
  add column if not exists linked_story_layers_json jsonb default '[]'::jsonb,
  add column if not exists coverage_status text default 'unavailable',
  add column if not exists last_sweep_at timestamptz,
  add column if not exists next_sweep_at timestamptz,
  add column if not exists updated_at timestamptz default now();

alter table public.recommendation_reasons
  add column if not exists payload_json jsonb default '{}'::jsonb,
  add column if not exists story_layer_id text,
  add column if not exists topic_refs_json jsonb default '[]'::jsonb,
  add column if not exists source_refs_json jsonb default '[]'::jsonb,
  add column if not exists why_now text,
  add column if not exists confidence real,
  add column if not exists action_json jsonb,
  add column if not exists updated_at timestamptz default now();

create table if not exists public.user_theory_evidence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  evidence_type text not null,
  subject text not null,
  evidence_json jsonb not null default '{}'::jsonb,
  confidence real not null default 0.5 check (confidence >= 0 and confidence <= 1),
  status text not null default 'active',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.topic_instruction_versions (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.topics(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  instruction text not null,
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);

create table if not exists public.topic_sources (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.topics(id) on delete cascade,
  source_id uuid not null references public.sources(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'suggested',
  source_role text,
  notes text,
  approved_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(topic_id, source_id)
);

create table if not exists public.source_checks (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid references public.topics(id) on delete cascade,
  source_id uuid not null references public.sources(id) on delete cascade,
  status text not null default 'never_checked',
  retrieval_method text,
  last_checked_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  freshness_hours real,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.source_web_claims (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.topics(id) on delete cascade,
  claim_text text not null,
  status text not null default 'uncertain',
  event_time timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.source_web_evidence (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.source_web_claims(id) on delete cascade,
  source_id uuid references public.sources(id) on delete set null,
  relation text not null default 'supporting',
  url text,
  excerpt text,
  confidence real default 0.5 check (confidence >= 0 and confidence <= 1),
  created_at timestamptz default now()
);

create index if not exists idx_topics_owner_updated
  on public.topics (owner_user_id, updated_at desc);
create index if not exists idx_user_theory_evidence_user
  on public.user_theory_evidence (user_id, status, updated_at desc);
create index if not exists idx_topic_instruction_versions_topic
  on public.topic_instruction_versions (topic_id, created_at desc);
create index if not exists idx_topic_sources_topic
  on public.topic_sources (topic_id, status, updated_at desc);
create index if not exists idx_source_checks_source
  on public.source_checks (source_id, updated_at desc);
create index if not exists idx_source_web_claims_topic
  on public.source_web_claims (topic_id, updated_at desc);

alter table public.topics enable row level security;
alter table public.recommendation_reasons enable row level security;
alter table public.user_theory_evidence enable row level security;
alter table public.topic_instruction_versions enable row level security;
alter table public.topic_sources enable row level security;
alter table public.source_checks enable row level security;
alter table public.source_web_claims enable row level security;
alter table public.source_web_evidence enable row level security;

drop policy if exists "topics are readable by their owner or as global topics" on public.topics;
create policy "topics are readable by their owner or as global topics"
  on public.topics for select to authenticated
  using (owner_user_id is null or (select auth.uid()) = owner_user_id);
drop policy if exists "users own their topics" on public.topics;
create policy "users own their topics"
  on public.topics for insert to authenticated
  with check ((select auth.uid()) = owner_user_id);
drop policy if exists "users update their topics" on public.topics;
create policy "users update their topics"
  on public.topics for update to authenticated
  using ((select auth.uid()) = owner_user_id)
  with check ((select auth.uid()) = owner_user_id);
drop policy if exists "users delete their topics" on public.topics;
create policy "users delete their topics"
  on public.topics for delete to authenticated
  using ((select auth.uid()) = owner_user_id);

drop policy if exists "users own theory evidence" on public.user_theory_evidence;
create policy "users own theory evidence"
  on public.user_theory_evidence for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists "users own topic versions" on public.topic_instruction_versions;
create policy "users own topic versions"
  on public.topic_instruction_versions for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists "users own topic sources" on public.topic_sources;
create policy "users own topic sources"
  on public.topic_sources for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists "users own source checks" on public.source_checks;
create policy "users own source checks"
  on public.source_checks for all to authenticated
  using (exists (
    select 1 from public.topics t
    where t.id = topic_id and (t.owner_user_id is null or t.owner_user_id = (select auth.uid()))
  ))
  with check (exists (
    select 1 from public.topics t
    where t.id = topic_id and (t.owner_user_id is null or t.owner_user_id = (select auth.uid()))
  ));
drop policy if exists "users own topic claims" on public.source_web_claims;
create policy "users own topic claims"
  on public.source_web_claims for all to authenticated
  using (exists (
    select 1 from public.topics t
    where t.id = topic_id and (t.owner_user_id is null or t.owner_user_id = (select auth.uid()))
  ))
  with check (exists (
    select 1 from public.topics t
    where t.id = topic_id and (t.owner_user_id is null or t.owner_user_id = (select auth.uid()))
  ));
drop policy if exists "users own claim evidence" on public.source_web_evidence;
create policy "users own claim evidence"
  on public.source_web_evidence for all to authenticated
  using (exists (
    select 1 from public.source_web_claims c
    join public.topics t on t.id = c.topic_id
    where c.id = claim_id and (t.owner_user_id is null or t.owner_user_id = (select auth.uid()))
  ))
  with check (exists (
    select 1 from public.source_web_claims c
    join public.topics t on t.id = c.topic_id
    where c.id = claim_id and (t.owner_user_id is null or t.owner_user_id = (select auth.uid()))
  ));
drop policy if exists "users own recommendation reasons" on public.recommendation_reasons;
create policy "users own recommendation reasons"
  on public.recommendation_reasons for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.user_theory_evidence to authenticated;
grant select, insert, update, delete on public.topic_instruction_versions to authenticated;
grant select, insert, update, delete on public.topic_sources to authenticated;
grant select, insert, update, delete on public.source_checks to authenticated;
grant select, insert, update, delete on public.source_web_claims to authenticated;
grant select, insert, update, delete on public.source_web_evidence to authenticated;
grant select, insert, update, delete on public.recommendation_reasons to authenticated;
