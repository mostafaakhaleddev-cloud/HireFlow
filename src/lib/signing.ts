import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from './errors';
export const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export function canonicalPath(input: string) {
  const url=new URL(input,'http://local');
  url.searchParams.sort();
  return url.pathname+(url.searchParams.size?'?'+url.searchParams.toString():'');
}
export function canonical(method:string,path:string,body:string|Buffer,timestamp:string) { return [timestamp,method.toUpperCase(),canonicalPath(path),digest(body)].join('\n'); }
export function signRequest(keyId:string,key:string,method:string,path:string,body:string|Buffer,timestamp=String(Math.floor(Date.now()/1000))) {
  return {'X-HireFlow-Key-Id':keyId,'X-HireFlow-Timestamp':timestamp,'X-HireFlow-Signature':createHmac('sha256',key).update(canonical(method,path,body,timestamp)).digest('hex')};
}
export function safeEqual(a:string,b:string) {const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length && timingSafeEqual(x,y);}
export function verifyRequest(headers:Headers,method:string,path:string,body:string|Buffer,keys:Record<string,string>,allowed:string[],now=Date.now()) {
  const id=headers.get('x-hireflow-key-id')||'',ts=headers.get('x-hireflow-timestamp')||'',sig=headers.get('x-hireflow-signature')||'';
  if(!/^\d{10}$/.test(ts)||Math.abs(now/1000-Number(ts))>300||!keys[id]||!/^[a-f0-9]{64}$/.test(sig)) throw new AppError('INVALID_SIGNATURE','Invalid or expired workflow signature.',401);
  const expected=signRequest(id,keys[id],method,path,body,ts)['X-HireFlow-Signature'];
  if(!safeEqual(expected,sig)) throw new AppError('INVALID_SIGNATURE','Invalid workflow signature.',401);
  if(!allowed.includes(id)) throw new AppError('WORKFLOW_SCOPE','Workflow cannot perform this operation.',403);
  return id;
}
export function signBooking(invitation:{id:string;version:number},key:string) {
  const payload=Buffer.from(JSON.stringify({id:invitation.id,v:invitation.version})).toString('base64url');
  return payload+'.'+createHmac('sha256',key).update(payload).digest('base64url');
}
export function verifyBooking(token:string,key:string): {id:string;v:number} {
  const [payload,sig,...extra]=token.split('.');
  if(!payload||!sig||extra.length||!safeEqual(createHmac('sha256',key).update(payload).digest('base64url'),sig)) throw new AppError('INVALID_LINK','This booking link is invalid.',410);
  try { const v=JSON.parse(Buffer.from(payload,'base64url').toString()); if(!/^[a-f0-9-]{36}$/.test(v.id)||!Number.isInteger(v.v)||v.v<1) throw Error(); return v; }
  catch {throw new AppError('INVALID_LINK','This booking link is invalid.',410);}
}
