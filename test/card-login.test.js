import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import express from 'express';
import request from 'supertest';
import {PGlite} from '@electric-sql/pglite';
import {cardLoginRoutes} from '../src/card-login.js';
import {memberPortalRoutes} from '../src/member-portal.js';
import {buildCardPayload} from '../src/idrkc.js';
import {decodeCardBarcode,renderCardBarcode,MAX_CARD_IMAGE_BYTES} from '../src/barcode.js';
import {renderCard} from '../src/cards.js';
import {hash,passwordHash,passwordMatches} from '../src/security.js';
const config={origin:'http://localhost:3000',production:false,secret:'card-login-test-secret'.repeat(3),divisions:[{id:1,guild:'211111111111111111',name:'DISTRITO ROKUHARA KAGE CLAN'}]};
const password='Senha de membro segura 2026!';
let db,pool,app,seq=0,ipSeq=0,decodeCalls=0,offline=false,blocked=false,busy=false;
const codes=[],present=new Set();
const client=()=>request.agent(app).set('X-Forwarded-For',`127.0.0.${++ipSeq}`);
async function member({account=true,verified=true,active=true}={}){
 const n=++seq;
 const m=(await pool.query('INSERT INTO members(ifj,name,game_nick,roblox_username,discord_id,division,verified) VALUES($1,$2,$3,$4,$5,1,$6) RETURNING *',[String(n).padStart(15,'0'),'Titular '+n,'Shigaku '+n,'Roblox'+n,String(511111111111111110n+BigInt(n)),verified])).rows[0];
 present.add(m.discord_id);
 if(account)await pool.query('INSERT INTO member_accounts(member_id,discord_id,password_hash,active) VALUES($1,$2,$3,$4)',[m.id,m.discord_id,await passwordHash(password),active]);
 return m;
}
async function browser(){const agent=client(),res=await agent.get('/api/member/card-login/session').expect(200);return {agent,csrf:res.body.csrf};}
const upload=(b,buffer,type='image/png')=>b.agent.post('/api/member/card-login/start').set('Origin',config.origin).set('X-Card-Login-CSRF',b.csrf).set('Content-Type',type).send(buffer);
const confirm=(b,body)=>b.agent.post('/api/member/card-login/confirm').set('Origin',config.origin).set('X-Card-Login-CSRF',b.csrf).send(body);
async function start(m,b){b||=await browser();const response=await upload(b,await renderCardBarcode(buildCardPayload(m))).expect(200);return {...b,response,code:codes.at(-1).code,member:m};}
before(async()=>{
 db=new PGlite();
 for(const file of ['schema.sql','district-schema.sql','member-portal-schema.sql','idrkc-schema.sql','verified-services-schema.sql','embed-publications-schema.sql','card-login-schema.sql'])await db.exec(await readFile(new URL('../src/'+file,import.meta.url),'utf8'));
 pool={query:async(sql,args)=>{const r=await db.query(sql,args);return {...r,rowCount:r.affectedRows||r.rows.length};},connect:async()=>({...pool,release(){}})};
 app=express();app.set('trust proxy',1);app.use(express.json({limit:'24kb'}));
 const bot={ready:()=>!offline,searchRegistrationMembers:async id=>present.has(id)?[{id,username:'actual-user',bot:false}]:[],sendMemberSignupCode:async(id,code,name)=>{if(blocked)throw Error('DM blocked');codes.push({id,code,name});}};
 cardLoginRoutes(app,pool,config,bot,{decode:async buffer=>{decodeCalls++;if(busy)throw Object.assign(new Error('Decoder ocupado.'),{code:'CARD_DECODER_BUSY',status:503});return decodeCardBarcode(buffer);}});
 memberPortalRoutes(app,pool,config,bot);
 app.get('/api/staff-test',(_req,res)=>res.sendStatus(401));
 app.use((error,_req,res,_next)=>res.status(error.status||500).json({error:error.message,code:error.code}));
});
after(async()=>db.close());

