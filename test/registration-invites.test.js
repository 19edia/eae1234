import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import express from 'express';
import request from 'supertest';
import {PGlite} from '@electric-sql/pglite';
import {registrationInvitePublicRoutes,registrationInviteStaffRoutes} from '../src/registration-invites.js';
import {memberPortalRoutes} from '../src/member-portal.js';
import {hash,passwordHash,passwordMatches} from '../src/security.js';

const config={origin:'http://localhost:3000',production:false,secret:'registration-invite-test-secret'.repeat(3),divisions:[{id:1,guild:'211111111111111111',name:'DISTRITO ROKUHARA KAGE CLAN'}]};
const password='Minha senha de membro segura 2026!';
let db,pool,app,admin,recruiter,other,sequence=0,ipSequence=0,offline=false,blocked=false;
const codes=[],profiles=new Map();
const fresh=()=>request.agent(app).set('X-Forwarded-For',`127.0.0.${++ipSequence}`);
const staff=(actor=admin)=>fresh().set('X-Test-Staff',String(actor));
const post=(a,path,body,csrf)=>a.post(path).set('Origin',config.origin).set('X-Registration-CSRF',csrf||'').send(body);
async function invitation(body={member_rank:'High member',account_kind:'membro'},actor=admin){
 const response=await post(staff(actor),'/api/registration-invites',body).expect(201);
 const raw=new URL(response.body.url).pathname.split('/').at(-1);
 return {...response.body,raw,path:'/api/registration/'+raw};
}
async function open(invite,agent=fresh()){
 const response=await agent.get(invite.path).expect(200);
 return {invite,agent,csrf:response.body.csrf,data:response.body};
}
function person(){
 const n=++sequence,id=String(311111111111111110n+BigInt(n));
 const profile={id,username:'kage.user'+n,display_name:'Membro '+n,avatar_url:`https://cdn.discordapp.com/avatars/${id}/image.png`};
 profiles.set(id,profile);
 return {profile,details:{name:'Pessoa '+n,game_nick:'Shigaku '+n,roblox_username:'RobloxPessoa'+n}};
}
async function begin(invite,who=person()){
 const browser=await open(invite);
 await post(browser.agent,invite.path+'/draft',who.details,browser.csrf).expect(200);
 await post(browser.agent,invite.path+'/discord/start',{discord_id:who.profile.id},browser.csrf).expect(200);
 return {...browser,...who,code:codes.at(-1).code};
}
async function complete(flow,extra={}){
 return post(flow.agent,flow.invite.path+'/complete',{code:flow.code,password,...extra},flow.csrf);
}
before(async()=>{
 db=new PGlite();
 for(const file of ['schema.sql','district-schema.sql','member-portal-schema.sql','idrkc-schema.sql','verified-services-schema.sql','embed-publications-schema.sql','registration-invites-schema.sql'])await db.exec(await readFile(new URL('../src/'+file,import.meta.url),'utf8'));
 pool={query:async(sql,args)=>{if(sql.includes('pg_advisory_xact_lock'))return {rows:[],rowCount:1};const r=await db.query(sql,args);return {...r,rowCount:r.affectedRows||r.rows.length};},connect:async()=>({...pool,release(){}})};
 const digest=await passwordHash(password);
 admin=(await pool.query("INSERT INTO staff(username,password_hash,role) VALUES('invite-admin',$1,'admin') RETURNING id",[digest])).rows[0].id;
 recruiter=(await pool.query("INSERT INTO staff(username,password_hash,role,discord_id,discord_verified_at) VALUES('invite-recruiter',$1,'recrutador','411111111111111111',now()) RETURNING id",[digest])).rows[0].id;
 other=(await pool.query("INSERT INTO staff(username,password_hash,role,discord_id,discord_verified_at) VALUES('other-recruiter',$1,'recrutador','411111111111111112',now()) RETURNING id",[digest])).rows[0].id;
 app=express();app.set('trust proxy',1);app.use(express.json());
 const bot={ready:()=>!offline,searchRegistrationMembers:async(query)=>[...profiles.values()].filter(p=>p.id===query||p.username.includes(query)),sendMemberSignupCode:async(id,code,name)=>{if(blocked)throw Error('DM closed');codes.push({id,code,name});}};
 registrationInvitePublicRoutes(app,pool,config,bot);
 memberPortalRoutes(app,pool,config,bot);
 app.use('/api',async(req,res,next)=>{const row=(await pool.query('SELECT id,role,active FROM staff WHERE id=$1',[Number(req.get('X-Test-Staff'))||-1])).rows[0];if(!row?.active)return res.sendStatus(401);req.auth={staff_id:row.id,role:row.role};next();});
 registrationInviteStaffRoutes(app,pool,config);
 app.use((error,_req,res,_next)=>res.status(error.status||500).json({error:error.message}));
});
after(async()=>db.close());

