import { createServer,request,type IncomingHttpHeaders } from 'node:http';
import { config,isLoopback } from '../src/lib/config';
const c=config();if(!isLoopback(c.APP_URL)||!isLoopback(c.SUPABASE_URL)||c.INTEGRATION_MODE!=='simulator'||c.TRUST_PROXY!=='true')throw new Error('Synthetic loopback benchmark proxy requires explicit TRUST_PROXY=true. Never deploy this tool.');
const target=new URL(c.APP_URL);
createServer((incoming,outgoing)=>{
  const client=Number(incoming.headers['x-benchmark-client']);
  if(!Number.isInteger(client)||client<1||client>20||!incoming.url?.startsWith('/')||incoming.url.startsWith('//')){outgoing.writeHead(400);outgoing.end();return;}
  const headers:IncomingHttpHeaders={...incoming.headers,host:target.host,'x-forwarded-for':`192.0.2.${client}`};delete headers['x-benchmark-client'];
  // Caller cannot choose a destination or preserve spoofed forwarded addresses.
  const forwarded=request({hostname:target.hostname,port:target.port||3000,path:incoming.url,method:incoming.method,headers},response=>{outgoing.writeHead(response.statusCode||502,response.headers);response.pipe(outgoing);});
  forwarded.setTimeout(25000,()=>forwarded.destroy());forwarded.on('error',()=>{if(!outgoing.headersSent)outgoing.writeHead(502);outgoing.end();});incoming.pipe(forwarded);
}).listen(3001,'127.0.0.1',()=>console.log('Synthetic benchmark proxy on 127.0.0.1:3001; 20 fixed TEST-NET client identities. Never expose externally.'));