test('real uploaded card requires Discord proof before issuing the existing private member session',async()=>{
 const m=await member(),b=await browser(),png=await renderCard(m,config.divisions[0].name);
 const original=(await pool.query('SELECT password_hash FROM member_accounts WHERE member_id=$1',[m.id])).rows[0].password_hash;
 const response=await upload(b,png).expect(200);
 assert.equal(response.body.requires_code,true);assert.equal(response.body.requires_password,false);assert.equal(codes.at(-1).id,m.discord_id);
 for(const field of ['member','name','idrkc','discord_id','code','code_hash','card_secret'])assert.equal(response.body[field],undefined);
 await b.agent.get('/api/member/me').expect(401);
 const challenge=(await pool.query('SELECT * FROM card_login_challenges WHERE member_id=$1',[m.id])).rows[0];
 assert.match(challenge.proof_hash,/^[a-f0-9]{64}$/);assert.notEqual(challenge.proof_hash,buildCardPayload(m));assert.notEqual(challenge.code_hash,codes.at(-1).code);
 const done=await confirm(b,{code:codes.at(-1).code,password:'An ignored password 2026!'}).expect(200);
 assert.equal(done.body.member.id,m.id);assert.equal(done.body.member.card_secret,undefined);assert.equal(done.body.member.ifj,undefined);assert.equal(done.body.redirect,'/membros');
 assert.ok(done.headers['set-cookie'].some(c=>c.startsWith('ifj_member_session=')&&c.includes('HttpOnly')&&c.includes('SameSite=Strict')&&c.includes('Path=/api/member')));
 const me=(await b.agent.get('/api/member/me').expect(200)).body;assert.equal(me.member.id,m.id);
 await b.agent.get('/api/member/notices').expect(200);await b.agent.get('/api/member/card.png').expect(200);await b.agent.get('/api/staff-test').expect(401);
 assert.equal((await pool.query('SELECT password_hash FROM member_accounts WHERE member_id=$1',[m.id])).rows[0].password_hash,original);
 await confirm(b,{code:codes.at(-1).code}).expect(403);
 assert.equal((await pool.query('SELECT count(*)::int n FROM member_sessions s JOIN member_accounts a ON a.id=s.account_id WHERE a.member_id=$1',[m.id])).rows[0].n,1);
});

test('new accounts require a real password after the code, and the first login hashes it',async()=>{
 const m=await member({account:false}),flow=await start(m);
 assert.equal(flow.response.body.requires_password,true);
 const missing=await confirm(flow,{code:flow.code}).expect(400);assert.equal(missing.body.requires_password,true);
 await confirm(flow,{code:flow.code,password:'short'}).expect(400);
 await confirm(flow,{code:flow.code,password}).expect(200);
 const account=(await pool.query('SELECT * FROM member_accounts WHERE member_id=$1',[m.id])).rows[0];
 assert.notEqual(account.password_hash,password);assert.ok(await passwordMatches(password,account.password_hash));assert.equal(account.discord_id,m.discord_id);
});

test('a fresh code renews the browser deadline and cookie without reviving expired or consumed sessions',async t=>{
 const m=await member(),b=await browser(),now=Date.now();
 await pool.query("UPDATE card_login_sessions SET expires_at=now()+interval '30 seconds' WHERE consumed_at IS NULL");
 const flow=await start(m,b);
 const row=(await pool.query('SELECT s.expires_at AS browser_expires,ch.expires_at AS code_expires FROM card_login_sessions s JOIN card_login_challenges ch USING(token_hash) WHERE ch.member_id=$1',[m.id])).rows[0];
 assert.equal(new Date(row.browser_expires).getTime(),new Date(row.code_expires).getTime());
 const refreshed=flow.response.headers['set-cookie'].find(value=>value.startsWith('rkc_card_login='));
 assert.ok(refreshed);assert.match(refreshed,/Path=\/api\/member\/card-login/);assert.match(refreshed,/HttpOnly/);assert.match(refreshed,/SameSite=Strict/);
 const maxAge=Number(refreshed.match(/Max-Age=(\d+)/)?.[1]);assert.ok(maxAge>=590&&maxAge<=600);
 t.mock.method(Date,'now',()=>now+31000);
 await confirm(flow,{code:flow.code}).expect(200);
 await upload(flow,await renderCardBarcode(buildCardPayload(m))).expect(403);
 const expired=await browser();
 await pool.query("UPDATE card_login_sessions SET expires_at=now()-interval '1 second' WHERE consumed_at IS NULL");
 await upload(expired,await renderCardBarcode(buildCardPayload(m))).expect(403);
 assert.equal((await pool.query('SELECT count(*)::int n FROM member_sessions s JOIN member_accounts a ON a.id=s.account_id WHERE a.member_id=$1',[m.id])).rows[0].n,1);
});

