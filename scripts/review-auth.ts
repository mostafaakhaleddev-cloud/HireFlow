import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {createServerClient} from '@supabase/ssr';
import {config} from '../src/lib/config';
import {storageClient} from '../src/lib/auth';
import {query,pool} from '../src/lib/db';
import {assertStagingTarget} from '../src/lib/test-target';
const c=config();assertStagingTarget(c);const admin=storageClient();const email=`auth-review-${randomUUID()}@example.test`,password=randomUUID()+'Aa!';
const made=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.equal(made.error,null);const id=made.data.user!.id;
const jar=new Map<string,string>();const cookie=()=>[...jar].map(([k,v])=>k+'='+v).join('; ');
function ingest(r:Response){for(const entry of r.headers.getSetCookie()){const first=entry.split(';')[0],at=first.indexOf('=');jar.set(first.slice(0,at),first.slice(at+1));}}
try{
 await query("insert into staff(id,display_name,role) values($1,'Synthetic Auth Review','hr')",[id]);
 const client=createServerClient(c.SUPABASE_URL,c.SUPABASE_ANON_KEY,{cookies:{getAll:()=>[...jar].map(([name,value])=>({name,value})),setAll:items=>items.forEach(i=>jar.set(i.name,i.value))}});
 const login=await client.auth.signInWithPassword({email,password});assert.equal(login.error,null);
 // Expire the client-side session timestamp only; the actual refresh token is
 // exchanged with hosted Auth. This is forced renewal, not elapsed JWT expiry.
 const base=[...jar.keys()].find(k=>k.includes('auth-token'))!.replace(/\.\d+$/,'');
 const encoded=[...jar].filter(([k])=>k===base||k.startsWith(base+'.')).sort(([a],[b])=>a.localeCompare(b)).map(([,v])=>v).join('');
 const session=JSON.parse(Buffer.from(encoded.slice(7),'base64url').toString());session.expires_at=1;
 for(const key of [...jar.keys()])if(key===base||key.startsWith(base+'.'))jar.delete(key);
 jar.set(base,'base64-'+Buffer.from(JSON.stringify(session)).toString('base64url'));
 const renewed=await fetch(c.APP_URL+'/jobs',{headers:{Cookie:cookie()},redirect:'manual'});await renewed.arrayBuffer();assert.equal(renewed.status,200);assert.ok(renewed.headers.getSetCookie().some(v=>v.includes('auth-token')));ingest(renewed);
 const logout=await fetch(c.APP_URL+'/api/auth/logout',{method:'POST',headers:{Cookie:cookie(),Origin:c.APP_URL}});assert.equal(logout.status,200);ingest(logout);
 const signedOut=await fetch(c.APP_URL+'/jobs',{headers:{Cookie:cookie()},redirect:'manual'}),signedOutBody=await signedOut.text();
 assert.ok(signedOut.status===307 || (signedOutBody.includes('NEXT_REDIRECT')&&signedOutBody.includes('/login')));
 assert.equal((await fetch(c.APP_URL+'/api/jobs',{headers:{Cookie:cookie()}})).status,401);
 const link=await admin.auth.admin.generateLink({type:'recovery',email,options:{redirectTo:c.APP_URL+'/auth/callback?next=/reset-password'}});assert.equal(link.error,null);
 const target=c.APP_URL+'/auth/callback?type=recovery&token_hash='+encodeURIComponent(link.data.properties.hashed_token);
 jar.clear();const recovered=await fetch(target,{redirect:'manual'});assert.equal(recovered.status,307);assert.equal(recovered.headers.get('location'),c.APP_URL+'/reset-password');ingest(recovered);
 assert.ok(recovered.headers.getSetCookie().every(v=>/httponly/i.test(v)&&/samesite=lax/i.test(v)));
 const resetPage=await fetch(c.APP_URL+'/reset-password',{headers:{Cookie:cookie()},redirect:'manual'});assert.equal(resetPage.status,200);await resetPage.arrayBuffer();
 const replay=await fetch(target,{redirect:'manual'});assert.equal(replay.headers.get('location'),c.APP_URL+'/login?error=invalid_recovery_link');
 const redirect=await fetch(c.APP_URL+'/auth/callback?code=invalid&next=https://evil.example',{redirect:'manual'});assert.ok(redirect.headers.get('location')?.startsWith(c.APP_URL+'/login'));
 const report={forced_real_refresh:true,logout_denies_staff_page:true,recovery_token_hash_callback:true,recovery_replay_denied:true,open_redirect_denied:true,httpOnly_sameSite_cookies:true,no_email_sent:true,password_unchanged:true,pkce_email_link_delivery:'not tested; token-hash callback tested with Admin-generated synthetic link'};
 await writeFile('test-results/review-auth.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await query('delete from staff where id=$1',[id]);await admin.auth.admin.deleteUser(id);await pool().end();}
