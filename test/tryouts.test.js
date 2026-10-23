import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import express from 'express';
import request from 'supertest';
import {PGlite} from '@electric-sql/pglite';
import {PermissionFlagsBits as P} from 'discord.js';
import {GAMES,gameById} from '../src/games.js';
import {createTryouts,damagePercent,evaluatorToken,registrationToken,recordTryoutResult,expireTryout,tryoutAdmission,tryoutMemberAccess,tryoutRoutes} from '../src/tryouts.js';
import {registrationInvitePublicRoutes} from '../src/registration-invites.js';
import {memberPortalRoutes} from '../src/member-portal.js';
import {cardLoginRoutes} from '../src/card-login.js';
import {buildCardPayload} from '../src/idrkc.js';
import {ROLE_ENV} from '../src/config-rules.js';
import {createMemberRecord} from '../src/member-store.js';
import {hash,passwordHash,passwordMatches} from '../src/security.js';
import {tx,initialize,enqueueRoleReconciliation} from '../src/db.js';

const guildId='211111111111111111',evaluatorId='1480009495915659494',botId='211111111111111112';
const config={origin:'http://localhost:3000',secret:'tryout-test-secret'.repeat(4),production:false,tryouts:{enabled:true,evaluatorId,passPercent:50,registrationHours:48},divisions:[{id:1,guild:guildId,resources:{'tryouts-category':'211111111111111113'}}]};
const password='Uma senha muito segura 2026!';
let db,pool,service,app,admin,other,legacy,digest,cardPayload,seq=0,ip=0,channelSeq=0,blocked=false;
const channels=new Map(),profiles=new Map(),sent=[],created=[],codes=[];
const person=()=>{const id=String(311111111111111111n+BigInt(++seq));profiles.set(id,{id,username:'participant'+seq,display_name:'Participante '+seq});return id;};
const channel=id=>({id,guildId,topic:null,send:async data=>{sent.push({target:id,data});return {id:String(9000+sent.length)};}});
const client={guilds:{fetch:async id=>{assert.equal(id,guildId);return guild;}},channels:{fetch:async id=>channels.get(id)},users:{fetch:async id=>({send:async data=>{if(blocked)throw Object.assign(Error('DM blocked'),{code:50007});sent.push({target:id,data});return {id:String(9000+sent.length)};}})}};
const guild={id:guildId,ownerId:evaluatorId,members:{fetch:async arg=>{const id=typeof arg==='string'?arg:arg.user;return {id,displayName:id===evaluatorId?'Avaliador real':profiles.get(id)?.display_name,user:{id,username:profiles.get(id)?.username||'avaliador',bot:false}};},fetchMe:async()=>({id:botId})},channels:{fetch:async()=>channels,create:async data=>{created.push(data);const ch={...channel(String(411111111111111111n+BigInt(++channelSeq))),topic:data.topic};channels.set(ch.id,ch);return ch;}}};
const fresh=()=>request.agent(app).set('X-Forwarded-For',`127.0.0.${++ip}`);
const asStaff=(id=admin)=>fresh().set('X-Test-Staff',String(id));
const open=async(id,gameId='deepwoken')=>service.start({guildId,user:{id}},gameId);
const getSession=async id=>(await pool.query('SELECT * FROM tryout_sessions WHERE id=$1',[id])).rows[0];
const actorRequest=(s,id=admin)=>asStaff(id).set('Authorization','Bearer '+evaluatorToken(s,config.secret));
async function member(id=person(),verified=true){const m=await tx(pool,c=>createMemberRecord(c,{name:'Nome '+id,game_nick:'Build '+id,roblox_username:'Player'+id.slice(-12),discord_id:id,division:1,account_kind:'membro',allied_gang:null,member_rank:'Membro'},admin));return (await pool.query('UPDATE members SET verified=$1 WHERE id=$2 RETURNING *',[verified,m.id])).rows[0];}
const execute=async(kind,s)=>{const job=(await pool.query('SELECT * FROM jobs WHERE kind=$1 AND payload->>\'tryoutId\'=$2 ORDER BY id LIMIT 1',[kind,String(s.id)])).rows[0];assert.ok(job,kind);return tx(pool,c=>service.execute(job,c));};
before(async()=>{
 db=new PGlite();
 for(const file of ['schema.sql','district-schema.sql','sbi-schema.sql','member-portal-schema.sql','idrkc-schema.sql','verified-services-schema.sql','embed-publications-schema.sql','registration-invites-schema.sql','card-login-schema.sql'])await db.exec(await readFile(new URL('../src/'+file,import.meta.url),'utf8'));
 let tail=Promise.resolve();
 pool={query:async(sql,args)=>{if(typeof sql==='object'){await db.exec(sql.text);return {rows:[],rowCount:0};}if(sql.includes('pg_advisory_xact_lock'))return {rows:[],rowCount:1};const r=await db.query(sql,args);return {...r,rowCount:r.affectedRows||r.rows.length};},connect:async()=>{const prior=tail;let release;tail=new Promise(r=>{release=r;});await prior;return {...pool,release};}};
 digest=await passwordHash(password);
 admin=(await pool.query("INSERT INTO staff(username,password_hash,role,discord_id,discord_verified_at) VALUES('evaluator',$1,'admin',$2,now()) RETURNING id",[digest,evaluatorId])).rows[0].id;
 other=(await pool.query("INSERT INTO staff(username,password_hash,role,discord_id,discord_verified_at) VALUES('other',$1,'admin','1480009495915659495',now()) RETURNING id",[digest])).rows[0].id;
 legacy=await member();await pool.query('INSERT INTO member_accounts(member_id,discord_id,password_hash) VALUES($1,$2,$3)',[legacy.id,legacy.discord_id,digest]);
 await pool.query("INSERT INTO sbi_district(singleton,guild_id,status) VALUES(TRUE,$1,'ready')",[guildId]);
 await db.exec(await readFile(new URL('../src/tryouts-schema.sql',import.meta.url),'utf8'));
 service=createTryouts(pool,config,client);
 app=express();app.set('trust proxy',1);app.use(express.json());
 app.use(async(req,res,next)=>{if(req.get('X-Test-Staff')){const actor=(await pool.query('SELECT * FROM staff WHERE id=$1',[Number(req.get('X-Test-Staff'))])).rows[0];if(actor?.active)req.auth={...actor,staff_id:actor.id,csrf:'test-csrf'};}next();});
 tryoutRoutes(app,pool,config);
 const bot={ready:()=>true,searchRegistrationMembers:async query=>[...profiles.values()].filter(p=>p.id===query),sendMemberSignupCode:async(id,code)=>codes.push({id,code})};
 registrationInvitePublicRoutes(app,pool,config,bot);cardLoginRoutes(app,pool,config,bot,{decode:async()=>cardPayload});memberPortalRoutes(app,pool,config,bot);
 app.use((err,_req,res,_next)=>res.status(err.status||500).json({error:err.message}));
});
after(async()=>db.close());

