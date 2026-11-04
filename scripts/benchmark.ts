import { cpus,platform,arch,totalmem } from 'node:os';
import { mkdir,writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createServerClient } from '@supabase/ssr';
import { config,isLoopback } from '../src/lib/config';
import { query,pool } from '../src/lib/db';
import { syntheticPdf } from './fixtures';
const c=config();
if(!isLoopback(c.APP_URL)||!isLoopback(c.SUPABASE_URL))throw new Error('Local synthetic benchmark only.');
const ready=await fetch(c.APP_URL+'/api/ready').then(r=>r.json());
if(!ready.ready||ready.build_mode!=='production')throw new Error('Run configured production build + npm start before benchmarking.');
const dataset=(await query("select (select count(*)::int from jobs where job_code like 'JOB-PERF-%') as jobs,(select count(*)::int from applications a join jobs j on j.id=a.job_id where j.job_code like 'JOB-PERF-%') as applications")).rows[0];
await pool().end();if(dataset.jobs<100||dataset.applications<10000)throw new Error('Run perf:seed first: need 100 performance jobs and 10,000 applications.');
const target=process.env.BENCH_URL||c.APP_URL;
if(!isLoopback(target)||(target!==c.APP_URL&&c.TRUST_PROXY!=='true'))throw new Error('Use a loopback benchmark target; explicit TRUST_PROXY required for test proxy.');
const workload=process.argv.includes('--public')?'public':'staff',concurrency=20,warmup=60000,duration=300000;
const jar=new Map<string,string>(),auth=createServerClient(c.SUPABASE_URL,c.SUPABASE_ANON_KEY,{cookies:{getAll:()=>[...jar].map(([name,value])=>({name,value})),setAll:items=>items.forEach(i=>jar.set(i.name,i.value))}});
const login=await auth.auth.signInWithPassword({email:process.env.BOOTSTRAP_EMAIL||'',password:process.env.BOOTSTRAP_PASSWORD||''});if(login.error)throw new Error('Provisioned local staff required.');
const cookie=[...jar].map(([k,v])=>`${k}=${v}`).join('; '),latency:number[]=[],transfer:number[]=[],statuses:Record<string,number>={};
const bytes=new Uint8Array(syntheticPdf('Synthetic benchmark')),started=performance.now();let sequence=0;
const count=(status:string)=>{statuses[status]=(statuses[status]||0)+1;};
const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function client(index:number){while(performance.now()-started<warmup+duration){const measured=performance.now()-started>=warmup,headers={'X-Benchmark-Client':String(index+1)};try{
  if(workload==='staff'){
    const path=sequence++%2?'/jobs?status=open':'/candidates?q=Synthetic&source=form',t=performance.now();
    const response=await fetch(target+path,{headers:{...headers,Cookie:cookie},redirect:'manual',signal:AbortSignal.timeout(10000)});await response.arrayBuffer();
    if(measured){count(String(response.status));if(response.ok)latency.push(performance.now()-t);}
  }else{
    const t=performance.now(),uploaded=await fetch(target+'/api/uploads?job_code=JOB-PERF-001',{method:'POST',headers:{...headers,Origin:c.APP_URL,'Content-Type':'application/pdf','X-File-Name':'synthetic-benchmark.pdf'},body:bytes,signal:AbortSignal.timeout(20000)}),file=await uploaded.json();
    if(measured){transfer.push(performance.now()-t);if(!uploaded.ok)count('upload_'+uploaded.status);}
    if(uploaded.ok){const t=performance.now();const response=await fetch(target+'/api/applications',{method:'POST',headers:{...headers,Origin:c.APP_URL,'Content-Type':'application/json'},body:JSON.stringify({job_code:'JOB-PERF-001',name:'Synthetic Benchmark',email:`benchmark-${index}@example.test`,phone:'',consent:true,privacy_version:'2026-11-v1',upload_handle:file.upload_handle,idempotency_key:randomUUID()}),signal:AbortSignal.timeout(10000)});await response.arrayBuffer();if(measured){count(String(response.status));if(response.ok)latency.push(performance.now()-t);}}
  }
}catch{if(measured)count('transport_error');}
// Public clients are paced below the per-client protection budget; not a saturation/RPS claim.
if(workload==='public')await pause(30000);
}}
console.log(`Benchmark ${workload}: 20 clients, 60s warm-up, 300s measured, rate limits enabled.`);
await Promise.all(Array.from({length:concurrency},(_,i)=>client(i)));
const stats=(a:number[])=>{a.sort((x,y)=>x-y);return {n:a.length,p50_ms:a.length?Number(a[Math.floor((a.length-1)*.5)].toFixed(2)):null,p95_ms:a.length?Number(a[Math.floor((a.length-1)*.95)].toFixed(2)):null};};
const unexpected=Object.entries(statuses).filter(([k])=>/^(upload_)?5\d\d$/.test(k)||k==='transport_error').reduce((sum,[,v])=>sum+v,0),nonLimited=Object.entries(statuses).filter(([k])=>!k.endsWith('429')).reduce((sum,[,v])=>sum+v,0),success=stats(latency);
const report={recorded_at:new Date().toISOString(),workload,build:'production (readiness checked)',machine:{os:platform(),arch:arch(),cpu:cpus()[0]?.model,logical_cpus:cpus().length,memory_gib:Math.round(totalmem()/2**30),region:'local'},dataset,concurrency,warmup_seconds:60,measured_seconds:300,actual_total_seconds:(performance.now()-started)/1000,statuses,success_latency:success,file_transfer_and_validation:stats(transfer),unexpected_error_rate:nonLimited?unexpected/nonLimited:null,rate_limits_enabled:true,public_pacing_seconds:workload==='public'?30:null,benchmark_proxy:target!==c.APP_URL,cold_start:'not measured',external_provider_time:'excluded; not exercised',objective_met:success.n>0&&success.p95_ms!<=(workload==='staff'?500:1000)&&unexpected/Math.max(nonLimited,1)<.01};
await mkdir('test-results',{recursive:true});await writeFile(`test-results/performance-${workload}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
