import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { query,transaction,lock,audit } from './db';
import { staffTransaction } from './auth';
import { applicationSchema,intakeSchema,jobSchema,resultSchema,validateRequirementEvidence,type IntegrationEvent,type JobInput } from './contracts';
import { invariant } from './errors';
import { digest } from './signing';

export const jobTransitions:Record<string,string[]>= {draft:['draft','open','closed'],open:['open','paused','closed'],paused:['paused','open','closed'],closed:['closed','open']};
export async function outbox(db:PoolClient,event:IntegrationEvent) {
  await db.query('insert into integration_events(id,event_type,payload) values($1,$2,$3)',[event.event_id,event.event_type,event]);
}
async function startRun(db:PoolClient,app: {id:string;job_id:string;source:'form'|'gmail'},eventType:'application.created'|'application.analysis_requested') {
  const job=(await db.query('select id,job_code,title,description,required_skills,preferred_skills,minimum_years,requirements_version from jobs where id=$1 for share',[app.job_id])).rows[0];
  invariant(job,'JOB_NOT_FOUND','Job not found.',404);
  const id=randomUUID(),eventId=randomUUID();
  await db.query('insert into analysis_runs(id,application_id,event_id,job_snapshot) values($1,$2,$3,$4)',[id,app.id,eventId,job]);
  await db.query("update applications set active_run_id=$2,processing_status='queued' where id=$1",[app.id,id]);
  await outbox(db,{schema_version:1,event_id:eventId,event_type:eventType,application_id:app.id,analysis_run_id:id,job_id:job.id,source:app.source});
  return id;
}
export async function saveJob(actor:string,input:unknown,requestId:string,id?:string) {
  const j=jobSchema.parse(input);
  return staffTransaction(actor,async db=>{
    if(id){
      const old=(await db.query('select * from jobs where id=$1 for update',[id])).rows[0];
      invariant(old,'NOT_FOUND','Job not found.',404);
      invariant(old.job_code===j.job_code,'STABLE_CODE','Job code cannot be changed.');
      invariant(jobTransitions[old.status].includes(j.status),'JOB_TRANSITION','This job status transition is not allowed.');
      await db.query('update jobs set title=$2,description=$3,required_skills=$4,preferred_skills=$5,minimum_years=$6,status=$7 where id=$1',[id,j.title,j.description,j.required_skills,j.preferred_skills,j.minimum_years,j.status]);
    }else{
      id=randomUUID();
      await db.query('insert into jobs(id,job_code,title,description,required_skills,preferred_skills,minimum_years,status,created_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,j.job_code,j.title,j.description,j.required_skills,j.preferred_skills,j.minimum_years,j.status,actor]);
    }
    await audit(db,actor,'job.saved',id,requestId,{status:j.status});return {id};
  });
}
export async function publicJob(code:string) {
  return (await query('select job_code,title,description,required_skills,preferred_skills,minimum_years,status from jobs where job_code=$1',[code])).rows[0];
}
export async function submitApplication(raw:unknown,requestId:string) {
  const p=applicationSchema.parse(raw),hash=digest(JSON.stringify(p));
  return transaction(async db=>{
    await lock(db,'submission:'+p.idempotency_key);
    const existing=(await db.query('select receipt,payload_hash from applications where submission_key=$1',[p.idempotency_key])).rows[0];
    if(existing){invariant(existing.payload_hash===hash,'KEY_REUSED','Submission key was already used with different data.');return {receipt:existing.receipt,status:'received'};}
    const job=(await db.query("select id from jobs where job_code=$1 and status='open' for share",[p.job_code])).rows[0];
    invariant(job,'JOB_UNAVAILABLE','This job is no longer accepting applications.');
    const upload=(await db.query("select * from uploads where id=$1 and purpose='public' and job_id=$2 for update",[p.upload_handle,job.id])).rows[0];
    invariant(upload&&!upload.consumed_at&&new Date(upload.expires_at)>new Date(),'UPLOAD_INVALID','The upload has expired or was already used. Please select the CV again.');
    await db.query('insert into candidates(normalized_email) values($1) on conflict(normalized_email) do nothing',[p.email]);
    const candidate=(await db.query('select id from candidates where normalized_email=$1',[p.email])).rows[0];
    const app=(await db.query(`insert into applications(candidate_id,job_id,source,submission_key,payload_hash,submitted_name,submitted_email,submitted_phone,cv_upload_id,privacy_version,consent_at,processing_status,review_status)
      values($1,$2,'form',$3,$4,$5,$6,$7,$8,$9,now(),'queued','awaiting_review') returning id,receipt,job_id,source`,[candidate.id,job.id,p.idempotency_key,hash,p.name,p.email,p.phone||null,upload.id,p.privacy_version])).rows[0];
    await db.query('update uploads set consumed_at=now() where id=$1',[upload.id]);
    await startRun(db,app,'application.created');
    await audit(db,'public','application.received',app.id,requestId,{source:'form'});
    return {receipt:app.receipt,status:'received'};
  });
}
export async function gmailIntake(raw:unknown,requestId:string) {
  const p=intakeSchema.parse(raw),key=digest(JSON.stringify([p.mailbox_id,p.message_id,p.attachment_id])),hash=digest(JSON.stringify(p));
  return transaction(async db=>{
    await lock(db,'gmail:'+key);
    const old=(await db.query('select id,payload_hash from applications where source_external_id=$1',[key])).rows[0];
    if(old){invariant(old.payload_hash===hash,'KEY_REUSED','Attachment key was reused with different metadata.');return {application_id:old.id,duplicate:true};}
    const upload=(await db.query("select * from uploads where id=$1 and purpose='gmail' for update",[p.upload_handle])).rows[0];
    invariant(upload&&!upload.consumed_at&&new Date(upload.expires_at)>new Date(),'UPLOAD_INVALID','Invalid attachment handle.');
    const codes=[...new Set([...p.subject.matchAll(/\[(JOB-[A-Z0-9]+-[0-9]+)\]/g)].map(m=>m[1]))];
    const job=codes.length===1?(await db.query("select id from jobs where job_code=$1 and status='open' for share",[codes[0]])).rows[0]:undefined;
    await db.query('insert into candidates(normalized_email) values($1) on conflict do nothing',[p.candidate_email.toLowerCase()]);
    const candidate=(await db.query('select id from candidates where normalized_email=$1',[p.candidate_email.toLowerCase()])).rows[0];
    const app=(await db.query(`insert into applications(candidate_id,job_id,source,source_external_id,payload_hash,submitted_name,submitted_email,contact_ambiguous,cv_upload_id,processing_status,review_status,provenance)
      values($1,$2,'gmail',$3,$4,$5,$6,$7,$8,'needs_manual_review',$9,$10) returning id,job_id,source`,[candidate.id,job?.id||null,key,hash,p.candidate_name,p.candidate_email,p.contact_ambiguous,upload.id,job?'awaiting_review':'needs_job_assignment',{mailbox_id:p.mailbox_id,message_id:p.message_id,attachment_id:p.attachment_id,code_resolution:codes.length===1?'exact_or_unusable':'missing_or_ambiguous'}])).rows[0];
    await db.query('update uploads set consumed_at=now() where id=$1',[upload.id]);
    if(job&&!p.contact_ambiguous)await startRun(db,app,'application.created');
    await audit(db,'wf01','gmail.intake',app.id,requestId,{matched:!!job,contact_ambiguous:p.contact_ambiguous});
    return {application_id:app.id,duplicate:false};
  });
}
export async function applicationAction(actor:string,id:string,action:'assign-job'|'retry-analysis'|'reanalyse',raw:unknown,requestId:string) {
  const p=action==='assign-job'?z.object({job_id:z.uuid()}).strict().parse(raw):z.object({}).strict().parse(raw);
  return staffTransaction(actor,async db=>{
    const app=(await db.query('select * from applications where id=$1 for update',[id])).rows[0];
    invariant(app,'NOT_FOUND','Application not found.',404);
    invariant(!app.contact_ambiguous,'MANUAL_CONTACT_REVIEW','Ambiguous email contact requires a separately verified new application before analysis or invitation.');
    if(action==='assign-job'){
      invariant(!app.job_id&&app.review_status==='needs_job_assignment','ALREADY_ASSIGNED','Application is already assigned.');
      const jobId=(p as {job_id:string}).job_id;
      const job=(await db.query("select id from jobs where id=$1 and status='open' for share",[jobId])).rows[0];
      invariant(job,'JOB_UNAVAILABLE','Choose an open job.');
      await db.query("update applications set job_id=$2,review_status='awaiting_review' where id=$1",[id,jobId]);app.job_id=jobId;
    }
    invariant(app.job_id,'JOB_REQUIRED','Assign a job before requesting analysis.');
    if(action==='retry-analysis'){
      invariant(app.processing_status==='failed_retryable','NOT_RETRYABLE','Only a retryable analysis failure can be retried.');
      const run=(await db.query('select * from analysis_runs where id=$1 for update',[app.active_run_id])).rows[0];
      await db.query("update analysis_runs set status='queued',result=null,result_hash=null,started_at=null,completed_at=null where id=$1",[run.id]);
      await db.query("update applications set processing_status='queued' where id=$1",[id]);
      await db.query("update integration_events set state='pending',available_at=now(),attempts=0,lease_id=null,lease_until=null where id=$1",[run.event_id]);
    }else{
      invariant(action==='assign-job'||!['queued','processing'].includes(app.processing_status),'RUN_ACTIVE','Wait for the active analysis before requesting reanalysis.');
      await startRun(db,app,'application.analysis_requested');
    }
    await audit(db,actor,'application.'+action,id,requestId);return {status:'queued'};
  });
}
export async function analysisContext(id:string,runId:string) {
  return transaction(async db=>{
    const run=(await db.query(`select r.*,a.cv_upload_id,a.active_run_id from analysis_runs r join applications a on a.id=r.application_id where r.id=$1 and r.application_id=$2 for update of r`,[runId,id])).rows[0];
    invariant(run&&run.active_run_id===runId,'RUN_SCOPE','Analysis run is not active for this application.',409);
    if(run.status==='queued'){
      await db.query("update analysis_runs set status='processing',started_at=now(),attempts=attempts+1 where id=$1",[runId]);
      await db.query("update applications set processing_status='processing' where id=$1",[id]);
    }
    return run;
  });
}
export async function analysisResult(id:string,raw:unknown,requestId:string) {
  const p=resultSchema.parse(raw),hash=digest(JSON.stringify(p));
  invariant(p.application_id===id,'APPLICATION_SCOPE','Application ID does not match the route.',403);
  return transaction(async db=>{
    const app=(await db.query('select * from applications where id=$1 for update',[id])).rows[0];
    const run=(await db.query('select * from analysis_runs where id=$1 and application_id=$2 for update',[p.analysis_run_id,id])).rows[0];
    invariant(app&&run&&run.event_id===p.event_id,'RUN_SCOPE','Run or event does not belong to this application.',403);
    invariant(app.active_run_id===run.id,'STALE_RUN','A later analysis run is already active.');
    invariant(run.job_snapshot.requirements_version===p.requirements_version,'VERSION_MISMATCH','Requirements version does not match the saved snapshot.');
    if(run.result_hash){invariant(run.result_hash===hash,'RESULT_CONFLICT','This run already has a different result.');return {status:'accepted',duplicate:true};}
    invariant(['queued','processing'].includes(run.status),'RUN_STATE','Run cannot accept a new result.');
    if(p.analysis)invariant(validateRequirementEvidence(p.analysis,run.job_snapshot),'INVALID_EVIDENCE','Evidence must cover each snapshot requirement exactly once.',400);
    await db.query('update analysis_runs set status=$2,result=$3,result_hash=$4,completed_at=now() where id=$1',[run.id,p.outcome,p,hash]);
    await db.query('update applications set processing_status=$2 where id=$1',[id,p.outcome]);
    await audit(db,'wf01','analysis.result',id,requestId,{run_id:run.id,outcome:p.outcome});
    return {status:'accepted',duplicate:false};
  });
}
export async function jobsList(status?:string,page=1) {
  const params:unknown[]=[];let where='';
  if(status&&['draft','open','paused','closed'].includes(status)){params.push(status);where='where j.status=$1';}
  const count=(await query('select status,count(*)::int as count from jobs group by status')).rows;
  params.push((Math.max(1,page)-1)*25);
  const {rows}=await query(`select j.*,coalesce(c.count,0)::int as application_count from jobs j left join (select job_id,count(*) as count from applications group by job_id) c on c.job_id=j.id ${where} order by j.created_at desc,j.id desc limit 25 offset $${params.length}`,params);
  return {jobs:rows,counts:count};
}
export async function candidatesList(filters:Record<string,string|undefined>) {
  const values:unknown[]=[],where:string[]=[];
  const add=(sql:string,value:unknown)=>{values.push(value);where.push(sql.replace('?',`$${values.length}`));};
  if(filters.q){values.push('%'+filters.q.slice(0,120).replace(/[%_\\]/g,'\\$&')+'%');where.push(`(a.submitted_name ilike $${values.length} or a.submitted_email ilike $${values.length})`);}
  if(filters.job&&z.uuid().safeParse(filters.job).success)add('a.job_id=?',filters.job);
  if(['form','gmail'].includes(filters.source||''))add('a.source=?',filters.source);
  if(['queued','processing','completed','needs_manual_review','failed_retryable','failed_final'].includes(filters.processing||''))add('a.processing_status=?',filters.processing);
  if(['needs_job_assignment','awaiting_review','hold','interview_approved','rejected'].includes(filters.review||''))add('a.review_status=?',filters.review);
  const clause=where.length?'where '+where.join(' and '):'';
  const count=(await query(`select count(*)::int as count from applications a ${clause}`,values)).rows[0].count;
  const page=Math.max(1,Math.min(100000,Number(filters.page)||1));values.push((page-1)*25);
  const {rows}=await query(`select a.id,a.submitted_name,a.submitted_email,a.source,a.processing_status,a.review_status,a.created_at,j.title as job_title,j.job_code from applications a left join jobs j on j.id=a.job_id ${clause} order by a.created_at desc,a.id desc limit 25 offset $${values.length}`,values);
  return {applications:rows,count,page};
}
export type { JobInput };
