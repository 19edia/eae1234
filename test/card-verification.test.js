import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Collection,ComponentType} from 'discord.js';
import {PGlite} from '@electric-sql/pglite';
import {createCardVerification,verificationModal} from '../src/card-verification.js';
import {buildCardPayload} from '../src/idrkc.js';
import {renderCard} from '../src/cards.js';
import {renderCardBarcode} from '../src/barcode.js';
import {downloadCardAttachment} from '../src/verified-services.js';
import {hash} from '../src/security.js';
let db,pool,seq=0,service;
const config={secret:'card-verification-test-secret'.repeat(3),divisions:[{id:1,guild:'111111111111111111'}]};
async function member(){const n=++seq;return (await pool.query('INSERT INTO members(ifj,name,game_nick,roblox_username,discord_id,division,verified) VALUES($1,$2,$3,$4,$5,1,FALSE) RETURNING *',[String(n).padStart(15,'0'),'Membro '+n,'Shigaku '+n,'Roblox'+n,String(211111111111111110n+BigInt(n))])).rows[0];}
function interaction(customId,m,{png,count=1,user=m.discord_id,guild=config.divisions[0].guild}={}){
 const events=[];return {customId,guildId:guild,user:{id:user},events,isButton:()=>!customId.endsWith('-form'),isModalSubmit:()=>customId.endsWith('-form'),fields:{getUploadedFiles:key=>{assert.equal(key,'card');return new Collection(Array.from({length:count},(_,n)=>[String(n),{url:'https://cdn.discordapp.com/ephemeral-attachments/123/456/carteira.png?ex=123&is=456&hm=signed',size:png?.length||1,contentType:'image/png',png}]));}},reply:async function(v){this.result=v;events.push('reply');},showModal:async function(v){this.modal=v.toJSON();events.push('modal');},deferReply:async function(v){assert.equal(v.flags,64);events.push('defer');},deferUpdate:async()=>events.push('defer-update'),editReply:async function(v){this.result=v;events.push('edit');}};
}
async function start(m,options={}){const png=options.png||await renderCardBarcode(buildCardPayload(m));const i=interaction('verify-card-form',m,{png,...options});await service.interact(i);return i;}
async function challenge(m){return (await pool.query('SELECT * FROM confirmations WHERE member_id=$1 ORDER BY expires_at DESC',[m.id])).rows[0];}
before(async()=>{db=new PGlite();for(const file of ['schema.sql','district-schema.sql','idrkc-schema.sql'])await db.exec(await readFile(new URL('../src/'+file,import.meta.url),'utf8'));pool={query:async(sql,args)=>{const r=await db.query(sql,args);return {...r,rowCount:r.affectedRows||r.rows.length};},connect:async()=>({...pool,release(){}})};service=createCardVerification(pool,config,{download:async attachment=>downloadCardAttachment(attachment,{fetchImpl:async()=>new Response(attachment.png)})});});
after(async()=>db.close());

test('verification asks for exactly one upload, and no typed HB-ID can bypass the new flow',async()=>{
 const modal=verificationModal().toJSON();assert.equal(modal.custom_id,'verify-card-form');assert.equal(modal.components.length,1);assert.equal(modal.components[0].component.type,ComponentType.FileUpload);assert.equal(modal.components[0].component.max_values,1);assert.match(modal.components[0].description,/HBCode/);
 const m=await member(),open=interaction('verify',m);await service.interact(open);assert.deepEqual(open.events,['modal']);
 const old=interaction('verify-form',m);await service.interact(old);assert.match(old.result,/formulário foi substituído/);assert.equal(await challenge(m),undefined);
});
test('actual original PNG verifies an unverified owner and confirms before queuing access',async()=>{
 const m=await member(),png=await renderCard(m,'GUILDA HRISTE BOZE'),i=await start(m,{png});assert.deepEqual(i.events,['defer','edit']);assert.match(i.result.content,new RegExp(m.name));assert.deepEqual(i.result.allowedMentions,{parse:[]});
 const ch=await challenge(m);assert.equal(ch.card_proof_hash,hash(buildCardPayload(m),config.secret));assert.equal((await pool.query('SELECT verified FROM members WHERE id=$1',[m.id])).rows[0].verified,false);
 const another=interaction('confirm:'+ch.token,m,{user:'999999999999999999'});await service.interact(another);assert.match(another.result.content,/expirada/);assert.ok(await challenge(m));
 const confirm=interaction('confirm:'+ch.token,m);await service.interact(confirm);assert.match(confirm.result.content,/Dados confirmados/);assert.equal((await pool.query('SELECT verified FROM members WHERE id=$1',[m.id])).rows[0].verified,true);assert.equal((await pool.query("SELECT * FROM jobs WHERE kind='sync-role' AND payload->>'discordId'=$1",[m.discord_id])).rowCount,1);
 await service.interact(interaction('confirm:'+ch.token,m));assert.equal((await pool.query("SELECT * FROM jobs WHERE kind='sync-role' AND payload->>'discordId'=$1",[m.discord_id])).rowCount,1);
});
test('wrong owner, stale version, unsigned code, revoked card and invalid uploads cannot create confirmations',async()=>{
 for(const kind of ['wrong-owner','stale','unsigned','revoked','empty','multiple']){
  const m=await member();let payload=buildCardPayload(m),options={};
  if(kind==='wrong-owner')options.user='988888888888888888';
  if(kind==='stale')await pool.query('UPDATE members SET identity_version=2 WHERE id=$1',[m.id]);
  if(kind==='unsigned')payload=payload.slice(0,-1)+(payload.endsWith('0')?'1':'0');
  if(kind==='revoked')await pool.query('UPDATE members SET card_revoked_at=now() WHERE id=$1',[m.id]);
  if(kind==='empty')options.count=0;if(kind==='multiple')options.count=2;
  const i=await start(m,{...options,png:await renderCardBarcode(payload)});assert.equal(typeof i.result,'string',kind);assert.equal(await challenge(m),undefined,kind);
 }
});
test('a revocation, revision change or signing-key rotation after upload cannot confirm old proof',async()=>{
 for(const change of ['card_revoked_at=now()','identity_version=identity_version+1','card_secret=gen_random_uuid()']){
  const m=await member();await start(m);const ch=await challenge(m);await pool.query('UPDATE members SET '+change+' WHERE id=$1',[m.id]);const confirm=interaction('confirm:'+ch.token,m);await service.interact(confirm);assert.doesNotMatch(confirm.result.content,/Dados confirmados/);assert.equal((await pool.query('SELECT verified FROM members WHERE id=$1',[m.id])).rows[0].verified,false);
 }
});
test('cancel, expiry, immigration and wrong district never grant roles',async()=>{
 const m=await member();await start(m);let ch=await challenge(m);const cancel=interaction('cancel:'+ch.token,m);await service.interact(cancel);assert.match(cancel.result.content,/cancelada/);
 await start(m);ch=await challenge(m);await pool.query("UPDATE confirmations SET expires_at=now()-interval '1 second' WHERE token=$1",[ch.token]);const expired=interaction('confirm:'+ch.token,m);await service.interact(expired);assert.match(expired.result.content,/expirada/);
 await pool.query('UPDATE members SET migration_required=TRUE WHERE id=$1',[m.id]);let result=await start(m);assert.match(result.result,/imigração/);
 await pool.query('UPDATE members SET migration_required=FALSE,division=2 WHERE id=$1',[m.id]);result=await start(m);assert.match(result.result,/outra divisão/);
 assert.equal((await pool.query("SELECT * FROM jobs WHERE payload->>'discordId'=$1",[m.discord_id])).rowCount,0);
});
