import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {passwordHash} from './security.js';
import {StartupError} from './preflight.js';
export function database(url){return new pg.Pool({connectionString:url,max:10,connectionTimeoutMillis:10000,query_timeout:15000,statement_timeout:12000});}
export async function tx(pool,fn){const c=await pool.connect();let rollbackError;try{await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result;}catch(e){try{await c.query('ROLLBACK');}catch(failure){rollbackError=failure;}throw e;}finally{c.release(rollbackError);}}
export async function audit(c,actor,action,detail={}){await c.query('INSERT INTO audit(actor,action,detail) VALUES($1,$2,$3)',[String(actor),action,JSON.stringify(detail)]);}
export async function enqueue(c,kind,payload){return (await c.query('INSERT INTO jobs(kind,payload) VALUES($1,$2) RETURNING id',[kind,JSON.stringify(payload)])).rows[0].id;}
export async function enqueueRoleReconciliation(c){
 return c.query("INSERT INTO jobs(kind,payload) SELECT 'sync-role',jsonb_build_object('discordId',admitted.discord_id) FROM (SELECT discord_id FROM members UNION SELECT participant_id AS discord_id FROM tryout_sessions WHERE status='passed' AND registration_deadline>now()) admitted WHERE NOT EXISTS (SELECT 1 FROM jobs j WHERE j.kind='sync-role' AND j.status='pending' AND j.payload->>'discordId'=admitted.discord_id)");
}
export async function initialize(pool,env=process.env){
 await tx(pool,async c=>{
 await c.query('SELECT pg_advisory_xact_lock(735190247)');
 await c.query("SET LOCAL statement_timeout = '60s'");
 await c.query("SET LOCAL lock_timeout = '15s'");
 for(const name of ['schema.sql','district-schema.sql','sbi-schema.sql','member-portal-schema.sql','idrkc-schema.sql','verified-services-schema.sql','embed-publications-schema.sql','registration-invites-schema.sql','card-login-schema.sql','tryouts-schema.sql'])await c.query({text:await readFile(new URL(name,import.meta.url),'utf8'),query_timeout:75000});
 if((await c.query('SELECT id FROM staff LIMIT 1')).rowCount===0){
  if(!env.INITIAL_ADMIN_USERNAME || (env.INITIAL_ADMIN_PASSWORD||'').length<12)throw new StartupError('Configure o primeiro administrador e uma senha com pelo menos 12 caracteres.');
  await c.query("INSERT INTO staff(username,password_hash,role) VALUES($1,$2,'admin') ON CONFLICT(username) DO NOTHING",[env.INITIAL_ADMIN_USERNAME.toLowerCase(),await passwordHash(env.INITIAL_ADMIN_PASSWORD)]);
 }
 if(env.BOT_ENABLED!=='false')await enqueueRoleReconciliation(c);
 });
}
