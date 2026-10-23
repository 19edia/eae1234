import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import express from 'express';
import request from 'supertest';
import {PGlite} from '@electric-sql/pglite';
import {memberPortalRoutes} from '../src/member-portal.js';
import {officialNoticeRoutes} from '../src/official-notices.js';
import {passwordHash} from '../src/security.js';

const config={origin:'http://localhost:3000',production:false,secret:'test-member-secret'.repeat(4),divisions:[{id:1,name:'GUILDA HRISTE BOZE'}]};
const password='Minha senha segura 2026';
let db,pool,app,offline=false,blocked=false,memberCounter=0,clientCounter=0,adminId;
const codes=[];
const post=(agent,path,body)=>agent.post('/api/member'+path).set('Origin',config.origin).send(body);
const client=()=>request.agent(app).set('X-Forwarded-For',`127.0.0.${++clientCounter}`);
async function member(verified=true){const n=++memberCounter;return (await pool.query('INSERT INTO members(ifj,name,game_nick,roblox_username,discord_id,division,verified) VALUES($1,$2,$3,$4,$5,1,$6) RETURNING *',[String(n).padStart(15,'0'),'Pessoa '+n,'Shigaku'+n,'Roblox'+n,String(81000000000000000n+BigInt(n)),verified])).rows[0];}
async function register(m){const agent=client();await post(agent,'/register/start',{ifj:m.ifj,password}).expect(200);const confirm=await post(agent,'/register/confirm',{code:codes.at(-1).code}).expect(201);return {agent,confirm,me:(await agent.get('/api/member/me').expect(200)).body};}
const admin=(method,path,body,role='admin')=>request(app)[method]('/api/official-notices'+path).set('Origin',config.origin).set('X-Test-Role',role).set('X-CSRF-Token','staff-csrf').send(body);
before(async()=>{
 db=new PGlite();
 for(const file of ['schema.sql','district-schema.sql','member-portal-schema.sql','idrkc-schema.sql','verified-services-schema.sql','embed-publications-schema.sql'])await db.exec(await readFile(new URL('../src/'+file,import.meta.url),'utf8'));
 pool={query:async(sql,args)=>{const r=await db.query(sql,args);return {...r,rowCount:r.affectedRows||r.rows.length};},connect:async()=>({...pool,release(){}})};
 adminId=(await pool.query("INSERT INTO staff(username,password_hash,role) VALUES('notice-admin',$1,'admin') RETURNING id",[await passwordHash(password)])).rows[0].id;
 app=express();app.set('trust proxy',1);app.use(express.json());
 app.use('/api',(req,res,next)=>!['GET','HEAD','OPTIONS'].includes(req.method)&&req.get('origin')!==config.origin?res.status(403).json({error:'Origem não autorizada.'}):next());
 memberPortalRoutes(app,pool,config,{ready:()=>!offline,sendMemberSignupCode:async(id,code,name)=>{if(blocked)throw Error('closed DM');codes.push({id,code,name});}});
 app.use('/api',(req,res,next)=>{if(!req.get('X-Test-Role'))return res.status(401).json({error:'Staff only'});req.auth={role:req.get('X-Test-Role'),staff_id:adminId,csrf:'staff-csrf'};if(req.method!=='GET'&&req.get('X-CSRF-Token')!==req.auth.csrf)return res.sendStatus(403);next();});
 officialNoticeRoutes(app,pool,config);
 app.use((e,_req,res,_next)=>res.status(e.status||500).json({error:e.message}));
});
after(async()=>db.close());
test('signup requires an existing IFJ and proves only its registered Discord, with hashed secrets',async()=>{
 const m=await member(),agent=client();
 await post(agent,'/register/start',{ifj:'999999999999999',password}).expect(404);
 await post(agent,'/register/start',{ifj:m.ifj,password:'short'}).expect(400);
 const start=await post(agent,'/register/start',{ifj:m.ifj,password,discord_id:'99999999999999999'}).expect(200);
 assert.equal(codes.at(-1).id,m.discord_id);assert.equal(start.body.code,undefined);
 const ch=(await pool.query('SELECT * FROM member_signup_challenges WHERE member_id=$1',[m.id])).rows[0];
 assert.match(ch.code_hash,/^[a-f0-9]{64}$/);assert.notEqual(ch.password_hash,password);assert.notEqual(ch.code_hash,codes.at(-1).code);
 await agent.get('/api/member/me').expect(401);
 await post(agent,'/register/start',{ifj:m.ifj,password}).expect(429);
 const done=await post(agent,'/register/confirm',{code:codes.at(-1).code}).expect(201);
 assert.ok(done.headers['set-cookie'].some(c=>c.startsWith('ifj_member_session=')&&c.includes('HttpOnly')&&c.includes('SameSite=Strict')&&c.includes('Path=/api/member')));
 await post(agent,'/register/confirm',{code:codes.at(-1).code}).expect(400);
 const me=(await agent.get('/api/member/me').expect(200)).body;
 assert.equal(me.member.idrkc,m.idrkc);assert.equal(me.member.ifj,undefined);assert.equal(me.member.card_secret,undefined);assert.equal(me.member.password_hash,undefined);assert.equal(me.member.suspect,undefined);assert.match(me.csrf,/^[a-f0-9]{64}$/);
 await agent.get('/api/official-notices').expect(401);
});
test('signup rejects code guessing after five attempts, expired code, and replay in another browser',async()=>{
 const m=await member(),agent=client();await post(agent,'/register/start',{ifj:m.ifj,password}).expect(200);const code=codes.at(-1).code;
 await post(client(),'/register/confirm',{code}).expect(400);
 for(let n=0;n<5;n++)await post(agent,'/register/confirm',{code:'000000'}).expect(400);
 await post(agent,'/register/confirm',{code}).expect(400);
 assert.equal((await pool.query('SELECT attempts FROM member_signup_challenges WHERE member_id=$1',[m.id])).rows[0].attempts,5);
 const other=await member(),otherAgent=client();await post(otherAgent,'/register/start',{ifj:other.ifj,password}).expect(200);
 await pool.query("UPDATE member_signup_challenges SET expires_at=now()-interval '1 minute' WHERE member_id=$1",[other.id]);await post(otherAgent,'/register/confirm',{code:codes.at(-1).code}).expect(400);
});
test('registration and sessions are revoked on a Discord change or IFJ deletion',async()=>{
 const m=await member(),agent=client();await post(agent,'/register/start',{ifj:m.ifj,password}).expect(200);const staleCode=codes.at(-1).code;
 await pool.query("UPDATE members SET discord_id='88888888888888888' WHERE id=$1",[m.id]);await post(agent,'/register/confirm',{code:staleCode}).expect(400);
 const active=await member(),r=await register(active);
 await pool.query("UPDATE members SET discord_id='88888888888888887' WHERE id=$1",[active.id]);await r.agent.get('/api/member/me').expect(401);
 await post(client(),'/login',{ifj:active.ifj,password}).expect(401);
 await pool.query('UPDATE members SET discord_id=$1 WHERE id=$2',[active.discord_id,active.id]);await pool.query('DELETE FROM members WHERE id=$1',[active.id]);await r.agent.get('/api/member/me').expect(401);
});
test('failed Discord delivery leaves no challenge, and offline bot cannot begin signup',async()=>{
 const m=await member(),agent=client();blocked=true;await post(agent,'/register/start',{ifj:m.ifj,password}).expect(400);blocked=false;
 assert.equal((await pool.query('SELECT * FROM member_signup_challenges WHERE member_id=$1',[m.id])).rowCount,0);
 offline=true;await post(agent,'/register/start',{ifj:m.ifj,password}).expect(503);offline=false;
 await request(app).post('/api/member/register/start').send({ifj:m.ifj,password}).expect(403);
});
test('member login is isolated, logout requires CSRF and an unverified member cannot download a card',async()=>{
 const m=await member(false),r=await register(m);await r.agent.get('/api/member/card.png').expect(403);
 await post(r.agent,'/logout',{}).expect(403);await r.agent.post('/api/member/logout').set('Origin','http://malicious.test').set('X-CSRF-Token',r.me.csrf).send({}).expect(403);
 await r.agent.post('/api/member/logout').set('Origin',config.origin).set('X-CSRF-Token',r.me.csrf).send({}).expect(200);await r.agent.get('/api/member/me').expect(401);
 await post(r.agent,'/login',{ifj:m.ifj,password:'wrong'}).expect(401);await post(r.agent,'/login',{ifj:m.ifj,password}).expect(200);
 assert.equal((await r.agent.get('/api/member/me')).body.member.id,m.id);
 await r.agent.get('/api/member/other-user/card.png').expect(404);
});
test('only administrators manage notices, and member feed never exposes drafts',async()=>{
 const m=await member(),r=await register(m);
 await admin('post','',{title:'Forbidden',content:'Forbidden',published:true},'recrutador').expect(403);
 await admin('post','',{title:'Forbidden',content:'Forbidden',published:true},'moderador').expect(403);
 const draft=(await admin('post','',{title:'Rascunho privado',content:'Ainda não publicado'}).expect(201)).body;
 const notice=(await admin('post','',{title:'Novo distrito',content:'Bem-vindos ao HRISTE BOZE!',published:true,pinned:true}).expect(201)).body;
 const feed=(await r.agent.get('/api/member/notices').expect(200)).body;assert.equal(feed.length,1);assert.equal(feed[0].id,notice.id);assert.equal(feed[0].created_by,undefined);
 await admin('patch','/'+draft.id,{published:true}).expect(200);assert.equal((await r.agent.get('/api/member/notices')).body.length,2);
 await admin('patch','/'+notice.id,{published:false}).expect(200);assert.equal((await r.agent.get('/api/member/notices')).body[0].id,draft.id);
 await admin('delete','/'+draft.id,{}).expect(200);assert.equal((await r.agent.get('/api/member/notices')).body.length,0);
 await admin('post','',{title:'<script>alert(1)</script>',content:'Plain text',pinned:'yes'}).expect(400);
});
test('migration history is restricted to the authenticated IFJ and Discord owner',async()=>{
 const a=await member(),b=await member(),r=await register(a);
 await pool.query("INSERT INTO district_migration_requests(member_id,discord_id,source_guild,ifj,member_version,shigaku_name,status) VALUES($1,$2,'test-guild',$3,1,'Meu novo nome','pendente'),($4,$5,'test-guild',$6,1,'Outra pessoa','pendente')",[a.id,a.discord_id,a.ifj,b.id,b.discord_id,b.ifj]);
 const result=(await r.agent.get('/api/member/migration').expect(200)).body;
 assert.equal(result.request.shigaku_name,'Meu novo nome');assert.equal(result.request.discord_id,undefined);
 await pool.query("UPDATE district_migration_requests SET discord_id='88888888888888886' WHERE member_id=$1",[a.id]);assert.equal((await r.agent.get('/api/member/migration')).body.request,null);
});