test('invites expose only a random one-use URL, freeze rank/kind, and scope lists/revocation to creators',async()=>{
 const a=await invitation(),r=await invitation({member_rank:'Líder',account_kind:'aliado'},recruiter);
 assert.match(a.raw,/^[a-f0-9]{64}$/);assert.equal(a.member_rank,'High member');assert.equal(r.member_rank,'Aliado');
 const row=(await pool.query('SELECT * FROM registration_invites WHERE id=$1',[a.id])).rows[0];
 assert.equal(row.token_hash,hash(a.raw,config.secret));assert.notEqual(row.token_hash,a.raw);
 assert.ok(new Date(a.expires_at).getTime()>Date.now()+47*3600000);
 const own=(await staff(recruiter).get('/api/registration-invites').expect(200)).body;
 assert.deepEqual(own.map(i=>i.id),[r.id]);assert.equal(own[0].token_hash,undefined);assert.equal(own[0].url,undefined);
 await staff(other).delete('/api/registration-invites/'+r.id).expect(404);
 await staff(recruiter).delete('/api/registration-invites/'+r.id).expect(200);
 await fresh().get(r.path).expect(410);await fresh().get('/api/registration/not-a-token').expect(404);
 const publicData=(await open(a)).data;
 assert.equal(publicData.invite.created_by,undefined);assert.equal(publicData.invite.token_hash,undefined);assert.match(publicData.csrf,/^[a-f0-9]{64}$/);
});

test('complete invitation proves Discord, creates verified identity/account, issues isolated member session and queues card once',async()=>{
 const invite=await invitation(),flow=await begin(invite);
 const response=await complete(flow,{member_rank:'Líder',account_kind:'aliado',discord_id:'999999999999999999'});assert.equal(response.status,201,response.text);
 const m=response.body.member;assert.equal(m.discord_id,flow.profile.id);assert.equal(m.member_rank,'High member');assert.equal(m.account_kind,'membro');assert.equal(m.verified,true);assert.match(m.idrkc,/^\d{16}$/);
 for(const field of ['card_secret','ifj','password_hash','token_hash','csrf','created_by'])assert.equal(m[field],undefined,field);
 assert.equal(response.body.card_url,'/api/member/card.png');assert.equal(response.body.redirect,'/membros');
 assert.ok(response.headers['set-cookie'].some(c=>c.startsWith('ifj_member_session=')&&c.includes('HttpOnly')&&c.includes('SameSite=Strict')&&c.includes('Path=/api/member')));
 const stored=(await pool.query('SELECT * FROM members WHERE id=$1',[m.id])).rows[0];
 assert.equal(stored.created_by,admin);assert.equal(stored.migration_required,false);assert.equal(stored.discord_username,flow.profile.username);
 const account=(await pool.query('SELECT * FROM member_accounts WHERE member_id=$1',[m.id])).rows[0];
 assert.notEqual(account.password_hash,password);assert.ok(await passwordMatches(password,account.password_hash));
 assert.equal((await flow.agent.get('/api/member/me').expect(200)).body.member.id,m.id);
 await flow.agent.get('/api/registration-invites').expect(401);
 const png=await flow.agent.get('/api/member/card.png').expect(200).expect('Content-Type',/image\/png/);assert.ok(png.body.length>1000);
 const jobs=(await pool.query('SELECT kind FROM jobs')).rows.map(r=>r.kind);assert.deepEqual(jobs,['sync-role','idrkc-delivery']);
 const consumed=(await pool.query('SELECT consumed_at,member_id FROM registration_invites WHERE id=$1',[invite.id])).rows[0];
 assert.equal(consumed.member_id,m.id);assert.ok(consumed.consumed_at);
 const replay=await complete(flow);assert.equal(replay.status,410);await fresh().get(invite.path).expect(410);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM members WHERE discord_id=$1',[flow.profile.id])).rows[0].n,1);
 await staff(admin).delete('/api/registration-invites/'+invite.id).expect(409);
});