test('damage validation accepts 0, boundary 50 and decimal 100; rejects missing, string, nonfinite and out of range',()=>{
 for(const v of [0,49.99,50,50.01,100,28.35])assert.equal(damagePercent(v),v);
 for(const v of [undefined,null,'50',false,NaN,Infinity,-0.01,100.01,0.001])assert.throws(()=>damagePercent(v),/0 a 100/);
});

test('game schema upgrade backfills historical attempts and rejects unsupported games',async()=>{
 const who=person();
 await pool.query('ALTER TABLE tryout_sessions DROP COLUMN game_id');
 const old=(await pool.query("INSERT INTO tryout_sessions(guild_id,participant_id,evaluator_id,participant_nick,evaluator_nick,threshold,link_nonce,link_expires_at) VALUES($1,$2,$3,'Original participant','Original evaluator',50,'original-nonce',now()+interval '1 day') RETURNING id",[guildId,who,evaluatorId])).rows[0];
 const migration=await readFile(new URL('../src/tryouts-schema.sql',import.meta.url),'utf8');
 await db.exec(migration);await db.exec(migration);
 assert.equal((await getSession(old.id)).game_id,'deepwoken');
 await assert.rejects(pool.query('UPDATE tryout_sessions SET game_id=$1 WHERE id=$2',['unknown-game',old.id]),/tryout_game_valid/);
 assert.ok(Object.isFrozen(GAMES)&&GAMES.every(Object.isFrozen));
 assert.equal(gameById('klase').name,'Klase');assert.equal(gameById('__proto__'),undefined);
});