test('HB-ID registration/login keeps signing keys private and downloaded card belongs to the session owner',async()=>{
 const m=await member(),other=await member(),agent=client();
 const formatted=m.idrkc.match(/.{4}/g).join(' ');
 await post(agent,'/register/start',{idrkc:formatted,password}).expect(200);await post(agent,'/register/confirm',{code:codes.at(-1).code}).expect(201);
 let me=(await agent.get('/api/member/me').expect(200)).body;assert.equal(me.member.idrkc,m.idrkc);assert.equal(me.member.card_secret,undefined);assert.equal(me.member.ifj,undefined);
 const png=await agent.get('/api/member/card.png').query({id:other.id,discord_id:other.discord_id}).expect(200).expect('Content-Type',/image\/png/);
 const {verifyCardBuffer}=await import('../src/idrkc.js');const decoded=await verifyCardBuffer(pool,png.body,{discordId:m.discord_id});assert.equal(decoded.id,m.id);assert.equal(decoded.card_secret,undefined);
 assert.match(png.headers['content-disposition'],new RegExp(m.idrkc));
 await agent.post('/api/member/logout').set('Origin',config.origin).set('X-CSRF-Token',me.csrf).send({}).expect(200);
 await post(agent,'/login',{idrkc:formatted,password}).expect(200);me=(await agent.get('/api/member/me').expect(200)).body;assert.equal(me.member.id,m.id);
});
