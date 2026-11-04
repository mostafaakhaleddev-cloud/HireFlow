import { Pool } from 'pg';
import { readFile,readdir,writeFile,mkdir,rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes,pbkdf2Sync,createHmac,createHash } from 'node:crypto';
import { verifyDatabaseTarget } from '../src/lib/test-target';

// Dedicated staging only; raw credentials stay in process memory / ignored .env.local.
const source=new URL(process.env.SUPABASE_URL||'http://invalid');
const ref=source.hostname.match(/^([a-z0-9]{20})\.supabase\.co$/)?.[1];
if(!ref||source.protocol!=='https:'||(process.env.STAGING_PROJECT_REF&&process.env.STAGING_PROJECT_REF!==ref))throw new Error('SUPABASE_URL / STAGING_PROJECT_REF mismatch; values redacted.');
if(!process.env.STAGING_ADMIN_DATABASE_URL)throw new Error('Missing STAGING_ADMIN_DATABASE_URL.');
const url=new URL(process.env.STAGING_ADMIN_DATABASE_URL);url.searchParams.set('sslmode','verify-full');
if(!url.searchParams.has('sslrootcert'))url.searchParams.set('sslrootcert',resolve('supabase/certificates/prod-ca-2021.crt'));
verifyDatabaseTarget(url.toString(),ref);
const db=new Pool({connectionString:url.toString(),max:1,connectionTimeoutMillis:12000});
let stage='inspection';
try{
  await db.query('begin');
  await db.query("set local lock_timeout='8s'");
  await db.query("select pg_advisory_xact_lock(hashtext('hireflow-staging-migrations'))");
  const managed=(await db.query("select to_regclass('auth.users') is not null as auth,to_regclass('storage.objects') is not null as storage")).rows[0];
  if(!managed.auth||!managed.storage)throw new Error('REAL_SUPABASE_SCHEMAS_REQUIRED');
  const hasHistory=(await db.query("select to_regclass('supabase_migrations.schema_migrations') is not null as present")).rows[0].present;
  const history=hasHistory?(await db.query('select version,name,statements from supabase_migrations.schema_migrations order by version')).rows:[];
  const files=(await readdir('supabase/migrations')).filter(f=>/^\d+_.+\.sql$/.test(f)).sort();
  const versions=files.map(f=>f.split('_')[0]);
  if(history.some(h=>!versions.includes(h.version)))throw new Error('UNKNOWN_MIGRATION_HISTORY_REQUIRES_REVIEW');
  const tables=(await db.query("select tablename from pg_tables where schemaname='public' order by tablename")).rows.map(r=>r.tablename);
  if(!history.length&&tables.some(t=>['staff','jobs','applications','uploads','interviews','notifications'].includes(t)))throw new Error('UNTRACKED_APPLICATION_TABLES_REQUIRES_REVIEW');
  await mkdir('test-results',{recursive:true});
  await writeFile('test-results/staging-migration-inspection.json',JSON.stringify({inspected_at:new Date().toISOString(),real_managed_schemas:managed,public_tables:tables,migration_versions:history.map(h=>h.version),pending:versions.filter(v=>!history.some(h=>h.version===v))},null,2));
  if(!process.argv.includes('--apply')){await db.query('rollback');console.log('Staging plan saved. No changes applied.');process.exitCode=0;}
  else{
    stage='migrations';
    // CLI-compatible version history; no reset, repair, or managed schema replacement.
    await db.query('create schema if not exists supabase_migrations');
    await db.query('create table if not exists supabase_migrations.schema_migrations(version text not null primary key,statements text[],name text)');
    const applied:string[]=[];
    for(const file of files){const [version,...parts]=file.replace(/\.sql$/,'').split('_');const sql=await readFile('supabase/migrations/'+file,'utf8');const existing=history.find(h=>h.version===version);
      if(existing){if(existing.statements?.length===1&&existing.statements[0]!==sql)throw new Error('MIGRATION_CONTENT_MISMATCH');continue;}
      await db.query(sql);
      await db.query('insert into supabase_migrations.schema_migrations(version,name,statements) values($1,$2,$3)',[version,parts.join('_'),[sql]]);applied.push(version);
    }
    stage='runtime_role';
    const existingRole=(await db.query("select rolname from pg_roles where rolname='hireflow_web'")).rows[0];
    let runtime=process.env.DATABASE_URL;
    if(!existingRole){
      const password=randomBytes(32).toString('hex'),salt=randomBytes(16),salted=pbkdf2Sync(password,salt,4096,32,'sha256');
      const clientKey=createHmac('sha256',salted).update('Client Key').digest();
      const stored=createHash('sha256').update(clientKey).digest('base64'),server=createHmac('sha256',salted).update('Server Key').digest('base64');
      const verifier=`SCRAM-SHA-256$4096:${salt.toString('base64')}$${stored}:${server}`;
      // Send only a verifier to role DDL; never put a plaintext password in SQL.
      await db.query("select set_config('hireflow.runtime_verifier',$1,true)",[verifier]);
      await db.query("do $$ begin execute format('create role hireflow_web login noinherit nosuperuser nocreatedb nocreaterole password %L',current_setting('hireflow.runtime_verifier')); end $$");
      await db.query('grant hireflow_backend to hireflow_web');
      const runtimeUrl=new URL(url);runtimeUrl.username=url.hostname.endsWith('.pooler.supabase.com')?'hireflow_web.'+ref:'hireflow_web';runtimeUrl.password=password;runtime=runtimeUrl.toString();
    }else if(!runtime)throw new Error('EXISTING_RUNTIME_ROLE_REQUIRES_DATABASE_URL_NO_PASSWORD_RESET_PERFORMED');
    verifyDatabaseTarget(runtime!,ref);
    stage='secure_environment';
    let env=await readFile('.env.local','utf8');
    for(const [name,value] of Object.entries({STAGING_PROJECT_REF:ref,STAGING_ADMIN_DATABASE_URL:url.toString(),DATABASE_URL:runtime!})){
      const line=name+'='+JSON.stringify(value);const pattern=new RegExp('^'+name+'=.*$','m');env=pattern.test(env)?env.replace(pattern,()=>line):env.trimEnd()+'\n'+line+'\n';
    }
    // Persist generated credentials in an ignored recovery file before committing
    // role creation; do not lose the only copy if the process exits after COMMIT.
    await writeFile('.env.local.tmp',env,{mode:0o600});
    await db.query('commit');
    await rename('.env.local.tmp','.env.local');
    console.log(JSON.stringify({applied_versions:applied,runtime_role_created:!existingRole,environment_updated:true,secrets_printed:false}));
  }
}catch(error){await db.query('rollback').catch(()=>{});console.error(JSON.stringify({code:'STAGING_APPLY_FAILED',stage,database_code:(error as {code?:string}).code||undefined,safe_reason:error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:undefined}));process.exitCode=1;}finally{await db.end();}