test('one-time snapshot preserves only preexisting verified accounts; later manual member creation is denied',async()=>{
 assert.equal(await tryoutAdmission(pool,config,legacy.discord_id,guildId,legacy),legacy);
 assert.equal(await tryoutMemberAccess(pool,config,legacy),true);
 const late=await member();await pool.query('INSERT INTO member_accounts(member_id,discord_id,password_hash) VALUES($1,$2,$3)',[late.id,late.discord_id,digest]);
 await db.exec(await readFile(new URL('../src/tryouts-schema.sql',import.meta.url),'utf8'));
 assert.equal(await tryoutAdmission(pool,config,late.discord_id,guildId,late),null);
 assert.equal((await pool.query('SELECT count(*)::int n FROM tryout_legacy_members')).rows[0].n,1);
 await pool.query('UPDATE member_accounts SET active=FALSE WHERE member_id=$1',[legacy.id]);assert.equal(await tryoutMemberAccess(pool,config,legacy),false);
 await pool.query('UPDATE member_accounts SET active=TRUE WHERE member_id=$1',[legacy.id]);
});

test('repeated/concurrent start creates one session, private channel only bot/evaluator/participant, evaluator DM automatic',async()=>{
 const who=person();const [a,b]=await Promise.all([open(who),open(who)]);assert.equal(a.id,b.id);
 assert.equal((await pool.query("SELECT count(*)::int n FROM jobs WHERE kind='tryout-create' AND payload->>'tryoutId'=$1",[String(a.id)])).rows[0].n,1);
 await execute('tryout-create',a);await execute('tryout-create',a);
 assert.equal(created.length,1);const overwrites=created[0].permissionOverwrites;
 assert.deepEqual(overwrites.map(v=>v.id),[guildId,botId,who,evaluatorId]);assert.deepEqual(overwrites[0].deny,[P.ViewChannel]);
 assert.deepEqual(overwrites.map(v=>v.type),[0,1,1,1],'queued creation must resolve overwrite types after restart without cached users');
 const s=await getSession(a.id);assert.equal(s.evaluator_nick,'Avaliador real');assert.equal(s.participant_nick,profiles.get(who).display_name);
 await execute('tryout-welcome',s);await execute('tryout-evaluator-dm',s);
 const dm=sent.at(-1);assert.equal(dm.target,evaluatorId);const url=dm.data.components[0].components[0].data.url;
 assert.match(url,new RegExp(`/tryout/${s.id}#[a-f0-9]{64}$`));
 assert.equal(sent.at(-2).data.components[0].components[0].data.url,undefined,'public channel never exposes the assessor capability');
});

test('opening panel asks for three games and invalid or missing selection creates no attempt',async()=>{
 const who=person(),replies=[],deferred=[];
 const i={guildId,user:{id:who},isButton:()=>true,isModalSubmit:()=>false,deferReply:async options=>deferred.push(options),editReply:async value=>replies.push(value)};
 for(const customId of ['tryout-start','verify']){
  assert.equal(await service.interact({...i,customId}),true);
  assert.deepEqual(replies.at(-1).components[0].components.map(b=>({id:b.data.custom_id,label:b.data.label})),GAMES.map(g=>({id:'tryout-game:'+g.id,label:g.name})));
 }
 assert.ok(deferred.every(v=>v.flags===64),'game selection is private');
 for(const game of [undefined,'','Deepwoken','other','__proto__'])await assert.rejects(service.start(i,game),/Escolha Westbound/);
 await service.interact({...i,customId:'tryout-game:other'});assert.match(replies.at(-1),/Escolha Westbound/);
 assert.equal((await pool.query('SELECT id FROM tryout_sessions WHERE participant_id=$1',[who])).rowCount,0);
});

