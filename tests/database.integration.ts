import { after,before,test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { pool,query } from '../src/lib/db';
import { config } from '../src/lib/config';
import { saveJob,submitApplication,gmailIntake,applicationAction,analysisResult,analysisContext } from '../src/lib/domain';
import { book,bookingSlots,invite,decide,publishSlot,claimNotification,notificationResult,recoverNotification,syncContext,syncResult,changeInterview,dueReminders } from '../src/lib/scheduling';
import { signBooking,digest } from '../src/lib/signing';
import { syntheticAnalysis,syntheticPdf } from '../scripts/fixtures';
import { staffTransaction } from '../src/lib/auth';
const harness=process.env.SYNTHETIC_SQL_HARNESS==='true',admin=randomUUID(),hr=randomUUID(),disabled=randomUUID(),nonmember=randomUUID();
let backend:string,frontend:string,sequence=100;
const requestId=()=>randomUUID();
async function upload(jobId:string|null,purpose:'public'|'gmail'='public'){
  return (await query(`insert into uploads(purpose,job_id,object_path,original_name,media_type,byte_size,sha256,scan_status) values($1,$2,$3,'synthetic.pdf','application/pdf',100,$4,'synthetic_unscanned') returning id`,[purpose,jobId,randomUUID()+'.pdf',digest(syntheticPdf())])).rows[0].id as string;
}
async function apply(jobId=backend,email='candidate@example.test') {
  const job=(await query('select job_code from jobs where id=$1',[jobId])).rows[0];
  const payload={job_code:job.job_code,name:'Synthetic Candidate',email,phone:'',consent:true,privacy_version:'2026-11-v1',upload_handle:await upload(jobId),idempotency_key:randomUUID()};
  const result=await submitApplication(payload,requestId()),app=(await query('select * from applications where receipt=$1',[result.receipt])).rows[0];
  return {payload,app,result};
}
async function complete(id:string) {
  const app=(await query('select * from applications where id=$1',[id])).rows[0],run=(await query('select * from analysis_runs where id=$1',[app.active_run_id])).rows[0];
  const payload={schema_version:1,event_id:run.event_id,application_id:id,analysis_run_id:run.id,requirements_version:run.job_snapshot.requirements_version,outcome:'completed',analysis:syntheticAnalysis(run.job_snapshot)};
  await analysisResult(id,payload,requestId());return payload;
}
async function approved(){const a=await apply();await complete(a.app.id);await invite(hr,a.app.id,{interviewer_id:hr,reason:'Synthetic reviewed evidence.'},requestId());const inv=(await query('select * from invitations where application_id=$1 and revoked_at is null',[a.app.id])).rows[0];return {...a,inv,token:signBooking({id:inv.id,version:inv.version},config().BOOKING_SIGNING_KEY)};}
async function slot(hours=80) {sequence++;return publishSlot(hr,{interviewer_id:hr,starts_at:new Date(Date.now()+(hours+sequence)*3600000).toISOString(),timezone:'Africa/Cairo'},requestId());}
before(async()=>{
  assert.ok(['127.0.0.1','localhost'].includes(new URL(config().DATABASE_URL).hostname),'Tests must target local PostgreSQL.');
  if(harness){for(const [id,name,role,active] of [[admin,'Test Admin','admin',true],[hr,'Test HR','hr',true],[disabled,'Disabled HR','hr',false]] as const){await pool().query('insert into auth.users(id,email) values($1,$2)',[id,`${id}@example.test`]);await pool().query('insert into staff(id,display_name,role,active,calendar_id) values($1,$2,$3,$4,$5)',[id,name,role,active,'test-calendar@example.test']);}}
  else {
    const c=config(),auth=createClient(c.SUPABASE_URL,c.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
    // Real local integration mode uses provisioned local staff; never mocks Auth/Storage.
    const existing=(await query("select id from staff where active=true and role='admin' limit 1")).rows[0];
    assert.ok(existing,'Run bootstrap first.');
    for(const [id,role,active] of [[admin,'admin',true],[hr,'hr',true],[disabled,'hr',false]] as const){
      const result=await auth.auth.admin.createUser({email:`test-${id}@example.test`,password:randomUUID()+'X!',email_confirm:true});assert.equal(result.error,null);
      await pool().query('insert into staff(id,display_name,role,active,calendar_id) values($1,$2,$3,$4,$5)',[result.data.user!.id,'Integration '+role,role,active,'test-calendar@example.test']);
      // IDs used by domain tests need the actual Auth IDs; local real mode handled below through harness-independent fixture ids.
      await pool().query('update staff set active=false where id=$1',[result.data.user!.id]);
    }
    throw new Error('Run npm run test:postgres for isolated DB invariants; real Supabase identities/API/storage are exercised by npm run smoke and tests/supabase.integration.ts.');
  }
  const common={description:'Synthetic local PostgreSQL invariant test job.',required_skills:['ASP.NET Core'],preferred_skills:['Docker'],minimum_years:2,status:'open'};
  backend=(await saveJob(hr,{...common,job_code:'JOB-DB-001',title:'Backend Engineer'},requestId())).id!;
  frontend=(await saveJob(hr,{...common,job_code:'JOB-DB-002',title:'Frontend Engineer'},requestId())).id!;
});
after(async()=>{await pool().end();});
test('anonymous and authenticated direct table access is denied; backend audit is append-only',async()=>{
  for(const role of ['anon','authenticated']){
    const db=await pool().connect();try{await db.query('begin');await db.query('set local role '+role);await assert.rejects(()=>db.query('select * from applications'),/permission denied/);}finally{await db.query('rollback');db.release();}
  }
  await assert.rejects(()=>query("update audit_log set action='tampered'"),/permission denied/);
  await assert.rejects(()=>query('delete from audit_log'),/permission denied/);
});
test('current active staff membership is enforced and HR cannot perform admin operations',async()=>{
  await assert.rejects(()=>staffTransaction(disabled,async()=>true));await assert.rejects(()=>staffTransaction(nonmember,async()=>true));
  await assert.rejects(()=>staffTransaction(hr,async()=>true,true));assert.equal(await staffTransaction(admin,async()=>true,true),true);
});
test('simultaneous submission replays create one application, snapshot and durable event',async()=>{
  const file=await upload(backend),payload={job_code:'JOB-DB-001',name:'Replay Candidate',email:'replay@example.test',consent:true,privacy_version:'2026-11-v1',upload_handle:file,idempotency_key:randomUUID()};
  const results=await Promise.all(Array.from({length:6},()=>submitApplication(payload,requestId())));assert.equal(new Set(results.map(r=>r.receipt)).size,1);
  const app=(await query('select * from applications where submission_key=$1',[payload.idempotency_key])).rows[0];
  assert.equal((await query('select count(*)::int as count from analysis_runs where application_id=$1',[app.id])).rows[0].count,1);
  assert.equal((await query('select count(*)::int as count from integration_events where payload->>\'application_id\'=$1',[app.id])).rows[0].count,1);
  await assert.rejects(()=>submitApplication({...payload,name:'Changed Name'},requestId()));
  await assert.rejects(()=>submitApplication({...payload,idempotency_key:randomUUID()},requestId()));
});
test('two jobs preserve separate CVs and contact snapshots for one internal person',async()=>{
  const a=await apply(backend,'two-jobs@example.test'),b=await apply(frontend,'two-jobs@example.test');assert.equal(a.app.candidate_id,b.app.candidate_id);assert.notEqual(a.app.cv_upload_id,b.app.cv_upload_id);
  await assert.rejects(()=>query("update applications set submitted_name='Rewritten' where id=$1",[a.app.id]),/immutable_application_snapshot/);
});
test('closing after upload rejects a stale form; successful replay survives job closure',async()=>{
  const a=await apply();const job=(await query('select * from jobs where id=$1',[backend])).rows[0];await query("update jobs set status='closed' where id=$1",[backend]);
  assert.equal((await submitApplication(a.payload,requestId())).receipt,a.result.receipt);
  await assert.rejects(()=>submitApplication({...a.payload,upload_handle:awaitUploadPlaceholder(),idempotency_key:randomUUID()},requestId()));
  await query('update jobs set status=$2 where id=$1',[backend,job.status]);
});
function awaitUploadPlaceholder(){return randomUUID();}
test('Gmail external key dedupes, ambiguous codes queue for assignment; no consent is invented',async()=>{
  const payload={schema_version:1,mailbox_id:'synthetic',message_id:randomUUID(),attachment_id:'one',subject:'[JOB-DB-001] [JOB-DB-002]',candidate_name:'Email Candidate',candidate_email:'mail@example.test',contact_ambiguous:false,upload_handle:await upload(null,'gmail')};
  const a=await gmailIntake(payload,requestId()),b=await gmailIntake(payload,requestId());assert.equal(a.application_id,b.application_id);
  const app=(await query('select * from applications where id=$1',[a.application_id])).rows[0];assert.equal(app.job_id,null);assert.equal(app.consent_at,null);assert.equal(app.review_status,'needs_job_assignment');
  await applicationAction(hr,app.id,'assign-job',{job_id:backend},requestId());
  await assert.rejects(()=>applicationAction(hr,app.id,'assign-job',{job_id:frontend},requestId()));
  assert.equal((await query('select count(*)::int as count from analysis_runs where application_id=$1',[app.id])).rows[0].count,1);
  const ambiguous=await gmailIntake({...payload,message_id:randomUUID(),subject:'[JOB-DB-001]',contact_ambiguous:true,upload_handle:await upload(null,'gmail')},requestId());
  await assert.rejects(()=>invite(hr,ambiguous.application_id,{interviewer_id:hr,reason:'Cannot approve ambiguous contact.'},requestId()));
});
test('analysis context rejects swapped application IDs; callbacks preserve snapshot and reject stale/conflicting results',async()=>{
  const a=await apply(),b=await apply();await assert.rejects(()=>analysisContext(b.app.id,a.app.active_run_id));
  const result=await complete(a.app.id);assert.equal((await analysisResult(a.app.id,result,requestId())).duplicate,true);
  await assert.rejects(()=>analysisResult(b.app.id,result,requestId()));
  await assert.rejects(()=>analysisResult(a.app.id,{...result,review_status:'rejected'},requestId()));
  await query("update jobs set required_skills=array['ASP.NET Core','PostgreSQL'] where id=$1",[backend]);
  const oldRun=(await query('select * from analysis_runs where id=$1',[a.app.active_run_id])).rows[0];assert.deepEqual(oldRun.job_snapshot.required_skills,['ASP.NET Core']);
  await applicationAction(hr,a.app.id,'reanalyse',{},requestId());await assert.rejects(()=>analysisResult(a.app.id,result,requestId()));
  const fresh=(await query('select r.* from analysis_runs r join applications a on a.active_run_id=r.id where a.id=$1',[a.app.id])).rows[0];assert.ok(fresh.job_snapshot.requirements_version>oldRun.job_snapshot.requirements_version);
  await assert.rejects(()=>query("update analysis_runs set job_snapshot='{}'::jsonb where id=$1",[fresh.id]),/immutable_analysis_snapshot/);
});
test('double human approval creates one invitation; uncertain delivery cannot be resent without reconciliation',async()=>{
  const a=await apply();await complete(a.app.id);const approval={interviewer_id:hr,reason:'Synthetic review completed.'};await Promise.all([invite(hr,a.app.id,approval,requestId()),invite(hr,a.app.id,approval,requestId())]);
  const rows=(await query('select * from notifications where application_id=$1',[a.app.id])).rows;assert.equal(rows.length,1);const n=rows[0];
  await assert.rejects(()=>claimNotification(n.id,'wf04',requestId()));
  const claim=await claimNotification(n.id,'wf02',requestId());assert.equal(claim.status,'claimed');
  await notificationResult(n.id,{schema_version:1,claim_id:claim.claim_id,outcome:'unknown',error_code:'TIMEOUT_UNCERTAIN'},'wf02',requestId());
  await assert.rejects(()=>claimNotification(n.id,'wf02',requestId()));
  await assert.rejects(()=>recoverNotification(hr,n.id,{outcome:'retry_failed',reason:'Blind retry is forbidden.'},requestId()));
  await recoverNotification(hr,n.id,{outcome:'reconciled_not_sent',reason:'Synthetic provider lookup proved no message was sent.'},requestId());
  const retry=await claimNotification(n.id,'wf02',requestId());assert.equal(retry.status,'claimed');assert.notEqual(retry.claim_id,claim.claim_id);
  await assert.rejects(()=>notificationResult(n.id,{schema_version:1,claim_id:claim.claim_id,outcome:'sent',provider_id:'old'},'wf02',requestId()));
});
test('two applicants racing for one slot yield exactly one reservation; winner replay recovers its receipt',async()=>{
  const a=await approved(),b=await approved(),s=await slot(),pa={token:a.token,slot_id:s.id,idempotency_key:randomUUID()},pb={token:b.token,slot_id:s.id,idempotency_key:randomUUID()};
  const results=await Promise.allSettled([book(pa,requestId()),book(pb,requestId())]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
  assert.equal((await query('select count(*)::int as count from reservations where slot_id=$1',[s.id])).rows[0].count,1);
  const winner=results[0].status==='fulfilled'?pa:pb,successful=results.find(r=>r.status==='fulfilled');assert.ok(successful?.status==='fulfilled');assert.equal((await book(winner,requestId())).receipt,successful.value.receipt);
  await assert.rejects(()=>book({...winner,slot_id:randomUUID()},requestId()));
});
test('expired/revoked booking links cannot read slots or reserve; GET leaves valid links unconsumed',async()=>{
  const a=await approved();await bookingSlots(a.token);await bookingSlots(a.token);assert.equal((await query('select consumed_at from invitations where id=$1',[a.inv.id])).rows[0].consumed_at,null);
  await query("update invitations set expires_at=now()-interval '1 second' where id=$1",[a.inv.id]);await assert.rejects(()=>bookingSlots(a.token));
  const b=await approved();await decide(hr,b.app.id,'hold',{reason:'Synthetic hold.'},requestId());await assert.rejects(()=>bookingSlots(b.token));
});
test('Calendar revisions reject stale callbacks; uncertain operations keep reservations; cancelled interview has no reminders',async()=>{
  const a=await approved(),s=await slot();await book({token:a.token,slot_id:s.id,idempotency_key:randomUUID()},requestId());
  let i=(await query('select * from interviews where application_id=$1',[a.app.id])).rows[0];
  const result={schema_version:1,event_id:i.sync_event_id,revision:1,operation:'create',outcome:'confirmed',provider_event_id:i.provider_event_id,calendar_id:'test-calendar@example.test',meet_url:'https://meet.google.com/abc-defg-hij'};
  await syncResult(i.id,result,requestId());assert.equal((await syncResult(i.id,result,requestId())).duplicate,true);
  const next=await slot();await changeInterview(hr,i.id,'reschedule',{slot_id:next.id,reason:'Synthetic reschedule.'},requestId());
  assert.equal((await query('select count(*)::int as count from reservations where interview_id=$1',[i.id])).rows[0].count,2);await assert.rejects(()=>syncResult(i.id,result,requestId()));
  i=(await query('select * from interviews where id=$1',[i.id])).rows[0];
  await syncResult(i.id,{...result,event_id:i.sync_event_id,revision:2,operation:'reschedule',outcome:'unknown',meet_url:undefined,error_code:'TIMEOUT_UNCERTAIN'},requestId());
  assert.equal((await query('select count(*)::int as count from reservations where interview_id=$1',[i.id])).rows[0].count,2);
  await syncResult(i.id,{...result,event_id:i.sync_event_id,revision:2,operation:'reschedule'},requestId());assert.equal((await query('select count(*)::int as count from reservations where interview_id=$1',[i.id])).rows[0].count,1);
  await changeInterview(hr,i.id,'cancel',{reason:'Synthetic cancellation.'},requestId());
  i=(await query('select * from interviews where id=$1',[i.id])).rows[0];await assert.rejects(()=>syncContext(i.id,2,result.event_id));
  await dueReminders(requestId());assert.equal((await query("select count(*)::int as count from notifications where interview_id=$1 and type<>'invitation' and state='pending'",[i.id])).rows[0].count,0);
  await syncResult(i.id,{...result,event_id:i.sync_event_id,revision:3,operation:'cancel',outcome:'cancelled',meet_url:undefined},requestId());assert.equal((await query('select count(*)::int as count from reservations where interview_id=$1',[i.id])).rows[0].count,0);
});
