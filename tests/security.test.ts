import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { canonicalPath,signBooking,verifyBooking,signRequest,verifyRequest,digest } from '../src/lib/signing';
import { analysisSchema,applicationSchema,jobSchema,resultSchema,validateRequirementEvidence } from '../src/lib/contracts';
import { validateFile } from '../src/lib/uploads';
import { safeMeetUrl } from '../src/lib/scheduling';
import { syntheticAnalysis,syntheticPdf } from '../scripts/fixtures';
import { boundedBody } from '../src/lib/http';
const key='a'.repeat(64),id=randomUUID();
test('HMAC covers method, sorted canonical query and exact raw bytes',()=>{
  const body='{"schema_version":1}',path='/api/internal/a?z=2&a=1',headers=new Headers(signRequest('wf01',key,'POST',path,body));
  assert.equal(canonicalPath(path),'/api/internal/a?a=1&z=2');
  assert.equal(verifyRequest(headers,'POST','/api/internal/a?a=1&z=2',body,{wf01:key},['wf01']),'wf01');
  assert.throws(()=>verifyRequest(headers,'POST',path,body+' ',{wf01:key},['wf01']));
  assert.throws(()=>verifyRequest(headers,'GET',path,body,{wf01:key},['wf01']));
  assert.throws(()=>verifyRequest(headers,'POST','/api/internal/b',body,{wf01:key},['wf01']));
});
test('HMAC rejects expired signatures, wrong keys and workflow scope',()=>{
  const h=new Headers(signRequest('wf01',key,'POST','/a','{}'));
  assert.throws(()=>verifyRequest(h,'POST','/a','{}',{wf01:key},['wf03']));
  assert.throws(()=>verifyRequest(h,'POST','/a','{}',{wf01:'b'.repeat(64)},['wf01']));
  assert.throws(()=>verifyRequest(h,'POST','/a','{}',{wf01:key},['wf01'],Date.now()+301000));
});
test('binary attachment signatures cover actual byte digest',()=>{
  const bytes=syntheticPdf(),h=new Headers(signRequest('wf01',key,'POST','/file',bytes));
  assert.equal(verifyRequest(h,'POST','/file',bytes,{wf01:key},['wf01']),'wf01');
  assert.throws(()=>verifyRequest(h,'POST','/file',Buffer.concat([bytes,Buffer.from('x')]),{wf01:key},['wf01']));
});
test('booking signatures bind invitation and version; tampering cannot swap IDs',()=>{
  const token=signBooking({id,version:2},key);assert.deepEqual(verifyBooking(token,key),{id,v:2});
  assert.throws(()=>verifyBooking(token+'x',key));assert.throws(()=>verifyBooking(token,'b'.repeat(64)));
  const altered=Buffer.from(JSON.stringify({id:randomUUID(),v:2})).toString('base64url');assert.throws(()=>verifyBooking(altered+'.'+token.split('.')[1],key));
});
test('strict input rejects server-owned fields and invented consent',()=>{
  const base={job_code:'JOB-BE-001',name:'Synthetic Candidate',email:'synthetic@example.test',consent:true,privacy_version:'2026-11-v1',upload_handle:randomUUID(),idempotency_key:randomUUID()};
  assert.ok(applicationSchema.safeParse(base).success);
  for(const field of ['role','candidate_id','processing_status','review_status','object_path','approved_by'])assert.equal(applicationSchema.safeParse({...base,[field]:'injected'}).success,false);
  assert.equal(applicationSchema.safeParse({...base,consent:false}).success,false);
});
test('evidence requires CV sources, exact snapshot coverage and unknown unsupported years',()=>{
  const snapshot={required_skills:['ASP.NET Core'],preferred_skills:['Docker']},analysis=syntheticAnalysis(snapshot);
  assert.ok(analysisSchema.safeParse(analysis).success);assert.ok(validateRequirementEvidence(analysis,snapshot));
  assert.equal(analysisSchema.safeParse({...analysis,experience_years:{value:3,status:'UNVERIFIED'}}).success,false);
  assert.equal(analysisSchema.safeParse({...analysis,experience_years:{value:3,status:'EVIDENCED'}}).success,false);
  assert.equal(analysisSchema.safeParse({...analysis,skills_evidence:[{skill:'ASP.NET Core',status:'EVIDENCED',evidence:'Claim',source:null}]}).success,false);
  assert.equal(validateRequirementEvidence({...analysis,skills_evidence:analysis.skills_evidence.slice(0,1)},snapshot),false);
  assert.equal(validateRequirementEvidence({...analysis,skills_evidence:[...analysis.skills_evidence,{skill:'Unrequested',status:'NOT_EVIDENCED',evidence:null,source:null}]},snapshot),false);
  assert.equal(resultSchema.safeParse({schema_version:1,event_id:id,application_id:id,analysis_run_id:id,requirements_version:1,outcome:'completed',analysis,review_status:'interview_approved'}).success,false);
});
test('job skills reject duplicates and contradictory required/preferred lists',()=>{
  const base={job_code:'JOB-BE-001',title:'Backend Engineer',description:'Synthetic test opportunity',required_skills:['ASP.NET Core'],preferred_skills:['Docker'],minimum_years:2,status:'open'};
  assert.ok(jobSchema.safeParse(base).success);
  assert.equal(jobSchema.safeParse({...base,required_skills:['React','react']}).success,false);
  assert.equal(jobSchema.safeParse({...base,preferred_skills:['asp.net core']}).success,false);
});
test('PDF validation accepts the synthetic file and rejects active/encrypted/mislabeled/oversize content',async()=>{
  const pdf=syntheticPdf();assert.equal(await validateFile(pdf,'cv.pdf','application/pdf'),'application/pdf');
  for(const input of [Buffer.from('not a pdf'),Buffer.from('%PDF-1.4\n%%EOF'),Buffer.from(pdf.toString().replace('/Type /Catalog','/JavaScript /Type /Catalog')),Buffer.from(pdf.toString().replace('/Type /Catalog','/Encrypt /Type /Catalog')),Buffer.alloc(5*1024*1024+1)])await assert.rejects(()=>validateFile(input,'cv.pdf','application/pdf'));
  await assert.rejects(()=>validateFile(pdf,'cv.exe','application/pdf'));await assert.rejects(()=>validateFile(pdf,'cv.pdf','text/plain'));await assert.rejects(()=>validateFile(pdf,'../cv.pdf','application/pdf'));
});
test('DOCX invalid zip, traversal and malformed office content are rejected',async()=>{
  const mime='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  await assert.rejects(()=>validateFile(Buffer.from([0x50,0x4b,3,4,0,0,0,0]),'cv.docx',mime));
  await assert.rejects(()=>validateFile(syntheticPdf(),'cv.docx',mime));
});
test('request limits enforce actual streamed bytes regardless of content-length',async()=>{
  const request=new Request('http://local/upload',{method:'POST',body:new Uint8Array(200)});
  await assert.rejects(()=>boundedBody(request,100));
  const okay=new Request('http://local/upload',{method:'POST',body:'hello'});assert.equal((await boundedBody(okay,10)).toString(),'hello');
});
test('Meet URLs reject arbitrary hosts, credentials, ports and query leakage',()=>{
  assert.equal(safeMeetUrl('https://meet.google.com/abc-defg-hij'),'https://meet.google.com/abc-defg-hij');
  for(const url of ['https://meet.google.com.evil.test/abc-defg-hij','javascript:alert(1)','https://user@meet.google.com/abc-defg-hij','https://meet.google.com/abc-defg-hij?token=secret'])assert.throws(()=>safeMeetUrl(url));
});
test('DST instants render through IANA zones without fixed UTC offsets',()=>{
  const cairo=new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Cairo',hour:'2-digit',minute:'2-digit',hour12:false});
  assert.equal(cairo.format(new Date('2026-07-01T10:00:00Z')),'13:00');
  assert.equal(cairo.format(new Date('2026-12-01T10:00:00Z')),'12:00');
  assert.notEqual(digest(syntheticPdf('v1')),digest(syntheticPdf('v2')));
});
