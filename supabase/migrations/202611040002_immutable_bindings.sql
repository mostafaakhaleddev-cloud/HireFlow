-- Strengthen invariants even if a future server-side caller makes a mistake.
alter table public.analysis_runs add constraint run_application_pair unique(id,application_id);
alter table public.applications add constraint active_run_same_application
 foreign key(active_run_id,id) references public.analysis_runs(id,application_id) deferrable initially deferred;

create function public.protect_upload() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if (new.purpose,new.job_id,new.object_path,new.original_name,new.media_type,new.byte_size,new.sha256,new.scan_status,new.expires_at)
 is distinct from (old.purpose,old.job_id,old.object_path,old.original_name,old.media_type,old.byte_size,old.sha256,old.scan_status,old.expires_at)
 then raise exception 'immutable_verified_upload'; end if;
 if old.consumed_at is not null and new.consumed_at is distinct from old.consumed_at then raise exception 'upload_already_consumed'; end if;
 return new;
end $$;
create trigger protect_upload before update on public.uploads for each row execute function public.protect_upload();
revoke all on function public.protect_upload() from public,anon,authenticated;
