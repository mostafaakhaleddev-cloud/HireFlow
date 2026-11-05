import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {config} from '../src/lib/config';
import {digest} from '../src/lib/signing';
import {assertStagingTarget} from '../src/lib/test-target';
import {query,pool} from '../src/lib/db';
import {syntheticPdf} from './fixtures';
import {zip,officeEntries} from '../tests/zip-fixture';
const c=config();assertStagingTarget(c);assert.ok(c.SCANNER_URL&&c.SCANNER_TOKEN);
const pdf=syntheticPdf('Ordinary synthetic CV '+Date.now()),docx=zip(officeEntries);
await writeFile('test-results/ordinary-synthetic.pdf',pdf);await writeFile('test-results/ordinary-synthetic.docx',docx);
const results=[];
for(const [name,mime,bytes] of [['ordinary-synthetic.pdf','application/pdf',pdf],['ordinary-synthetic.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document',docx]] as const){
 const r=await fetch(c.APP_URL+'/api/uploads?job_code=JOB-REVIEW-110401',{method:'POST',headers:{Origin:c.APP_URL,'Content-Type':mime,'X-File-Name':name},body:new Uint8Array(bytes)});const data=await r.json();assert.equal(r.status,201,data.error?.code);
 const u=(await query('select scan_status,sha256 from uploads where id=$1',[data.upload_handle])).rows[0];assert.equal(u.scan_status,'clean');assert.equal(u.sha256,digest(bytes));results.push({name,status:r.status,scan_status:u.scan_status});
}
// EICAR is a harmless industry antivirus test string, never an executable malware sample.
const eicar=Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
const detected=await fetch(c.SCANNER_URL,{method:'POST',headers:{Authorization:'Bearer '+c.SCANNER_TOKEN,'X-Content-SHA256':digest(eicar)},body:new Uint8Array(eicar)});assert.equal(detected.status,503);
results.push({name:'EICAR harmless detector fixture',status:detected.status,scan_status:'no clean verdict'});
await writeFile('test-results/review-scanner.json',JSON.stringify({results,real_engine:'Microsoft Defender'},null,2));console.log(JSON.stringify({results}));await pool().end();
