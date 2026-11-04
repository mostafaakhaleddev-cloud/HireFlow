import { Pool } from 'pg';
import { createClient } from '@supabase/supabase-js';
import { verifyDatabaseTarget } from '../src/lib/test-target';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
const required=['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','STAGING_ADMIN_DATABASE_URL'];
const missing=required.filter(name=>!process.env[name]?.trim());
if(missing.length){console.log(JSON.stringify({missing}));process.exit(1);}
let db:Pool|undefined;
try{
  const http=new URL(process.env.SUPABASE_URL!),match=http.hostname.match(/^([a-z0-9]{20})\.supabase\.co$/);
  if(http.protocol!=='https:'||!match)throw new Error('SUPABASE_URL');
  const ref=match[1];
  if(process.env.STAGING_PROJECT_REF&&process.env.STAGING_PROJECT_REF!==ref)throw new Error('STAGING_PROJECT_REF');
  const keyChecks:Record<string,boolean>={};
  for(const [name,role] of [['SUPABASE_ANON_KEY','anon'],['SUPABASE_SERVICE_ROLE_KEY','service_role']]){
    const key=process.env[name]!;
    if(key.split('.').length===3){const claims=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString());keyChecks[name]=claims.role===role&&claims.ref===ref;}
    else keyChecks[name]=key.startsWith(role==='anon'?'sb_publishable_':'sb_secret_');
    if(!keyChecks[name])throw new Error(name);
  }
  const connection=new URL(process.env.STAGING_ADMIN_DATABASE_URL!);
  // Strengthen transport verification for the operator's dashboard URL; never disable TLS.
  connection.searchParams.set('sslmode','verify-full');
  if(!connection.searchParams.has('sslrootcert')&&existsSync('supabase/certificates/prod-ca-2021.crt'))connection.searchParams.set('sslrootcert',resolve('supabase/certificates/prod-ca-2021.crt'));
  verifyDatabaseTarget(connection.toString(),ref);
  const api=createClient(http.origin,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
  const settings=await fetch(http.origin+'/auth/v1/settings',{headers:{apikey:process.env.SUPABASE_ANON_KEY!},signal:AbortSignal.timeout(12000)});
  const settingsBody=settings.ok?await settings.json():{};
  const auth=await api.auth.admin.listUsers({perPage:1,page:1});
  db=new Pool({connectionString:connection.toString(),max:1,connectionTimeoutMillis:12000});
  await db.query('begin read only');
  const identity=(await db.query("select r.rolsuper,r.rolcreaterole,exists(select 1 from pg_stat_ssl where pid=pg_backend_pid() and ssl) as tls from pg_roles r where rolname=current_user")).rows[0];
  const tables=(await db.query("select tablename,rowsecurity from pg_tables where schemaname='public' order by tablename")).rows;
  const history=(await db.query("select to_regclass('supabase_migrations.schema_migrations') is not null as present")).rows[0].present;
  const migrations=history?(await db.query('select version,name from supabase_migrations.schema_migrations order by version')).rows:[];
  const managed=(await db.query("select to_regclass('auth.users') is not null as auth,to_regclass('storage.objects') is not null as storage")).rows[0];
  const roles=(await db.query("select rolname,rolsuper,rolbypassrls,rolcreaterole from pg_roles where rolname in ('hireflow_backend','hireflow_web')")).rows;
  await db.query('rollback');
  console.log(JSON.stringify({read_only:true,target_bound:true,key_types_compatible:keyChecks,auth_anon_endpoint:settings.ok,auth_admin_endpoint:!auth.error,signup_disabled:settingsBody.disable_signup,admin_database_connected:true,admin_flags:identity,managed,tables,migrations,roles}));
}catch(error){const code=(error as {code?:string}).code;const field=error instanceof Error&&required.concat('STAGING_PROJECT_REF').includes(error.message)?error.message:undefined;console.log(JSON.stringify({code:'STAGING_ADMIN_INSPECT_FAILED',field,reason_code:code||'INVALID_CONFIGURATION_OR_NETWORK'}));process.exitCode=1;}finally{await db?.end();}
