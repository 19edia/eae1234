import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import request from 'supertest';
import {PGlite} from '@electric-sql/pglite';
import {createApp} from '../src/app.js';
import {hash,token} from '../src/security.js';

const config={origin:'http://localhost:3000',production:false,secret:'profile-route-test-secret'.repeat(3),divisions:[{id:1,guild:'211111111111111111',name:'DISTRITO ROKUHARA KAGE CLAN'}]};
const calls=[];
let db,pool,app,seq=0,profileMode='normal';
const discordId=()=>String(611111111111111110n+BigInt(++seq));
const get=(url,cookie)=>{const req=request(app).get(url);return cookie?req.set('Cookie',cookie):req;};
async function staff({role='admin',linked=true,active=true}={}){
 const id=discordId();
 const row=(await pool.query('INSERT INTO staff(username,password_hash,role,discord_id,discord_verified_at,active) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',['staff'+seq,'unused-password',role,id,linked?new Date():null,active])).rows[0];
 const value=token();
 await pool.query("INSERT INTO sessions(token_hash,staff_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",[hash(value,config.secret),row.id,token()]);
 return {...row,cookie:'ifj_session='+value};
}
async function member({createdBy=null,active=true}={}){
 const id=discordId();
 const row=(await pool.query('INSERT INTO members(ifj,name,game_nick,roblox_username,discord_id,division,verified,created_by) VALUES($1,$2,$3,$4,$5,1,TRUE,$6) RETURNING *',[String(seq).padStart(15,'0'),'Nome escolhido '+seq,'Shigaku '+seq,'Roblox'+seq,id,createdBy])).rows[0];
 const account=(await pool.query('INSERT INTO member_accounts(member_id,discord_id,password_hash,active) VALUES($1,$2,$3,$4) RETURNING *',[row.id,id,'unused-password',active])).rows[0];
 const value=token();
 await pool.query("INSERT INTO member_sessions(token_hash,account_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",[hash(value,config.secret),account.id,token()]);
 return {...row,accountId:account.id,cookie:'ifj_member_session='+value,tokenHash:hash(value,config.secret)};
}
before(async()=>{
 db=new PGlite();
 for(const file of ['schema.sql','district-schema.sql','member-portal-schema.sql','idrkc-schema.sql'])await db.exec(await readFile(new URL('../src/'+file,import.meta.url),'utf8'));
 pool={query:async(sql,args)=>{const r=await db.query(sql,args);return {...r,rowCount:r.affectedRows||r.rows.length};},connect:async()=>({...pool,release(){}})};
 const bot={getDiscordProfile:async id=>{
  calls.push(id);
  if(profileMode==='throw')throw Error('Private upstream failure');
  if(profileMode==='null')return null;
  return {id:profileMode==='wrong-id'?'999999999999999999':id,username:'discord-handle',display_name:'Nome diferente no Discord',avatar_url:'https://cdn.discordapp.com/avatars/'+id+'/avatar.png',token:'must-not-leak',email:'private@example.test'};
 }};
 app=createApp(pool,config,bot);
});
beforeEach(()=>{calls.length=0;profileMode='normal';});
after(async()=>db.close());

test('profile routes reject unauthenticated, malformed and nonexistent sessions before contacting Discord',async()=>{
 for(const url of ['/api/discord-profile','/api/member/discord-profile','/api/members/discord-profiles?ids=1']){
  await get(url).expect(401);
  await get(url,'ifj_session=bad; ifj_member_session=bad').expect(401);
  await get(url,'ifj_session='+'a'.repeat(64)+'; ifj_member_session='+'b'.repeat(64)).expect(401);
 }
 assert.deepEqual(calls,[]);
});

test('confirmed staff profile is restricted to the session identity and exposes only profile fields',async()=>{
 for(const role of ['admin','sublider','moderador','recrutador']){
  const user=await staff({role});
  const result=await get('/api/discord-profile?discord_id=999999999999999999&id=999999999999999999',user.cookie).expect(200);
  assert.equal(result.body.linked,true);assert.equal(result.body.profile.id,user.discord_id);
  assert.deepEqual(Object.keys(result.body.profile).sort(),['avatar_url','display_name','id','username']);
  assert.equal(calls.at(-1),user.discord_id);
  const me=(await get('/api/me',user.cookie).expect(200)).body;
  assert.equal(me.username,user.username);assert.equal(me.role,role);
 }
 assert.equal(calls.length,4);
});

test('an unconfirmed staff Discord never loads a photo, including administrators and supplied query IDs',async()=>{
 for(const role of ['admin','recrutador']){
  const user=await staff({role,linked:false});
  const result=await get('/api/discord-profile?discord_id=999999999999999999',user.cookie).expect(200);
  assert.deepEqual(result.body,{linked:false,profile:null});
 }
 const disabled=await staff({active:false});
 await get('/api/discord-profile',disabled.cookie).expect(401);
 assert.deepEqual(calls,[]);
});

