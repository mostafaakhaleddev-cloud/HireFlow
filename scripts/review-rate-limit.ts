import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {config} from '../src/lib/config';
import {assertStagingTarget} from '../src/lib/test-target';
const c=config();assertStagingTarget(c);
// Dedicated booking-read bucket: invalid capability never reaches a mutation.
const statuses:Record<string,number>={};const headers:string[]=[];
let next=0;async function client(){while(next++<95){
 const r=await fetch(c.APP_URL+'/api/booking/invalid-review-token/slots');await r.arrayBuffer();statuses[r.status]=(statuses[r.status]||0)+1;
 if(r.status===429){headers.push(r.headers.get('retry-after')||'');assert.ok(Number(r.headers.get('retry-after'))>0);}
 else assert.equal(r.status,410);
}}
await Promise.all(Array.from({length:20},client));
assert.ok(statuses['429']>=5);await writeFile('test-results/review-rate-limit.json',JSON.stringify({statuses,retry_after_present:headers.length>0,actual_http:true,protection_disabled:false},null,2));console.log(JSON.stringify({statuses}));