test('all three selected games persist and appear in channel, assessment, result and signup messages',async()=>{
 for(const game of GAMES){
  const who=person(),replies=[];
  const i={guildId,user:{id:who},customId:'tryout-game:'+game.id,isButton:()=>true,isModalSubmit:()=>false,deferReply:async()=>{},editReply:async value=>replies.push(value)};
  await service.interact(i);assert.ok(replies.at(-1).content.includes(game.name));
  const s=(await pool.query('SELECT * FROM tryout_sessions WHERE participant_id=$1',[who])).rows[0];assert.equal(s.game_id,game.id);
  await execute('tryout-create',s);assert.equal(created.at(-1).name,`tryout-${game.id}-${s.id}`);
  await execute('tryout-welcome',s);assert.ok(sent.at(-1).data.embeds[0].data.title.includes(game.name));
  await execute('tryout-evaluator-dm',s);assert.ok(sent.at(-1).data.embeds[0].data.description.includes(game.name));
  const page=await actorRequest(s).get('/api/tryouts/'+s.id).expect(200);assert.equal(page.body.tryout.game_name,game.name);assert.equal(page.body.tryout.game_id,game.id);
  const result=await recordTryoutResult(pool,config,s.id,50,admin);assert.equal(result.game_id,game.id);assert.equal(result.game_name,game.name);
  await execute('tryout-result',s);assert.ok(sent.at(-1).data.embeds[0].data.description.includes(game.name));
  await execute('tryout-registration-dm',s);assert.ok(sent.at(-1).data.embeds[0].data.description.includes(game.name));
  await service.interact({...i,customId:'tryout-game:'+(game.id==='deepwoken'?'westbound':'deepwoken')});
  assert.match(replies.at(-1).content,/já tem um tryout ativo/);assert.ok(replies.at(-1).content.includes(game.name));
  assert.equal((await pool.query('SELECT count(*)::int n FROM tryout_sessions WHERE participant_id=$1',[who])).rows[0].n,1);
 }
});

test('real bot permits immediate panel-to-game selection but throttles repeated game requests',async()=>{
 const {createBot}=await import('../src/bot.js');
 const bot=createBot(pool,{...config,sbi:true,botEnabled:false});bot.client.guilds.fetch=async()=>guild;
 const replies=[],who=person(),i={guildId,user:{id:who},isButton:()=>true,isModalSubmit:()=>false,deferReply:async()=>{},editReply:async value=>replies.push(value),reply:async value=>replies.push(value)};
 try{
  await bot.handleInteraction({...i,customId:'tryout-start'});
  assert.equal(replies.at(-1).components[0].components.length,3);
  await bot.handleInteraction({...i,customId:'tryout-game:westbound'});
  assert.match(replies.at(-1).content,/Westbound solicitado/);
  await bot.handleInteraction({...i,customId:'tryout-game:klase'});
  assert.match(replies.at(-1).content,/Aguarde 3 segundos/);
  const sessions=(await pool.query('SELECT * FROM tryout_sessions WHERE participant_id=$1',[who])).rows;
  assert.equal(sessions.length,1);assert.equal(sessions[0].game_id,'westbound');
 }finally{await bot.stop();}
});

test('assessor routes require correct authenticated verified Discord, signed token, origin and CSRF',async()=>{
 const s=await open(person()),path='/api/tryouts/'+s.id;
 await fresh().get(path).expect(401);await actorRequest(s,other).get(path).expect(403);
 await asStaff().get(path).expect(410);await asStaff().set('Authorization','Bearer '+'f'.repeat(64)).get(path).expect(410);
 const page=await actorRequest(s).get(path).expect(200);assert.equal(page.body.tryout.evaluator_nick,'Avaliador real');assert.equal(page.body.tryout.link_nonce,undefined);
 await actorRequest(s).post(path+'/result').set('Origin',config.origin).send({damage_percent:60}).expect(403);
 await actorRequest(s).post(path+'/result').set('Origin','https://evil.example').set('X-CSRF-Token','test-csrf').send({damage_percent:60}).expect(403);
 await pool.query('UPDATE staff SET discord_verified_at=NULL WHERE id=$1',[admin]);await actorRequest(s).get(path).expect(403);await pool.query('UPDATE staff SET discord_verified_at=now() WHERE id=$1',[admin]);
 const list=await asStaff().get('/api/tryouts').expect(200);assert.ok(list.body.some(v=>v.id===s.id&&v.url));assert.deepEqual((await asStaff(other).get('/api/tryouts').expect(200)).body,[]);
 await pool.query("UPDATE tryout_sessions SET link_expires_at=now()-interval '1 minute' WHERE id=$1",[s.id]);await actorRequest(s).get(path).expect(410);
});