test('members get their linked Discord photo while keeping the name they chose at registration',async()=>{
 const user=await member();
 const result=(await get('/api/member/discord-profile?discord_id=999999999999999999',user.cookie).expect(200)).body;
 assert.equal(result.linked,true);assert.equal(result.profile.id,user.discord_id);
 assert.equal(result.profile.display_name,'Nome diferente no Discord');
 const me=(await get('/api/member/me',user.cookie).expect(200)).body;
 assert.equal(me.member.name,user.name);assert.notEqual(me.member.name,result.profile.display_name);
 assert.equal(me.member.discord_id,user.discord_id);
 assert.equal((await pool.query('SELECT name FROM members WHERE id=$1',[user.id])).rows[0].name,user.name);
 assert.deepEqual(calls,[user.discord_id]);
 // A member cookie does not grant administrative photo access.
 await get('/api/discord-profile',user.cookie).expect(401);
 await get('/api/members/discord-profiles?ids='+user.id,user.cookie).expect(401);
 assert.equal(calls.length,1);
});

test('old member sessions cannot fetch photos after Discord changes, expiry or account deactivation',async()=>{
 const moved=await member(),inactive=await member({active:false}),expired=await member();
 await pool.query('UPDATE members SET discord_id=$1 WHERE id=$2',[discordId(),moved.id]);
 await pool.query("UPDATE member_sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1",[expired.tokenHash]);
 for(const user of [moved,inactive,expired]){
  await get('/api/member/discord-profile',user.cookie).expect(401);
  await get('/api/member/me',user.cookie).expect(401);
 }
 assert.deepEqual(calls,[]);
});

test('batch member photos enforce recruiter/moderator ownership before contacting Discord; administrators see all',async()=>{
 const recruiter=await staff({role:'recrutador'}),moderator=await staff({role:'moderador'}),admin=await staff(),subleader=await staff({role:'sublider'});
 const first=await member({createdBy:recruiter.id}),second=await member({createdBy:moderator.id});
 const url='/api/members/discord-profiles?ids='+[first.id,second.id,2147483647].join(',');
 for(const [actor,visible]of [[recruiter,first],[moderator,second]]){
  calls.length=0;
  const result=(await get(url,actor.cookie).expect(200)).body;
  assert.deepEqual(Object.keys(result.profiles),[String(visible.id)]);
  assert.equal(result.profiles[visible.id].id,visible.discord_id);
  assert.deepEqual(calls,[visible.discord_id]);
 }
 for(const actor of [admin,subleader]){
  calls.length=0;
  const result=(await get(url,actor.cookie).expect(200)).body;
  assert.deepEqual(Object.keys(result.profiles).sort(),[String(first.id),String(second.id)].sort());
  assert.deepEqual([...calls].sort(),[first.discord_id,second.discord_id].sort());
 }
 const listed=(await get('/api/members',recruiter.cookie).expect(200)).body;
 assert.equal(listed.find(m=>m.id===first.id).name,first.name);
 assert.equal(listed.some(m=>m.id===second.id),false);
});

test('batch lookup validates its 20-record bound, deduplicates and refuses arbitrary Discord IDs',async()=>{
 const admin=await staff(),own=await member({createdBy:admin.id});
 const endpoint='/api/members/discord-profiles';
 for(const query of ['', '?ids=', '?ids=0','?ids=-1','?ids=1.5','?ids=1e3','?ids=2147483648','?ids='+own.discord_id,'?ids=1&ids=2','?ids='+Array(21).fill(own.id).join(','),'?ids=1%20OR%201=1'])await get(endpoint+query,admin.cookie).expect(400);
 assert.deepEqual(calls,[]);
 const result=(await get(endpoint+'?ids='+Array(20).fill(own.id).join(','),admin.cookie).expect(200)).body;
 assert.deepEqual(Object.keys(result.profiles),[String(own.id)]);assert.deepEqual(calls,[own.discord_id]);
});

test('Discord outages, missing profiles and mismatched IDs return null without breaking account endpoints or leaking data',async()=>{
 const admin=await staff(),user=await member({createdBy:admin.id});
 for(const mode of ['throw','null','wrong-id']){
  profileMode=mode;
  const staffResult=(await get('/api/discord-profile',admin.cookie).expect(200)).body;
  const memberResult=(await get('/api/member/discord-profile',user.cookie).expect(200)).body;
  const batchResult=(await get('/api/members/discord-profiles?ids='+user.id,admin.cookie).expect(200)).body;
  assert.deepEqual(staffResult,{linked:true,profile:null});assert.deepEqual(memberResult,{linked:true,profile:null});
  assert.deepEqual(batchResult,{profiles:{[user.id]:null}});
  const me=(await get('/api/member/me',user.cookie).expect(200)).body;
  assert.equal(me.member.name,user.name);
  assert.equal((await get('/api/me',admin.cookie).expect(200)).body.username,admin.username);
  assert.equal(JSON.stringify([staffResult,memberResult,batchResult]).includes('Private upstream'),false);
 }
});
