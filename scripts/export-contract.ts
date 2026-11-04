import { z } from "zod";
import { mkdir, writeFile } from "node:fs/promises";
import { syntheticAnalysis } from "./fixtures";
import {
  applicationSchema,
  bookSchema,
  eventSchema,
  intakeSchema,
  resultSchema,
  notificationResultSchema,
  syncResultSchema,
  jobSchema,
} from "../src/lib/contracts";
await mkdir("docs/contracts", { recursive: true });
const schemas = {
  application: applicationSchema,
  booking: bookSchema,
  event: eventSchema,
  gmail_intake: intakeSchema,
  analysis_result: resultSchema,
  notification_result: notificationResultSchema,
  calendar_result: syncResultSchema,
  job: jobSchema,
};
for (const [name, schema] of Object.entries(schemas))
  await writeFile(
    `docs/contracts/${name}.schema.json`,
    JSON.stringify(
      z.toJSONSchema(schema, { unrepresentable: "any", io: "input" }),
      null,
      2,
    ) + "\n",
  );
console.log(
  "Exported boundary JSON Schemas. Cross-record/evidence refinements are enforced by shared Zod + transaction code.",
);
const componentSchemas=Object.fromEntries(Object.entries(schemas).map(([name,schema])=>[name,z.toJSONSchema(schema,{unrepresentable:'any',io:'input'})]));
type Route={path:string;method:'get'|'post';summary:string;scope?:string;schema?:keyof typeof schemas;binary?:boolean;query?:string[];staff?:boolean};
const routes:Route[]=[
  {path:'/api/uploads',method:'post',summary:'Verify and store a public CV; returns a single-job single-use upload handle',binary:true,query:['job_code']},
  {path:'/api/applications',method:'post',summary:'Atomically accept a public application; non-sensitive receipt',schema:'application'},
  {path:'/api/jobs',method:'get',summary:'List authorized jobs, status counts and paginated application counts',staff:true},
  {path:'/api/jobs',method:'post',summary:'Create job',schema:'job',staff:true},
  {path:'/api/jobs/{id}',method:'post',summary:'Edit job; stable code and versioned matching requirements',schema:'job',staff:true},
  {path:'/api/applications/{id}/cv',method:'get',summary:'Authorized private original-CV attachment download',staff:true},
  ...['assign-job','retry-analysis','reanalyse','hold','reject','invite'].map(action=>({path:`/api/applications/{id}/${action}`,method:'post' as const,summary:`Staff ${action}; see INTEGRATION.md for action-specific fields`,staff:true})),
  {path:'/api/internal/attachments',method:'post',summary:'WF01 signed binary attachment ingestion',scope:'wf01',binary:true},
  {path:'/api/internal/intake/gmail',method:'post',summary:'Deduplicate Gmail intake, resolve exact job or queue manual assignment',scope:'wf01',schema:'gmail_intake'},
  {path:'/api/internal/applications/{id}/analysis-context',method:'get',summary:'Bound active run immutable snapshot and five-minute private CV access',scope:'wf01',query:['run_id']},
  {path:'/api/internal/applications/{id}/analysis-result',method:'post',summary:'Validate active event/run/version and evidence, never a human decision',scope:'wf01',schema:'analysis_result'},
  {path:'/api/internal/notifications/{id}/claim',method:'post',summary:'Atomically claim eligible invitation/reminder; authorized template and claim ID',scope:'wf02 or wf04'},
  {path:'/api/internal/notifications/{id}/result',method:'post',summary:'Record matching claim delivery outcome, exact retries deduplicated',scope:'wf02 or wf04',schema:'notification_result'},
  {path:'/api/booking/{token}/slots',method:'get',summary:'Eligible slots, no consumption on GET'},
  {path:'/api/interviews/book',method:'post',summary:'Atomic one-use booking with recoverable receipt',schema:'booking'},
  {path:'/api/slots',method:'post',summary:'Publish a thirty-minute interviewer slot with an explicit instant and timezone',staff:true},
  ...['reschedule','cancel','retry-sync'].map(action=>({path:`/api/interviews/{id}/${action}`,method:'post' as const,summary:`Staff ${action}; reason required, slot_id required for reschedule`,staff:true})),
  {path:'/api/internal/interviews/{id}/sync-context',method:'get',summary:'Current revision/operation authorized Calendar context with stable provider ID',scope:'wf03',query:['event_id','revision']},
  {path:'/api/internal/interviews/{id}/sync-result',method:'post',summary:'Revision-bound confirmed/cancelled/failed/unknown calendar result',scope:'wf03',schema:'calendar_result'},
  {path:'/api/internal/reminders/claim',method:'post',summary:'Create/dedupe due revision-bound reminder intents; return IDs for separate pre-send claim',scope:'wf04'},
  {path:'/api/notifications/{id}/recover',method:'post',summary:'Human recovery of known failure or evidence-backed unknown send reconciliation',staff:true},
];
const paths:Record<string,Record<string,unknown>>={};
for(const route of routes){
  const parameters:unknown[]=[...route.path.matchAll(/\{(id|token)\}/g)].map(m=>({name:m[1],in:'path',required:true,schema:{type:'string',...(m[1]==='id'?{format:'uuid'}:{})}}));
  for(const name of route.query||[])parameters.push({name,in:'query',required:true,schema:{type:name==='revision'?'integer':'string'}});
  if(route.binary)parameters.push({name:'X-File-Name',in:'header',required:true,schema:{type:'string',maxLength:180}});
  const operation:Record<string,unknown>={summary:route.summary,description:route.scope?`Requires ${route.scope} HMAC: timestamp + method + canonical path/query + SHA256(raw bytes), ±300s. See INTEGRATION.md.`:route.staff?'Verified Supabase session cookie + current active staff membership; browser direct DB access denied.':'No account; Origin required for POST. Scoped capability required for booking.',parameters,security:route.scope?[{WorkflowHmac:[]}]:route.staff?[{StaffCookie:[]}]:[],responses:Object.fromEntries(['200','201','400','401','403','404','409','410','413','415','429','503'].map(status=>[status,{description:status.startsWith('2')?'Success; exact response shapes and fixtures in INTEGRATION.md':'Structured safe error (code, message, request_id, retryable); see INTEGRATION.md'}]))};
  if(route.method==='post')operation.requestBody={required:true,content:route.binary?Object.fromEntries(['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document'].map(type=>[type,{schema:{type:'string',format:'binary',description:'Maximum 5242880 actual bytes; MIME/extension/signature/package/scanner verification'}}])):{'application/json':{schema:route.schema?{$ref:'#/components/schemas/'+route.schema}:{type:'object',description:'Action-specific strict fields documented in INTEGRATION.md. Internal claim bodies are {schema_version:1}.'}}}};
  paths[route.path]??={};paths[route.path][route.method]=operation;
}
await writeFile('docs/contracts/openapi.json',JSON.stringify({openapi:'3.1.0',info:{title:'HireFlow web ↔ automation contract',version:'1.0.0',description:'Local and private test environments. Strict shared Zod schemas plus transactional scope/state refinements; see INTEGRATION.md.'},servers:[{url:'http://127.0.0.1:3000',description:'Local web; replace with approved HTTPS private staging origin'}],paths,components:{schemas:componentSchemas,securitySchemes:{WorkflowHmac:{type:'apiKey',in:'header',name:'X-HireFlow-Signature',description:'Also require X-HireFlow-Key-Id and X-HireFlow-Timestamp. Canonical recipe in INTEGRATION.md.'},StaffCookie:{type:'apiKey',in:'cookie',name:'sb-<project-ref>-auth-token',description:'Supabase SSR cookie may be chunked; obtained through /api/auth/login. Current active membership always checked.'}}}},null,2)+'\n');
const ids={event:'01900000-0000-4000-8000-000000000001',application:'01900000-0000-4000-8000-000000000002',run:'01900000-0000-4000-8000-000000000003',job:'01900000-0000-4000-8000-000000000004',notification:'01900000-0000-4000-8000-000000000005',interview:'01900000-0000-4000-8000-000000000006',claim:'01900000-0000-4000-8000-000000000007'};
await writeFile('docs/contracts/fixtures.json',JSON.stringify({schema_version:1,synthetic:true,events:[{schema_version:1,event_id:ids.event,event_type:'application.created',application_id:ids.application,analysis_run_id:ids.run,job_id:ids.job,source:'form'},{schema_version:1,event_id:ids.event,event_type:'interview.invitation_requested',application_id:ids.application,notification_id:ids.notification},{schema_version:1,event_id:ids.event,event_type:'interview.sync_requested',application_id:ids.application,interview_id:ids.interview,revision:1,operation:'create'}],analysis_result:{schema_version:1,event_id:ids.event,application_id:ids.application,analysis_run_id:ids.run,requirements_version:1,outcome:'completed',analysis:syntheticAnalysis({required_skills:['ASP.NET Core'],preferred_skills:['Docker']})},notification_claim_request:{schema_version:1},notification_result:{schema_version:1,claim_id:ids.claim,outcome:'sent',provider_id:'synthetic-message-id'},calendar_result:{schema_version:1,event_id:ids.event,revision:1,operation:'create',outcome:'confirmed',provider_event_id:'hf01900000000040008000000000000006',calendar_id:'synthetic-calendar@example.test',meet_url:'https://meet.google.com/abc-defg-hij'},reminder_claim_request:{schema_version:1},expected_responses:{application:{receipt:ids.application,status:'received'},analysis_result:{status:'accepted',duplicate:false},notification_result:{status:'sent'},booking:{receipt:ids.interview,status:'calendar_pending'},calendar_result:{status:'confirmed'},reminder_claim:{schema_version:1,notification_ids:[ids.notification]},error:{error:{code:'STALE_REVISION',message:'This calendar result is stale.',request_id:ids.event,retryable:false}}}},null,2)+'\n');