test('five wrong codes persist, block the correct code afterward, and never create sessions',async()=>{
 const m=await member(),flow=await start(m);
 for(let n=0;n<5;n++)await confirm(flow,{code:'000000'}).expect(400);
 await confirm(flow,{code:flow.code}).expect(400);
 const ch=(await pool.query('SELECT attempts FROM card_login_challenges WHERE member_id=$1',[m.id])).rows[0];assert.equal(ch.attempts,5);
 await flow.agent.get('/api/member/me').expect(401);
});

test('version, Discord, signing key, verification and revocation changes invalidate a pending proof',async()=>{
 for(const statement of [
  'identity_version=identity_version+1',
  "discord_id='611111111111111111'",
  'card_secret=gen_random_uuid()',
  'verified=FALSE',
  'card_revoked_at=now()'
 ]){
  const m=await member(),flow=await start(m);
  await pool.query('UPDATE members SET '+statement+' WHERE id=$1',[m.id]);
  const res=await confirm(flow,{code:flow.code});assert.ok([403,409].includes(res.status),statement+': '+res.text);
  await flow.agent.get('/api/member/me').expect(401);
  if(statement.includes('611111'))await pool.query('UPDATE members SET discord_id=$1 WHERE id=$2',[m.discord_id,m.id]);
 }
});

test('expired proof/browser, deleted member, and confirmation from another browser are rejected',async()=>{
 const m=await member(),flow=await start(m),other=await browser();
 await confirm(other,{code:flow.code}).expect(400);
 await pool.query("UPDATE card_login_challenges SET expires_at=now()-interval '1 minute' WHERE member_id=$1",[m.id]);
 await confirm(flow,{code:flow.code}).expect(400);
 const second=await start(await member());
 await pool.query("UPDATE card_login_sessions SET expires_at=now()-interval '1 minute' WHERE token_hash=(SELECT token_hash FROM card_login_challenges WHERE member_id=$1)",[second.member.id]);
 await confirm(second,{code:second.code}).expect(403);
 const deleted=await start(await member());
 await pool.query('DELETE FROM members WHERE id=$1',[deleted.member.id]);
 await confirm(deleted,{code:deleted.code}).expect(400);
});

test('inactive accounts stay blocked, including when disabled after upload',async()=>{
 const m=await member({active:false}),b=await browser();
 await upload(b,await renderCardBarcode(buildCardPayload(m))).expect(403);
 const second=await start(await member());
 await pool.query('UPDATE member_accounts SET active=FALSE WHERE member_id=$1',[second.member.id]);
 await confirm(second,{code:second.code}).expect(403);
 await second.agent.get('/api/member/me').expect(401);
});

test('relinked Discord replaces an old active account only after confirmation and revokes its sessions',async()=>{
 const m=await member(),old=(await pool.query('SELECT * FROM member_accounts WHERE member_id=$1',[m.id])).rows[0];
 await pool.query('INSERT INTO member_sessions(token_hash,account_id,csrf,expires_at) VALUES($1,$2,$3,$4)',[hash('old-session',config.secret),old.id,'old-csrf',new Date(Date.now()+60000)]);
 const newId='711111111111111111';present.add(newId);
 const updated=(await pool.query('UPDATE members SET discord_id=$1,identity_version=identity_version+1 WHERE id=$2 RETURNING *',[newId,m.id])).rows[0];
 const flow=await start(updated);assert.equal(flow.response.body.requires_password,true);
 assert.equal((await pool.query('SELECT discord_id FROM member_accounts WHERE member_id=$1',[m.id])).rows[0].discord_id,m.discord_id);
 await confirm(flow,{code:flow.code,password}).expect(200);
 const account=(await pool.query('SELECT * FROM member_accounts WHERE member_id=$1',[m.id])).rows[0];assert.notEqual(account.id,old.id);assert.equal(account.discord_id,newId);
 assert.equal((await pool.query('SELECT * FROM member_sessions WHERE account_id=$1',[old.id])).rowCount,0);
});