test('50 passes automatically, signed bound 48h invitation and independent jobs issued once across concurrent replay',async()=>{
 const s=await open(person());const [a,b]=await Promise.all([recordTryoutResult(pool,config,s.id,50,admin),recordTryoutResult(pool,config,s.id,50,admin)]);
 assert.equal(a.status,'passed');assert.deepEqual(a,b);
 await assert.rejects(recordTryoutResult(pool,config,s.id,51,admin),e=>e.status===409);
 const saved=await getSession(s.id),invite=(await pool.query('SELECT * FROM registration_invites WHERE tryout_id=$1',[s.id])).rows[0];
 assert.equal(invite.bound_discord_id,s.participant_id);assert.equal(invite.token_hash,hash(registrationToken(saved,config.secret),config.secret));
 assert.ok(new Date(saved.registration_deadline).getTime()>Date.now()+47.99*3600000);
 assert.equal((await pool.query('SELECT count(*)::int n FROM registration_invites WHERE tryout_id=$1',[s.id])).rows[0].n,1);
 assert.equal((await pool.query("SELECT count(*)::int n FROM jobs WHERE payload->>'tryoutId'=$1 AND kind='tryout-expire'",[String(s.id)])).rows[0].n,1);
 const provisional=await tryoutAdmission(pool,config,s.participant_id,guildId,null);assert.equal(provisional.verified,true);assert.equal(provisional.member_rank,'Membro');
});

test('0 and just below threshold fail, do not issue signup, and cannot be turned into access by old verification',async()=>{
 for(const n of [0,49.99]){
  const m=await member(),s=await open(m.discord_id);
  const account=(await pool.query('INSERT INTO member_accounts(member_id,discord_id,password_hash) VALUES($1,$2,$3) RETURNING id',[m.id,m.discord_id,digest])).rows[0];
  await pool.query("INSERT INTO member_sessions(token_hash,account_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",[hash('existing-session-'+m.id,config.secret),account.id,'existing-csrf']);
  const result=await recordTryoutResult(pool,config,s.id,n,admin);
  assert.equal(result.status,'failed');assert.equal(result.damage_percent,n);
  assert.equal(await tryoutAdmission(pool,config,m.discord_id,guildId,m),null);
  assert.equal((await pool.query('SELECT * FROM registration_invites WHERE tryout_id=$1',[s.id])).rowCount,0);
  assert.equal((await pool.query('SELECT verified FROM members WHERE id=$1',[m.id])).rows[0].verified,false);
  assert.equal((await pool.query('SELECT * FROM member_sessions WHERE account_id=$1',[account.id])).rowCount,0);
 }
 const s=await open(legacy.discord_id);await recordTryoutResult(pool,config,s.id,0,admin);assert.equal(await tryoutMemberAccess(pool,config,legacy),false,'later failure overrides legacy snapshot');
});

test('provisional pass cannot bypass mandatory bound signup with legacy account registration or card login',async()=>{
 const m=await member(),s=await open(m.discord_id);await recordTryoutResult(pool,config,s.id,50,admin);
 await fresh().post('/api/member/register/start').send({idrkc:m.idrkc,password}).expect(403);
 const a=fresh(),browser=await a.get('/api/member/card-login/session').expect(200);cardPayload=buildCardPayload(m);
 // The barcode decoder is covered by card-login.test.js; this isolates admission policy.
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6XBkAAAAASUVORK5CYII=','base64');
 const before=codes.length;
 const denied=await a.post('/api/member/card-login/start').set('Origin',config.origin).set('X-Card-Login-CSRF',browser.body.csrf).set('Content-Type','image/png').send(png).expect(403);
 assert.match(denied.body.error,/cadastro obrigatório/);assert.equal(codes.length,before);
 assert.equal((await pool.query('SELECT * FROM member_accounts WHERE member_id=$1',[m.id])).rowCount,0);
});

test('late queued result announces expiry and late registration DM never advertises access',async()=>{
 const s=await open(person());await execute('tryout-create',s);await recordTryoutResult(pool,config,s.id,80,admin);
 await pool.query("UPDATE tryout_sessions SET registration_deadline=now()-interval '1 minute' WHERE id=$1",[s.id]);
 await execute('tryout-result',s);const result=sent.at(-1).data;
 assert.match(result.embeds[0].data.title,/REPROVADO/);assert.deepEqual(result.components,[]);
 const before=sent.length;await execute('tryout-registration-dm',s);assert.equal(sent.length,before);
});

