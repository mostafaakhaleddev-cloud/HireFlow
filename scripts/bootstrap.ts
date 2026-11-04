import { createClient } from '@supabase/supabase-js';
import { config,isLoopback } from '../src/lib/config';
import { pool } from '../src/lib/db';
const c=config();
if(!isLoopback(c.SUPABASE_URL)||!isLoopback(c.APP_URL)||!isLoopback(c.DATABASE_URL.replace(/^postgres(ql)?:/,'http:')))throw new Error('Bootstrap is strictly local-only.');
const email=process.env.BOOTSTRAP_EMAIL,password=process.env.BOOTSTRAP_PASSWORD;
if(!email||!email.endsWith('@example.test')||!password||password.length<12)throw new Error('Set a synthetic BOOTSTRAP_EMAIL and a random BOOTSTRAP_PASSWORD in ignored .env.local.');
const client=createClient(c.SUPABASE_URL,c.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const list=await client.auth.admin.listUsers({perPage:1000});
if(list.error)throw new Error('Local Auth unavailable.');
let user=list.data.users.find(u=>u.email===email);
if(!user){const result=await client.auth.admin.createUser({email,password,email_confirm:true});if(result.error||!result.data.user)throw new Error('Could not provision local test staff.');user=result.data.user;}
await pool().query(`insert into staff(id,display_name,role,calendar_id) values($1,'Demo HR Admin','admin','synthetic-calendar@example.test') on conflict(id) do nothing`,[user.id]);
console.log('Local synthetic admin provisioned. Sign in with BOOTSTRAP_EMAIL / BOOTSTRAP_PASSWORD from .env.local.');
await pool().end();
