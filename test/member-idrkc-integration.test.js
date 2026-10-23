import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import request from 'supertest';
import {createApp} from '../src/app.js';
import {initialize,tx} from '../src/db.js';
import {passwordHash} from '../src/security.js';
import {createEmbedPublications} from '../src/embed-publications.js';

const password='Senha segura ROKUHARA 2026!',origin='http://localhost:3000';
const config={origin,production:false,sbi:true,secret:'member-idrkc-integration-secret'.repeat(3),divisions:[{id:1,name:'DISTRITO ROKUHARA KAGE CLAN',guild:'211111111111111111',news:'222222222222222222'}]};
const env={INITIAL_ADMIN_USERNAME:'root-kage',INITIAL_ADMIN_PASSWORD:password,BOT_ENABLED:'false'};
let db,pool,app,staff,staffCsrf,legacy,legacyAccount,passwordDigest,memberCounter=0;
const codes=[];
const post=(agent,path,body,csrf)=>{let req=agent.post(path).set('Origin',origin).send(body);if(csrf)req=req.set('X-CSRF-Token',csrf);return req;};
const staffRequest=(method,path,body,csrf=staffCsrf)=>staff[method](path).set('Origin',origin).set('X-CSRF-Token',csrf).send(body);
const noSigningKey=value=>{assert.equal(JSON.stringify(value).includes('card_secret'),false);};
async function member(){const n=++memberCounter;return (await pool.query('INSERT INTO members(ifj,name,game_nick,roblox_username,discord_id,division,verified) VALUES($1,$2,$3,$4,$5,1,true) RETURNING *',[String(n+100).padStart(15,'0'),`Membro ${n}`,`Shigaku${n}`,`RobloxNovo${n}`,String(233333333333333330n+BigInt(n))])).rows[0];}
async function register(m){
 const agent=request.agent(app);
 await post(agent,'/api/member/register/start',{idrkc:m.idrkc,password}).expect(200);
 assert.equal(codes.at(-1).discordId,m.discord_id);
 await post(agent,'/api/member/register/confirm',{code:codes.at(-1).code}).expect(201);
 const me=(await agent.get('/api/member/me').expect(200)).body;return {agent,me};
}
before(async()=>{
 db=new PGlite();
 for(const name of ['schema.sql','member-portal-schema.sql'])await db.exec(await readFile(new URL('../src/'+name,import.meta.url),'utf8'));
 pool={query:async(sql,args)=>{
  if(typeof sql==='object'){const results=await db.exec(sql.text);const result=results.at(-1)||{rows:[]};return {...result,rowCount:result.affectedRows||result.rows?.length||0};}
  if(sql.includes('pg_advisory_xact_lock'))return {rows:[],rowCount:1};
  const result=await db.query(sql,args);return {...result,rowCount:result.affectedRows||result.rows.length};
 },connect:async()=>({...pool,release(){}})};
 passwordDigest=await passwordHash(password);
 legacy=(await pool.query("INSERT INTO members(ifj,name,game_nick,roblox_username,discord_id,division,verified) VALUES('012345678901234','Titular legado','Nick antigo','RobloxLegado','244444444444444444',1,true) RETURNING *")).rows[0];
 legacyAccount=(await pool.query('INSERT INTO member_accounts(member_id,discord_id,password_hash) VALUES($1,$2,$3) RETURNING *',[legacy.id,legacy.discord_id,passwordDigest])).rows[0];
 await initialize(pool,env);
 legacy=(await pool.query('SELECT * FROM members WHERE id=$1',[legacy.id])).rows[0];
 app=createApp(pool,config,{ready:()=>true,sendMemberSignupCode:async(discordId,code,name)=>{codes.push({discordId,code,name});}});
 staff=request.agent(app);await post(staff,'/api/auth/login',{username:env.INITIAL_ADMIN_USERNAME,password}).expect(200);staffCsrf=(await staff.get('/api/me').expect(200)).body.csrf;
});
after(async()=>db?.close());