async function signup(s,{existing}={}){
 const a=fresh(),path='/api/registration/'+registrationToken(s,config.secret);const initial=await a.get(path).expect(200),csrf=initial.body.csrf;
 const post=(suffix,body)=>a.post(path+suffix).set('Origin',config.origin).set('X-Registration-CSRF',csrf).send(body);
 const details={name:'Membro final '+s.id,game_nick:'Build final '+s.id,roblox_username:existing?.roblox_username||'PlayerTryout'+s.id};
 await post('/draft',details).expect(200);
 await post('/discord/start',{discord_id:person()}).expect(403);
 await post('/discord/start',{discord_id:s.participant_id}).expect(200);
 const response=await post('/complete',{code:codes.at(-1).code,password});assert.equal(response.status,201,response.text);
 return {a,member:response.body.member};
}
test('bound registration proves Discord and converts provisional into registered member with portal session',async()=>{
 const original=await open(person());await recordTryoutResult(pool,config,original.id,100,admin);const s=await getSession(original.id);
 const result=await signup(s);assert.equal((await getSession(s.id)).status,'registered');assert.equal((await getSession(s.id)).member_id,result.member.id);
 await result.a.get('/api/member/me').expect(200);
 const stored=(await pool.query('SELECT * FROM members WHERE id=$1',[result.member.id])).rows[0];assert.equal(await tryoutMemberAccess(pool,config,stored),true);
 await pool.query("UPDATE tryout_sessions SET registration_deadline=now()-interval '1 minute' WHERE id=$1",[s.id]);assert.equal(await tx(pool,c=>expireTryout(c,s.id)),false,'registration cannot be revoked by overdue job');
});

test('existing identity completes same bound mandatory signup, preserving ID and rotating explicitly supplied password/session',async()=>{
 const m=await member();await pool.query('INSERT INTO member_accounts(member_id,discord_id,password_hash) VALUES($1,$2,$3)',[m.id,m.discord_id,digest]);
 const initial=await open(m.discord_id);await recordTryoutResult(pool,config,initial.id,70,admin);const s=await getSession(initial.id),result=await signup(s,{existing:m});
 assert.equal(result.member.id,m.id);assert.equal(result.member.idrkc,m.idrkc);assert.equal(result.member.identity_version,m.identity_version+1);
 assert.equal((await pool.query('SELECT count(*)::int n FROM members WHERE discord_id=$1',[m.discord_id])).rows[0].n,1);
 const account=(await pool.query('SELECT * FROM member_accounts WHERE member_id=$1',[m.id])).rows[0];assert.equal(account.active,true);assert.ok(await passwordMatches(password,account.password_hash));
});

test('restart deadline scan expires once, denies late signup, persists revocation independently from blocked DM',async()=>{
 const m=await member();await pool.query('INSERT INTO member_accounts(member_id,discord_id,password_hash) VALUES($1,$2,$3)',[m.id,m.discord_id,digest]);
 const s=await open(m.discord_id);await recordTryoutResult(pool,config,s.id,75,admin);await pool.query("UPDATE tryout_sessions SET registration_deadline=now()-interval '1 minute' WHERE id=$1",[s.id]);
 const restart=createTryouts(pool,config,client);await restart.schedule();await restart.schedule();
 assert.equal((await getSession(s.id)).status,'expired');assert.equal((await pool.query('SELECT verified FROM members WHERE id=$1',[m.id])).rows[0].verified,false);
 const invite=(await pool.query('SELECT * FROM registration_invites WHERE tryout_id=$1',[s.id])).rows[0];assert.ok(invite.revoked_at);
 const before=(await pool.query("SELECT count(*)::int n FROM jobs WHERE kind='tryout-expired-dm' AND payload->>'tryoutId'=$1",[String(s.id)])).rows[0].n;assert.equal(before,1);
 blocked=true;await assert.rejects(execute('tryout-expired-dm',s),e=>e.code===50007);blocked=false;
 assert.equal((await getSession(s.id)).status,'expired');assert.equal(await tryoutAdmission(pool,config,m.discord_id,guildId,{...m,verified:true}),null);
 assert.ok((await pool.query("SELECT id FROM jobs WHERE kind='sync-role' AND payload->>'discordId'=$1",[m.discord_id])).rowCount>=2);
 await fresh().get('/api/registration/'+registrationToken(s,config.secret)).expect(410);
 await fresh().post('/api/member/login').send({idrkc:m.idrkc,password}).expect(403);
});