test('public requests require matching origin and cookie-bound CSRF and accept only real server profiles',async()=>{
 const invite=await invitation(),b=await open(invite),who=person();
 await post(b.agent,invite.path+'/draft',who.details,'incorrect').expect(403);
 await b.agent.post(invite.path+'/draft').set('Origin','https://other.example').set('X-Registration-CSRF',b.csrf).send(who.details).expect(403);
 await post(fresh(),invite.path+'/draft',who.details,b.csrf).expect(403);
 await post(b.agent,invite.path+'/discord/search',{query:who.profile.username},b.csrf).expect(400);
 await post(b.agent,invite.path+'/draft',{...who.details,member_rank:'Líder',account_kind:'aliado',allied_gang:'Override'},b.csrf).expect(200);
 const search=(await post(b.agent,invite.path+'/discord/search',{query:who.profile.username},b.csrf).expect(200)).body;
 assert.deepEqual(search.members,[who.profile]);
 await post(b.agent,invite.path+'/discord/start',{discord_id:'555555555555555555'},b.csrf).expect(404);
 await post(b.agent,invite.path+'/discord/start',{discord_id:who.profile.id},b.csrf).expect(200);
 assert.equal(codes.at(-1).id,who.profile.id);
 const row=(await pool.query('SELECT * FROM registration_invite_challenges WHERE invite_id=$1',[invite.id])).rows[0];
 assert.notEqual(row.code_hash,codes.at(-1).code);assert.match(row.nonce_hash,/^[a-f0-9]{64}$/);assert.equal(row.details.member_rank,undefined);assert.equal(row.details.allied_gang,null);
 const another=await open(invite);
 await post(another.agent,invite.path+'/complete',{code:codes.at(-1).code,password},another.csrf).expect(400);
 await post(b.agent,invite.path+'/discord/start',{discord_id:who.profile.id},b.csrf).expect(429);
});

test('five wrong codes are persisted and lock confirmation; expired code cannot create a member',async()=>{
 const flow=await begin(await invitation());
 for(let attempt=0;attempt<5;attempt++){const response=await complete(flow,{code:'000000'});assert.equal(response.status,400);}
 assert.equal((await pool.query('SELECT attempts FROM registration_invite_challenges WHERE invite_id=$1',[flow.invite.id])).rows[0].attempts,5);
 assert.equal((await complete(flow)).status,400);
 const expired=await begin(await invitation());
 await pool.query("UPDATE registration_invite_challenges SET code_expires_at=now()-interval '1 minute' WHERE invite_id=$1",[expired.invite.id]);
 assert.equal((await complete(expired)).status,400);
 assert.equal((await pool.query('SELECT id FROM members WHERE discord_id=$1',[flow.profile.id])).rowCount,0);
});

test('editing personal details invalidates the prior code and cannot silently reuse proof',async()=>{
 const flow=await begin(await invitation());
 await post(flow.agent,flow.invite.path+'/draft',{...flow.details,name:'Nome corrigido'},flow.csrf).expect(200);
 assert.equal((await complete(flow)).status,400);
 const row=(await pool.query('SELECT details,code_hash,discord_id FROM registration_invite_challenges WHERE invite_id=$1',[flow.invite.id])).rows[0];
 assert.equal(row.details.name,'Nome corrigido');assert.equal(row.code_hash,null);assert.equal(row.discord_id,null);
});

