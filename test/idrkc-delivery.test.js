import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createIdrkcDelivery} from '../src/idrkc-delivery.js';
import {tx} from '../src/db.js';

const guildId='111111111111111111';
const config={divisions:[{id:1,guild:guildId,name:'GUILDA HRISTE BOZE'}]};
let db,pool,service,counter=0,blocked=false,rendered=0;
const present=new Set(),sent=[];
async function member({verified=true,revoked=false,inGuild=true}={}){
 const n=++counter,discord=String(820000000000000000n+BigInt(n));
 const m=(await pool.query("INSERT INTO members(ifj,name,game_nick,discord_id,division,verified,card_revoked_at) VALUES($1,$2,$2,$3,1,$4,$5) RETURNING *",[String(n).padStart(15,'0'),'Titular '+n,discord,verified,revoked?new Date():null])).rows[0];
 if(inGuild)present.add(discord);return m;
}
const delivery=async m=>(await pool.query('SELECT * FROM idrkc_deliveries WHERE member_id=$1 ORDER BY identity_version DESC',[m.id])).rows[0];
const jobFor=async m=>(await pool.query('SELECT * FROM jobs WHERE id=$1',[(await delivery(m)).job_id])).rows[0];
const run=async m=>tx(pool,c=>jobFor(m).then(job=>service.execute(job,c)));
before(async()=>{
 db=new PGlite();for(const file of ['schema.sql','idrkc-schema.sql','verified-services-schema.sql'])await db.exec(await readFile(new URL('../src/'+file,import.meta.url),'utf8'));
 pool={query:async(sql,args)=>{const r=await db.query(sql,args);return {...r,rowCount:r.affectedRows||r.rows.length};},connect:async()=>({...pool,release(){}})};
 const client={guilds:{fetch:async id=>{assert.equal(id,guildId);return {members:{fetch:async options=>{
  assert.equal(options.force,true);if(!present.has(options.user))throw Object.assign(Error('Absent'),{code:10007});
  return {user:{id:options.user,bot:false,send:async payload=>{if(blocked)throw Object.assign(Error('DM blocked'),{code:50007});sent.push({id:options.user,payload});return {id:'delivery-'+sent.length};}}};
 }}};}}};
 service=createIdrkcDelivery(pool,config,client,{render:async m=>{rendered++;assert.match(m.idrkc,/^\d{16}$/);assert.ok(m.card_secret);return Buffer.from('png-fixture');}});
});
after(async()=>db.close());

test('rollout queues each verified, non-revoked identity once and verifies actual guild membership before sending',async()=>{
 const active=await member(),absent=await member({inGuild:false}),unverified=await member({verified:false}),revoked=await member({revoked:true});
 await service.schedule();await service.schedule();
 assert.equal((await pool.query('SELECT * FROM idrkc_deliveries')).rowCount,2);
 assert.equal(await delivery(unverified),undefined);assert.equal(await delivery(revoked),undefined);
 await run(absent);assert.equal((await delivery(absent)).status,'absent');assert.equal(rendered,0);assert.equal(sent.length,0);
 await run(active);const record=await delivery(active);assert.equal(record.status,'sent');assert.equal(record.message_id,'delivery-1');assert.equal(sent[0].id,active.discord_id);
 assert.match(sent[0].payload.files[0].name,new RegExp(`HB-ID-${active.idrkc}-v1`));assert.deepEqual(sent[0].payload.allowedMentions,{parse:[]});assert.equal(sent[0].payload.enforceNonce,true);
 assert.equal((await pool.query('SELECT message_id FROM jobs WHERE id=$1',[record.job_id])).rows[0].message_id,'delivery-1');
 await run(active);await service.schedule(active.discord_id);assert.equal(sent.length,1);
});

test('member joining later reactivates the existing absent job instead of creating another identity or delivery',async()=>{
 const m=await member({inGuild:false});await service.schedule(m.discord_id);const before=await delivery(m);await run(m);assert.equal((await delivery(m)).status,'absent');
 await pool.query("UPDATE jobs SET status='sent',attempts=1 WHERE id=$1",[before.job_id]);present.add(m.discord_id);await service.schedule(m.discord_id);
 const after=await delivery(m);assert.equal(after.id,before.id);assert.equal(after.job_id,before.job_id);assert.equal(after.status,'pending');assert.equal((await jobFor(m)).status,'pending');
 const count=sent.length;await run(m);assert.equal(sent.length,count+1);assert.equal((await delivery(m)).status,'sent');
});

test('blocked DM is retryable with the same nonce, HB-ID and delivery row',async()=>{
 const m=await member();await service.schedule(m.discord_id);const initial=await delivery(m),count=sent.length;
 blocked=true;await assert.rejects(run(m),error=>error.code===50007);blocked=false;
 assert.equal((await delivery(m)).status,'pending');assert.equal((await delivery(m)).message_id,null);assert.equal(sent.length,count);
 await run(m);assert.equal(sent.length,count+1);assert.equal(sent.at(-1).payload.nonce,`idrkc-${initial.id}`);assert.equal((await delivery(m)).id,initial.id);
});

test('queued delivery rechecks version, owner, verified state, revocation and current district',async()=>{
 for(const change of ["identity_version=identity_version+1","discord_id='899999999999999999'","verified=FALSE","card_revoked_at=now()"]){
  const m=await member();await service.schedule(m.discord_id);const count=sent.length;
  await pool.query(`UPDATE members SET ${change} WHERE id=$1`,[m.id]);await run(m);assert.equal(sent.length,count,change);assert.equal((await delivery(m)).status,'superseded',change);
 }
 const m=await member();await service.schedule(m.discord_id);const count=sent.length,old=config.divisions;config.divisions=[];
 try{await run(m);assert.equal(sent.length,count);assert.equal((await delivery(m)).status,'superseded');}finally{config.divisions=old;}
});

test('an updated verified identity receives the new revision once after scheduling',async()=>{
 const m=await member();await service.schedule(m.discord_id);await run(m);const first=await delivery(m),count=sent.length;
 await pool.query('UPDATE members SET identity_version=identity_version+1 WHERE id=$1',[m.id]);await service.schedule(m.discord_id);await service.schedule(m.discord_id);const next=await delivery(m);
 assert.notEqual(next.id,first.id);assert.equal(next.identity_version,2);await run(m);await run(m);assert.equal(sent.length,count+1);assert.match(sent.at(-1).payload.files[0].name,/-v2\.png$/);
});