test('old verification confirmations cannot enable access and participant cannot recover assessor link',async()=>{
 const replies=[],i={customId:'confirm:old',isButton:()=>true,isModalSubmit:()=>false,deferReply:async()=>{},editReply:async v=>replies.push(v)};
 assert.equal(await service.interact(i),true);assert.match(replies[0],/exige tryout/);
 const s=await open(person());await execute('tryout-create',s);const stored=await getSession(s.id);
 await service.interact({...i,customId:`tryout-evaluate:${s.id}`,guildId,channelId:stored.channel_id,user:{id:s.participant_id}});assert.match(replies.at(-1),/Somente o avaliador/);
});

test('repeat start recovers exhausted creation and deleted approved channels without changing game or duplicating the attempt or invitation',async()=>{
 const s=await open(person(),'klase');
 await pool.query("UPDATE jobs SET status='failed',attempts=8 WHERE kind='tryout-create' AND payload->>'tryoutId'=$1",[String(s.id)]);
 const [first,second]=await Promise.all([open(s.participant_id),open(s.participant_id)]);
 assert.equal(first.id,s.id);assert.equal(second.id,s.id);assert.equal(first.link_nonce,s.link_nonce);assert.equal(first.game_id,'klase');assert.equal(second.game_id,'klase');
 const pending=async()=>(await pool.query("SELECT * FROM jobs WHERE kind='tryout-create' AND status='pending' AND payload->>'tryoutId'=$1",[String(s.id)])).rows;
 assert.equal((await pending()).length,1);
 const job=(await pending())[0];await tx(pool,c=>service.execute(job,c));await pool.query("UPDATE jobs SET status='sent' WHERE id=$1",[job.id]);
 const before=await getSession(s.id);await recordTryoutResult(pool,config,s.id,55,admin);
 const invitation=(await getSession(s.id)).registration_invite_id;
 channels.delete(before.channel_id);
 const recovery=await open(s.participant_id);assert.equal(recovery.id,s.id);assert.equal(recovery.channel_id,null);
 assert.equal((await pending()).length,1);
 const restore=(await pending())[0],count=created.length;
 await tx(pool,c=>service.execute(restore,c));await tx(pool,c=>service.execute(restore,c));
 assert.equal(created.length,count+1);
 const saved=await getSession(s.id);assert.notEqual(saved.channel_id,before.channel_id);assert.equal(saved.link_nonce,s.link_nonce);assert.equal(saved.registration_invite_id,invitation);assert.equal(saved.game_id,'klase');assert.equal(created.at(-1).name,`tryout-klase-${s.id}`);
 assert.equal((await pool.query('SELECT count(*)::int n FROM tryout_sessions WHERE participant_id=$1',[s.participant_id])).rows[0].n,1);
 const restoredJobs=(await pool.query('SELECT * FROM jobs WHERE dedupe_key=ANY($1::text[])',[[`tryout-welcome:${s.id}:${saved.channel_id}`,`tryout-result:${s.id}:${saved.channel_id}`]])).rows;
 assert.equal(restoredJobs.length,2);
 const result=restoredJobs.find(j=>j.kind==='tryout-result');await tx(pool,c=>service.execute(result,c));
 assert.equal(sent.at(-1).target,saved.channel_id);assert.match(sent.at(-1).data.components[0].components[0].data.url,new RegExp('/cadastro/'+registrationToken(saved,config.secret)+'$'));
});