test('real initialization upgrades legacy accounts and remains repeatable without changing their IDRKC or password',async()=>{
 const initial={...legacy};assert.match(initial.idrkc,/^\d{16}$/);assert.match(initial.card_secret,/^[\da-f-]{36}$/);assert.equal(initial.verified,true);
 await initialize(pool,env);await initialize(pool,env);
 const current=(await pool.query('SELECT * FROM members WHERE id=$1',[legacy.id])).rows[0],account=(await pool.query('SELECT * FROM member_accounts WHERE id=$1',[legacyAccount.id])).rows[0];
 for(const key of ['id','name','ifj','idrkc','card_secret','identity_version','discord_id','verified'])assert.equal(current[key],initial[key],key);
 assert.equal(account.member_id,legacy.id);assert.equal(account.password_hash,passwordDigest);assert.equal(account.discord_id,legacy.discord_id);
 assert.equal((await pool.query("SELECT count(*)::int n FROM staff WHERE username='root-kage'")).rows[0].n,1);
 assert.equal((await pool.query('SELECT count(*)::int n FROM used_idrkcs WHERE idrkc=$1',[initial.idrkc])).rows[0].n,1);
});
test('existing account logs in with both its new IDRKC and legacy 15-digit IFJ without resetting password',async()=>{
 for(const credentials of [{idrkc:legacy.idrkc},{ifj:legacy.ifj},{idrkc:legacy.idrkc.match(/.{4}/g).join(' ')}]){
  const agent=request.agent(app);await post(agent,'/api/member/login',{...credentials,password}).expect(200);
  const me=(await agent.get('/api/member/me').expect(200)).body;assert.equal(me.member.id,legacy.id);assert.equal(me.member.idrkc,legacy.idrkc);assert.equal(me.member.ifj,undefined);noSigningKey(me);
 }
 await post(request.agent(app),'/api/member/login',{idrkc:legacy.idrkc,password:'senha incorreta'}).expect(401);
 await post(request.agent(app),'/api/member/login',{idrkc:'123',password}).expect(400);
});
test('administrative create, list and nested update responses hide signing keys and reject supplied identity overrides',async()=>{
 const body={name:'Novo integrante',game_nick:'Novo Shigaku',roblox_username:'NovoRoblox2026',discord_id:'255555555555555555',division:1,member_rank:'Membro',idrkc:'9999999999999999',card_secret:'11111111-1111-1111-1111-111111111111'};
 const created=(await staffRequest('post','/api/members',body).expect(201)).body;noSigningKey(created);assert.match(created.idrkc,/^\d{16}$/);assert.notEqual(created.idrkc,body.idrkc);
 const stored=(await pool.query('SELECT * FROM members WHERE id=$1',[created.id])).rows[0];assert.notEqual(stored.card_secret,body.card_secret);assert.ok(stored.card_secret);
 const list=(await staff.get('/api/members').expect(200)).body;noSigningKey(list);assert.equal(JSON.stringify(list).includes(stored.card_secret),false);assert.ok(list.find(m=>m.id===created.id));
 const updated=(await staffRequest('patch',`/api/members/${created.id}`,{identity_version:created.identity_version,member_rank:'High member',idrkc:body.idrkc,card_secret:body.card_secret}).expect(200)).body;
 noSigningKey(updated);assert.equal(updated.member.idrkc,created.idrkc);assert.equal(updated.member.member_rank,'High member');assert.equal(updated.member.identity_version,created.identity_version+1);
 const after=(await pool.query('SELECT * FROM members WHERE id=$1',[created.id])).rows[0];assert.equal(after.card_secret,stored.card_secret);
 const registered=await register(after);assert.equal(registered.me.member.idrkc,created.idrkc);noSigningKey(registered.me);
});
test('IDRKC registration binds the registered Discord, hashes the challenge, and cannot register an arbitrary identity',async()=>{
 const m=await member(),agent=request.agent(app);
 const start=await post(agent,'/api/member/register/start',{idrkc:m.idrkc,password,discord_id:'266666666666666666'}).expect(200);assert.equal(start.body.code,undefined);assert.equal(codes.at(-1).discordId,m.discord_id);
 const challenge=(await pool.query('SELECT * FROM member_signup_challenges WHERE member_id=$1',[m.id])).rows[0];assert.notEqual(challenge.code_hash,codes.at(-1).code);assert.notEqual(challenge.password_hash,password);
 await post(agent,'/api/member/register/confirm',{code:codes.at(-1).code}).expect(201);
 const me=(await agent.get('/api/member/me').expect(200)).body;assert.equal(me.member.idrkc,m.idrkc);assert.equal(me.member.discord_id,m.discord_id);noSigningKey(me);assert.equal(me.member.token_hash,undefined);assert.equal(me.member.password_hash,undefined);
 await post(request.agent(app),'/api/member/register/start',{idrkc:'9999999999999999',password}).expect(404);
 const again=request.agent(app);await post(again,'/api/member/login',{idrkc:m.idrkc,password}).expect(200);assert.equal((await again.get('/api/member/me')).body.member.id,m.id);
});
test('member and staff sessions and CSRF remain isolated even in one browser',async()=>{
 const m=await member(),{agent,me}=await register(m);assert.notEqual(me.csrf,staffCsrf);
 await agent.get('/api/members').expect(401);await staff.get('/api/member/me').expect(401);
 await post(agent,'/api/member/logout',{},staffCsrf).expect(403);await agent.get('/api/member/me').expect(200);
 await post(agent,'/api/auth/login',{username:env.INITIAL_ADMIN_USERNAME,password}).expect(200);const admin=(await agent.get('/api/me').expect(200)).body;
 await agent.post('/api/members').set('Origin',origin).set('X-CSRF-Token',me.csrf).send({}).expect(403);
 await post(agent,'/api/member/logout',{},admin.csrf).expect(403);await post(agent,'/api/member/logout',{},me.csrf).expect(200);
 await agent.get('/api/member/me').expect(401);await agent.get('/api/me').expect(200);
});
test('member service history contains only reports they submitted and their own tickets',async()=>{
 const own=await member(),other=await member(),{agent}=await register(own);
 const ownReport=(await pool.query("INSERT INTO reports(subject,reporter_id,reporter_member_id,division,reason,status,resolution) VALUES('Caso próprio',$1,$2,1,'Detalhe administrativo','resolvida','Analisado pela administração') RETURNING id",[own.discord_id,own.id])).rows[0];
 const otherReport=(await pool.query("INSERT INTO reports(member_id,subject,reporter_id,reporter_member_id,division,reason) VALUES($1,'Caso de outra pessoa',$2,$3,1,'Conteúdo reservado') RETURNING id",[own.id,other.discord_id,other.id])).rows[0];
 const ownTicket=(await pool.query("INSERT INTO tickets(guild_id,user_id,channel_id,member_id,status) VALUES($1,$2,'277777777777777777',$3,'aberto') RETURNING id",[config.divisions[0].guild,own.discord_id,own.id])).rows[0];
 const closed=(await pool.query("INSERT INTO tickets(guild_id,user_id,channel_id,member_id,status) VALUES($1,$2,'288888888888888888',$3,'resolvido') RETURNING id",[config.divisions[0].guild,own.discord_id,own.id])).rows[0];
 const otherTicket=(await pool.query("INSERT INTO tickets(guild_id,user_id,channel_id,member_id,status) VALUES($1,$2,'299999999999999999',$3,'aberto') RETURNING id",[config.divisions[0].guild,other.discord_id,other.id])).rows[0];
 const cases=(await agent.get('/api/member/services').expect(200)).body;
 assert.deepEqual(cases.reports.map(r=>r.id),[ownReport.id]);assert.equal(cases.reports.some(r=>r.id===otherReport.id),false);assert.equal(cases.reports[0].resolution,'Analisado pela administração');assert.equal(cases.reports[0].reason,undefined);
 assert.deepEqual(new Set(cases.tickets.map(t=>t.id)),new Set([ownTicket.id,closed.id]));assert.equal(cases.tickets.some(t=>t.id===otherTicket.id),false);
 assert.equal(cases.tickets.find(t=>t.id===closed.id).channel_url,null);assert.equal(cases.tickets.find(t=>t.id===ownTicket.id).channel_url,`https://discord.com/channels/${config.divisions[0].guild}/277777777777777777`);noSigningKey(cases);
 await request(app).get('/api/member/services').expect(401);
});
test('members see exactly the delivered embed payload and no pending or failed publications',async()=>{
 const m=await member(),{agent}=await register(m),payload={content:'Notícia oficial',embeds:[{title:'Novidade IDRKC',description:'**Carteiras novas** disponíveis!',color:'#f58a3c',fields:[{name:'Distrito',value:'ROKUHARA KAGE CLAN',inline:true}],footer:{text:'Administração'}}]};
 const pending=(await staffRequest('post','/api/embed-publications',{payload,request_id:randomUUID()}).expect(202)).body;
 const failed=(await staffRequest('post','/api/embed-publications',{payload:{title:'Falhou'},request_id:randomUUID()}).expect(202)).body;
 await pool.query("UPDATE jobs SET status='failed',error='Indisponível' WHERE id=$1",[failed.job_id]);
 assert.deepEqual((await agent.get('/api/member/embeds').expect(200)).body,[]);
 const sent=[];const service=createEmbedPublications(pool,config,{channels:{fetch:async()=>({guildId:config.divisions[0].guild,isTextBased:()=>true,send:async body=>{sent.push(body);return {id:'233333333333333333'};}})}});
 await tx(pool,async c=>{const job=(await c.query('SELECT * FROM jobs WHERE id=$1',[pending.job_id])).rows[0];await service.execute(job,c);await c.query("UPDATE jobs SET status='sent' WHERE id=$1",[pending.job_id]);});
 const feed=(await agent.get('/api/member/embeds').expect(200)).body;assert.equal(feed.length,1);assert.equal(feed[0].id,pending.id);assert.deepEqual(feed[0].payload,pending.payload);
 const {nonce,enforceNonce,...discordPayload}=sent[0];assert.deepEqual(feed[0].payload,discordPayload);assert.equal(feed[0].payload.embeds[0].color,0xf58a3c);assert.equal(feed[0].error,undefined);assert.equal(feed[0].job_id,undefined);noSigningKey(feed);
 await request(app).get('/api/member/embeds').expect(401);
});