test('expired, cancelled or no-longer-authorized invitations cannot create accounts',async()=>{
 const expired=await invitation();
 await pool.query("UPDATE registration_invites SET expires_at=now()-interval '1 minute' WHERE id=$1",[expired.id]);
 await fresh().get(expired.path).expect(410);
 const flow=await begin(await invitation({member_rank:'Membro',account_kind:'membro'},recruiter));
 await pool.query('UPDATE staff SET active=FALSE WHERE id=$1',[recruiter]);
 assert.equal((await complete(flow)).status,410);
 await pool.query('UPDATE staff SET active=TRUE WHERE id=$1',[recruiter]);
 await staff(admin).delete('/api/registration-invites/'+flow.invite.id).expect(200);
 assert.equal((await complete(flow)).status,410);
 const rankFlow=await begin(await invitation());
 await pool.query("UPDATE staff SET role='recrutador',discord_verified_at=now() WHERE id=$1",[admin]);
 assert.equal((await complete(rankFlow)).status,410);
 await pool.query("UPDATE staff SET role='admin' WHERE id=$1",[admin]);
});

test('offline bot, blocked DMs, and leaving the server never complete registration',async()=>{
 const invite=await invitation(),b=await open(invite),who=person();
 await post(b.agent,invite.path+'/draft',who.details,b.csrf).expect(200);
 offline=true;await post(b.agent,invite.path+'/discord/start',{discord_id:who.profile.id},b.csrf).expect(503);offline=false;
 blocked=true;await post(b.agent,invite.path+'/discord/start',{discord_id:who.profile.id},b.csrf).expect(400);blocked=false;
 const row=(await pool.query('SELECT code_hash FROM registration_invite_challenges WHERE invite_id=$1',[invite.id])).rows[0];assert.equal(row.code_hash,null);
 const flow=await begin(await invitation());profiles.delete(flow.profile.id);
 assert.equal((await complete(flow)).status,404);
 assert.equal((await pool.query('SELECT id FROM members WHERE discord_id=$1',[flow.profile.id])).rowCount,0);
});

test('existing Discord and Roblox identities cannot be replaced through a new invitation',async()=>{
 const existing=(await pool.query('SELECT * FROM members ORDER BY id LIMIT 1')).rows[0];
 const invite=await invitation(),b=await open(invite),who=person();
 await post(b.agent,invite.path+'/draft',who.details,b.csrf).expect(200);
 await post(b.agent,invite.path+'/discord/start',{discord_id:existing.discord_id},b.csrf).expect(409);
 await post(b.agent,invite.path+'/draft',{...who.details,roblox_username:existing.roblox_username.toUpperCase()},b.csrf).expect(200);
 await post(b.agent,invite.path+'/discord/start',{discord_id:who.profile.id},b.csrf).expect(409);
 const original=(await pool.query('SELECT * FROM members WHERE id=$1',[existing.id])).rows[0];
 assert.equal(original.idrkc,existing.idrkc);assert.equal(original.name,existing.name);
});

test('allied invitations require their gang and preserve issuer-controlled rank without exposing secrets on resume',async()=>{
 const invite=await invitation({member_rank:'Aliado',account_kind:'aliado'}),b=await open(invite),who=person();
 await post(b.agent,invite.path+'/draft',{name:who.details.name},b.csrf).expect(400);
 const details={name:who.details.name,allied_gang:'Ryuketsu'};
 await post(b.agent,invite.path+'/draft',details,b.csrf).expect(200);
 await post(b.agent,invite.path+'/discord/start',{discord_id:who.profile.id},b.csrf).expect(200);
 const code=codes.at(-1).code;
 const resumed=(await b.agent.get(invite.path).expect(200)).body;
 assert.equal(resumed.details.allied_gang,'Ryuketsu');assert.equal(resumed.discord.id,who.profile.id);assert.equal(resumed.verification.code_sent,true);
 for(const field of ['code','code_hash','nonce_hash','password_hash'])assert.equal(resumed[field],undefined);
 const flow={...b,...who,code};
 const response=await complete(flow);assert.equal(response.status,201,response.text);assert.equal(response.body.member.account_kind,'aliado');assert.equal(response.body.member.member_rank,'Aliado');
 const stored=(await pool.query('SELECT allied_gang FROM members WHERE id=$1',[response.body.member.id])).rows[0];assert.equal(stored.allied_gang,'Ryuketsu');
});

