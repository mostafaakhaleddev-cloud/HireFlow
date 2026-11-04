-- All browser-facing REST/RPC access is denied. Next validates Auth + current
-- membership, then uses a server-only, narrowly granted backend role.
create extension if not exists pgcrypto with schema extensions;
create extension if not exists btree_gist with schema extensions;
create extension if not exists pg_trgm with schema extensions;
do $$ begin
  if not exists(select 1 from pg_roles where rolname='hireflow_backend') then
    create role hireflow_backend nologin bypassrls;
  end if;
end $$;
grant hireflow_backend to postgres;
grant usage on schema public, extensions to hireflow_backend;

create table public.staff (
  id uuid primary key references auth.users(id),
  display_name text not null check(length(display_name) between 1 and 120),
  role text not null check(role in ('hr','admin')),
  active boolean not null default true,
  calendar_id text,
  created_at timestamptz not null default now()
);
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  job_code text not null unique check(job_code ~ '^JOB-[A-Z0-9]{2,12}-[0-9]{3,6}$'),
  title text not null check(length(title) between 2 and 160),
  description text not null check(length(description) between 10 and 15000),
  required_skills text[] not null default '{}',
  preferred_skills text[] not null default '{}',
  minimum_years numeric(4,1) not null default 0 check(minimum_years between 0 and 60),
  status text not null default 'draft' check(status in ('draft','open','paused','closed')),
  requirements_version integer not null default 1 check(requirements_version>0),
  created_by uuid not null references public.staff(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.uploads (
  id uuid primary key default gen_random_uuid(),
  purpose text not null check(purpose in ('public','gmail')),
  job_id uuid references public.jobs(id),
  object_path text not null unique,
  original_name text not null,
  media_type text not null,
  byte_size integer not null check(byte_size between 1 and 5242880),
  sha256 text not null check(length(sha256)=64),
  scan_status text not null check(scan_status in ('clean','synthetic_unscanned')),
  consumed_at timestamptz,
  expires_at timestamptz not null default now()+interval '30 minutes',
  created_at timestamptz not null default now()
);
create table public.candidates (
  id uuid primary key default gen_random_uuid(),
  normalized_email text not null unique,
  created_at timestamptz not null default now()
);
create table public.applications (
  id uuid primary key default gen_random_uuid(),
  receipt uuid not null unique default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id),
  job_id uuid references public.jobs(id),
  source text not null check(source in ('form','gmail')),
  source_external_id text unique,
  submission_key uuid unique,
  payload_hash text not null,
  submitted_name text not null,
  submitted_email text not null,
  submitted_phone text,
  contact_ambiguous boolean not null default false,
  cv_upload_id uuid not null unique references public.uploads(id),
  privacy_version text,
  consent_at timestamptz,
  provenance jsonb not null default '{}',
  processing_status text not null check(processing_status in ('queued','processing','completed','needs_manual_review','failed_retryable','failed_final')),
  review_status text not null check(review_status in ('needs_job_assignment','awaiting_review','hold','interview_approved','rejected')),
  active_run_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(job_id is not null or (source='gmail' and review_status='needs_job_assignment')),
  check((source='form' and consent_at is not null and privacy_version is not null) or (source='gmail' and consent_at is null and privacy_version is null))
);
create table public.analysis_runs (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  event_id uuid not null unique,
  job_snapshot jsonb not null,
  status text not null default 'queued' check(status in ('queued','processing','completed','needs_manual_review','failed_retryable','failed_final')),
  result jsonb,
  result_hash text,
  attempts integer not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.applications add constraint active_run_fk foreign key(active_run_id) references public.analysis_runs(id) deferrable initially deferred;
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  interviewer_id uuid not null references public.staff(id),
  version integer not null default 1,
  approved_by uuid not null references public.staff(id),
  reason text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index one_valid_invitation on public.invitations(application_id) where revoked_at is null;
create table public.interviewer_slots (
  id uuid primary key default gen_random_uuid(),
  interviewer_id uuid not null references public.staff(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null default 'Africa/Cairo',
  created_at timestamptz not null default now(),
  check(ends_at=starts_at+interval '30 minutes'),
  exclude using gist(interviewer_id with =, tstzrange(starts_at,ends_at,'[)') with &&)
);
create table public.interviews (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  invitation_id uuid not null references public.invitations(id),
  interviewer_id uuid not null references public.staff(id),
  slot_id uuid not null references public.interviewer_slots(id),
  pending_slot_id uuid references public.interviewer_slots(id),
  booking_key uuid not null unique,
  booking_hash text not null,
  receipt uuid not null default gen_random_uuid() unique,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null,
  state text not null check(state in ('calendar_pending','confirmed','reschedule_pending','cancel_pending','cancelled','sync_failed','sync_unknown')),
  schedule_revision integer not null default 1,
  sync_operation text not null check(sync_operation in ('create','reschedule','cancel')),
  sync_event_id uuid not null,
  provider_event_id text not null,
  provider_calendar_id text,
  meet_url text,
  last_result_hash text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index one_active_interview on public.interviews(application_id) where state<>'cancelled';
create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references public.interviews(id) on delete cascade,
  slot_id uuid not null unique references public.interviewer_slots(id),
  interviewer_id uuid not null references public.staff(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  exclude using gist(interviewer_id with =, tstzrange(starts_at,ends_at,'[)') with &&)
);
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  invitation_id uuid references public.invitations(id),
  interview_id uuid references public.interviews(id) on delete cascade,
  schedule_revision integer,
  type text not null check(type in ('invitation','reminder_24h','reminder_1h')),
  dedupe_key text not null unique,
  state text not null default 'pending' check(state in ('pending','sending','sent','failed','unknown','cancelled')),
  attempts integer not null default 0,
  claim_id uuid,
  lease_until timestamptz,
  provider_id text,
  result_hash text,
  sent_at timestamptz,
  safe_error text,
  reconciled_by uuid references public.staff(id),
  created_at timestamptz not null default now()
);
create table public.integration_events (
  id uuid primary key,
  event_type text not null check(event_type in ('application.created','application.analysis_requested','interview.invitation_requested','interview.sync_requested')),
  payload jsonb not null,
  state text not null default 'pending' check(state in ('pending','leased','acknowledged','exhausted')),
  attempts integer not null default 0,
  lease_id uuid,
  lease_until timestamptz,
  available_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  safe_error text,
  created_at timestamptz not null default now()
);
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor text not null,
  action text not null,
  object_id uuid not null,
  request_id uuid not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create table public.rate_limits (
  key text primary key,
  window_start timestamptz not null,
  count integer not null
);
create table public.cleanup_jobs (
  id uuid primary key default gen_random_uuid(),
  object_path text not null unique,
  attempts integer not null default 0,
  done_at timestamptz,
  safe_error text,
  created_at timestamptz not null default now()
);

create index applications_job_date on public.applications(job_id,created_at desc,id desc);
create index applications_processing on public.applications(processing_status,created_at desc);
create index applications_review on public.applications(review_status,created_at desc);
create index applications_name_search on public.applications using gin (submitted_name extensions.gin_trgm_ops);
create index applications_email_search on public.applications using gin (submitted_email extensions.gin_trgm_ops);
create index runs_application on public.analysis_runs(application_id,created_at desc);
create index outbox_ready on public.integration_events(available_at,created_at) where state in ('pending','leased');
create index interviews_due on public.interviews(starts_at) where state='confirmed';
create index notifications_pending on public.notifications(state,created_at);
create index slots_future on public.interviewer_slots(interviewer_id,starts_at);
create index jobs_state on public.jobs(status,created_at desc,id desc);

-- Jobs requirements version and immutable historical snapshot/identity enforcement.
create function public.protect_job() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if new.job_code<>old.job_code then raise exception 'stable_job_code'; end if;
 if (new.description,new.required_skills,new.preferred_skills,new.minimum_years) is distinct from (old.description,old.required_skills,old.preferred_skills,old.minimum_years) then
   new.requirements_version:=old.requirements_version+1;
 else new.requirements_version:=old.requirements_version; end if;
 new.updated_at:=now(); return new;
end $$;
create trigger protect_job before update on public.jobs for each row execute function public.protect_job();
create function public.protect_run() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if (new.application_id,new.event_id,new.job_snapshot) is distinct from (old.application_id,old.event_id,old.job_snapshot) then raise exception 'immutable_analysis_snapshot'; end if;
 return new;
end $$;
create trigger protect_run before update on public.analysis_runs for each row execute function public.protect_run();
create function public.protect_application() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if (new.candidate_id,new.cv_upload_id,new.submitted_name,new.submitted_email,new.submitted_phone,new.source,new.privacy_version,new.consent_at,new.source_external_id,new.submission_key,new.payload_hash) is distinct from (old.candidate_id,old.cv_upload_id,old.submitted_name,old.submitted_email,old.submitted_phone,old.source,old.privacy_version,old.consent_at,old.source_external_id,old.submission_key,old.payload_hash) then raise exception 'immutable_application_snapshot'; end if;
 if old.job_id is not null and new.job_id is distinct from old.job_id then raise exception 'immutable_job_assignment'; end if;
 new.updated_at:=now(); return new;
end $$;
create trigger protect_application before update on public.applications for each row execute function public.protect_application();

-- No exposed function grants or direct table grants to anon/authenticated.
do $$ declare t text; begin
 foreach t in array array['staff','jobs','uploads','candidates','applications','analysis_runs','invitations','interviewer_slots','interviews','reservations','notifications','integration_events','audit_log','rate_limits','cleanup_jobs'] loop
   execute format('alter table public.%I enable row level security',t);
   execute format('revoke all on public.%I from public, anon, authenticated',t);
   execute format('grant select,insert,update,delete on public.%I to hireflow_backend',t);
 end loop;
end $$;
revoke update,delete on public.audit_log from hireflow_backend;
revoke all on function public.protect_job(),public.protect_run(),public.protect_application() from public,anon,authenticated;
alter default privileges in schema public revoke execute on functions from public;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('candidate-cvs','candidate-cvs',false,5242880,array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
 on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
-- Intentionally no Storage policies: only server-side service-role access.
