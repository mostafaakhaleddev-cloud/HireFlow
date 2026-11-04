import { config } from '../src/lib/config';
import { signRequest } from '../src/lib/signing';
export type Workflow='wf01'|'wf02'|'wf03'|'wf04';
export async function internal(path:string,workflow:Workflow,body?:unknown) {
  const c=config(),method=body===undefined?'GET':'POST',raw=body===undefined?'':JSON.stringify(body),key=c[`${workflow.toUpperCase()}_KEY` as 'WF01_KEY'];
  const response=await fetch(c.APP_URL+path,{method,headers:{'Content-Type':'application/json',...signRequest(workflow,key,method,path,raw)},body:method==='POST'?raw:undefined,signal:AbortSignal.timeout(15000),redirect:'error'});
  const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error?.code||'INTERNAL_REQUEST_FAILED'),{status:response.status});return data;
}
export async function attachment(bytes:Buffer) {
  const c=config(),path='/api/internal/attachments';
  const response=await fetch(c.APP_URL+path,{method:'POST',headers:{'Content-Type':'application/pdf','X-File-Name':'synthetic-cv.pdf',...signRequest('wf01',c.WF01_KEY,'POST',path,bytes)},body:new Uint8Array(bytes)});
  const data=await response.json();if(!response.ok)throw new Error(data.error?.code||'ATTACHMENT_FAILED');return data.upload_handle as string;
}