test('Discord rejoin restores provisional and registered access but removes expired roles through the real bot worker',async()=>{
 const {createBot}=await import('../src/bot.js');
 const admitted=await open(person());await recordTryoutResult(pool,config,admitted.id,65,admin);
 const expired=await open(person());await recordTryoutResult(pool,config,expired.id,80,admin);
 await pool.query("UPDATE tryout_sessions SET registration_deadline=now()-interval '1 minute' WHERE id=$1",[expired.id]);await tx(pool,c=>expireTryout(c,expired.id));
 const registered=(await pool.query("SELECT * FROM tryout_sessions WHERE status='registered' ORDER BY id LIMIT 1")).rows[0];assert.ok(registered);
 await pool.query("UPDATE jobs SET status='sent'");
 const d={...config.divisions[0],memberRole:'member',adminRole:'team',rankRoles:Object.fromEntries(Object.keys(ROLE_ENV).map(k=>[k,k]))};
 const roles=new Map(['member','team',...Object.keys(ROLE_ENV)].map(id=>[id,{id,permissions:{has:()=>false}}]));
 const users=new Map([admitted,expired,registered].map(s=>{const cache=new Set(['unrelated',...(s===expired?['member']:[])]);return [s.participant_id,{id:s.participant_id,roles:{cache,add:async id=>cache.add(id),remove:async id=>cache.delete(id)}}];}));
 const discordGuild={id:guildId,roles:{fetch:async()=>roles},members:{fetch:async({user})=>users.get(user),fetchMe:async()=>({roles:{highest:{comparePositionTo:()=>1}}})}};
 const bot=createBot(pool,{...config,sbi:true,botEnabled:false,divisions:[d]});
 bot.client.isReady=()=>true;bot.client.guilds.fetch=async()=>discordGuild;
 try{
  for(const s of [admitted,expired,registered])await bot.handleMemberJoin({id:s.participant_id,user:{bot:false},guild:{id:guildId},joinedTimestamp:Date.now()});
  for(const s of [admitted,expired,registered])assert.ok((await pool.query("SELECT id FROM jobs WHERE status='pending' AND kind='sync-role' AND payload->>'discordId'=$1",[s.participant_id])).rowCount);
  // Delivery/welcome behavior has separate lifecycle tests; this executes the real role worker.
  await pool.query("UPDATE jobs SET status='sent' WHERE kind<>'sync-role'");await bot.work();
  assert.deepEqual([...users.get(admitted.participant_id).roles.cache].sort(),['member','unrelated']);
  assert.deepEqual([...users.get(registered.participant_id).roles.cache].sort(),['member','unrelated']);
  assert.deepEqual([...users.get(expired.participant_id).roles.cache],['unrelated']);
 }finally{await bot.stop();}
});

test('startup and shared /criar reconciliation restore passed applicants with no member record exactly once',async()=>{
 const s=await open(person());await recordTryoutResult(pool,config,s.id,50,admin);
 assert.equal((await pool.query('SELECT id FROM members WHERE discord_id=$1',[s.participant_id])).rowCount,0);
 await pool.query("UPDATE jobs SET status='sent' WHERE kind='sync-role' AND payload->>'discordId'=$1",[s.participant_id]);
 await initialize(pool,{BOT_ENABLED:'true'});await initialize(pool,{BOT_ENABLED:'true'});await enqueueRoleReconciliation(pool);
 const rows=(await pool.query("SELECT id FROM jobs WHERE kind='sync-role' AND status='pending' AND payload->>'discordId'=$1",[s.participant_id])).rows;
 assert.equal(rows.length,1);assert.equal((await getSession(s.id)).status,'passed');
});

test('previous-guild evaluation and signup are rejected; old expiry preserves the new registered identity and session',async()=>{
 const who=person(),old=await open(who);await recordTryoutResult(pool,config,old.id,55,admin);
 const pending=await open(person()),previousGuild='211111111111111119';
 await pool.query('UPDATE tryout_sessions SET guild_id=$1 WHERE id=ANY($2::int[])',[previousGuild,[old.id,pending.id]]);
 const next=await open(who);await recordTryoutResult(pool,config,next.id,75,admin);const current=await getSession(next.id),signupResult=await signup(current);
 await assert.rejects(recordTryoutResult(pool,config,pending.id,80,admin),e=>e.status===410);
 const former=await getSession(old.id),oldAgent=fresh(),path='/api/registration/'+registrationToken(former,config.secret);
 const initial=await oldAgent.get(path).expect(200);
 const oldPost=(suffix,body)=>oldAgent.post(path+suffix).set('Origin',config.origin).set('X-Registration-CSRF',initial.body.csrf).send(body);
 await oldPost('/draft',{name:'Antigo titular',game_nick:'Antiga build',roblox_username:'OldTryoutTest'}).expect(200);
 await oldPost('/discord/start',{discord_id:who}).expect(410);
 await pool.query("UPDATE tryout_sessions SET registration_deadline=now()-interval '1 minute' WHERE id=$1",[old.id]);
 assert.equal(await tx(pool,c=>expireTryout(c,old.id,config)),true);
 assert.equal((await pool.query('SELECT verified FROM members WHERE id=$1',[signupResult.member.id])).rows[0].verified,true);
 await signupResult.a.get('/api/member/me').expect(200);
 assert.equal((await getSession(current.id)).status,'registered');
 await execute('tryout-expired-dm',former);assert.match(sent.at(-1).data.embeds[0].data.description,/cadastro no servidor atual não foi alterado/);
});
