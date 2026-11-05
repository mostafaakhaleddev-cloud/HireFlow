import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {config} from '../src/lib/config';
import {assertStagingTarget} from '../src/lib/test-target';
import {query,pool,transaction} from '../src/lib/db';
import {storageClient} from '../src/lib/auth';
import {syntheticPdf} from './fixtures';
import {validateFile} from '../src/lib/uploads';
import {scanFile} from '../src/lib/scanner';
import {digest} from '../src/lib/signing';
const c=config();assertStagingTarget(c);
assert.ok(process.argv.includes('--seed-10000'),'Explicit --seed-10000 required');
const login=await storageClient().auth.signInWithPassword({email:process.env.BOOTSTRAP_EMAIL!,password:process.env.BOOTSTRAP_PASSWORD!});assert.equal(login.error,null);const actor=login.data.user!.id;
assert.equal((await query('select role from staff where id=$1',[actor])).rows[0].role,'admin');
const bytes=syntheticPdf('Ordinary synthetic performance CV'),sha=digest(bytes);await validateFile(bytes,'cv.pdf','application/pdf');assert.ok(c.SCANNER_URL&&c.SCANNER_TOKEN);await scanFile(bytes,c.SCANNER_URL,c.SCANNER_TOKEN);
await transaction(async db=>{
 for(let n=1;n<=100;n++)await db.query("insert into jobs(job_code,title,description,required_skills,status,created_by) values($1,$2,'Synthetic bounded performance fixture only.',ARRAY['TypeScript'],'open',$3) on conflict(job_code) do nothing",['JOB-PERF-'+String(n).padStart(3,'0'),'Synthetic Performance Role '+n,actor]);
});
const jobs=(await query("select id,job_code from jobs where job_code like 'JOB-PERF-%' order by job_code")).rows;assert.equal(jobs.length,100);
const existing=new Set((await query("select submission_key from applications where submission_key::text like '01900001-0000-4000-8000-%'")).rows.map(r=>r.submission_key));
const storage=storageClient().storage.from('candidate-cvs');let next=0,completed=0;
async function seed(){while(next<10000){const i=next++,key=`01900001-0000-4000-8000-${String(i).padStart(12,'0')}`;if(existing.has(key)){completed++;continue;}
 const path=`performance-v1/${key}.pdf`,job=jobs[i%100];
 const upload=await storage.upload(path,bytes,{contentType:'application/pdf',upsert:false});
 if(upload.error){const old=await storage.download(path);assert.equal(old.error,null);assert.equal(digest(Buffer.from(await old.data!.arrayBuffer())),sha);}
 await transaction(async db=>{
  const u=(await db.query("insert into uploads(purpose,job_id,object_path,original_name,media_type,byte_size,sha256,scan_status,consumed_at) values('public',$1,$2,'synthetic-performance.pdf','application/pdf',$3,$4,'clean',now()) returning id",[job.id,path,bytes.length,sha])).rows[0];
  const person=(await db.query('insert into candidates(normalized_email) values($1) on conflict(normalized_email) do update set normalized_email=excluded.normalized_email returning id',[`perf-${i}@example.test`])).rows[0];
  await db.query("insert into applications(candidate_id,job_id,source,submission_key,payload_hash,submitted_name,submitted_email,cv_upload_id,privacy_version,consent_at,processing_status,review_status) values($1,$2,'form',$3,$4,$5,$6,$7,'2026-11-v1',now(),'needs_manual_review','awaiting_review')",[person.id,job.id,key,digest(key),'Synthetic Perf Candidate '+i,`perf-${i}@example.test`,u.id]);
 });
 completed++;if(completed%500===0)console.log(JSON.stringify({completed,total:10000}));
}}
try{await Promise.all(Array.from({length:8},seed));await writeFile('test-results/perf-seed.json',JSON.stringify({jobs:100,applications:completed,private_objects:completed,object_bytes:bytes.length,scanner:'Microsoft Defender',fixture_method:'Bulk DB fixture; completed/manual review state, no analysis queue; not a workflow test.'},null,2));console.log('Bounded staging dataset complete.');}finally{await pool().end();}