test('origin, CSRF, content type and size are rejected before barcode decoding',async()=>{
 const m=await member(),png=await renderCardBarcode(buildCardPayload(m)),beforeCalls=decodeCalls,b=await browser();
 await b.agent.post('/api/member/card-login/start').set('Origin','https://evil.example').set('X-Card-Login-CSRF',b.csrf).set('Content-Type','image/png').send(png).expect(403);
 await upload({...b,csrf:'wrong'},png).expect(403);
 await client().post('/api/member/card-login/start').set('Origin',config.origin).set('X-Card-Login-CSRF',b.csrf).set('Content-Type','image/png').send(png).expect(403);
 await upload(b,png,'image/svg+xml').expect(415);
 const large=await browser();await upload(large,Buffer.alloc(MAX_CARD_IMAGE_BYTES+1)).expect(413);
 assert.equal(decodeCalls,beforeCalls);
});

test('malformed or oversized dimensions, tampered and unverified cards cannot log in',async()=>{
 const m=await member(),png=await renderCardBarcode(buildCardPayload(m));
 await upload(await browser(),Buffer.from('not a card')).expect(400);
 const dimensions=Buffer.from(png);dimensions.writeUInt32BE(50000,16);await upload(await browser(),dimensions).expect(400);
 const value=buildCardPayload(m),tampered=value.slice(0,-1)+(value.at(-1)==='9'?'8':'9');
 await upload(await browser(),await renderCardBarcode(tampered)).expect(403);
 const unverified=await member({verified:false});await upload(await browser(),await renderCardBarcode(buildCardPayload(unverified))).expect(403);
 await upload(await browser(),png,'image/jpeg').expect(415);
});

test('offline bot, missing guild member, blocked DM and decoder busy fail without sessions',async()=>{
 const m=await member(),png=await renderCardBarcode(buildCardPayload(m));
 offline=true;await upload(await browser(),png).expect(503);offline=false;
 present.delete(m.discord_id);await upload(await browser(),png).expect(403);present.add(m.discord_id);
 blocked=true;const b=await browser();await upload(b,png).expect(400);blocked=false;
 assert.equal((await pool.query('SELECT code_hash FROM card_login_challenges WHERE member_id=$1',[m.id])).rows[0].code_hash,null);
 await b.agent.get('/api/member/me').expect(401);
 busy=true;await upload(await browser(),png).expect(503);busy=false;
});

test('repeat uploads and cross-browser code requests are throttled without resetting attempts',async()=>{
 const m=await member(),flow=await start(m),png=await renderCardBarcode(buildCardPayload(m));
 await upload(flow,png).expect(429);
 await confirm(flow,{code:'000000'}).expect(400);
 await upload(await browser(),png).expect(429);
 const challenge=(await pool.query('SELECT attempts FROM card_login_challenges WHERE member_id=$1',[m.id])).rows[0];assert.equal(challenge.attempts,1);
});

test('schema is repeatable and browser cookies are private, scoped and independently expired',async()=>{
 await db.exec(await readFile(new URL('../src/card-login-schema.sql',import.meta.url),'utf8'));
 const agent=client(),response=await agent.get('/api/member/card-login/session').expect(200);
 assert.match(response.body.csrf,/^[a-f0-9]{64}$/);
 const value=response.headers['set-cookie'].find(c=>c.startsWith('rkc_card_login='));
 assert.match(value,/HttpOnly/);assert.match(value,/SameSite=Strict/);assert.match(value,/Path=\/api\/member\/card-login/);assert.match(value,/Max-Age=600/);
 const again=await agent.get('/api/member/card-login/session').expect(200);assert.equal(again.body.csrf,response.body.csrf);
});
