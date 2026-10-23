import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import request from 'supertest';
import {Collection} from 'discord.js';
import {createApp} from '../src/app.js';
import {createBot} from '../src/bot.js';
import {createMemberCards,memberCardCommand} from '../src/member-card.js';
import {createDistrictMigration} from '../src/district-migration.js';
import {hash} from '../src/security.js';
import {tx} from '../src/db.js';
import {buildCardPayload} from '../src/idrkc.js';

const guild='111111111111111111',person='222222222222222222',other='333333333333333333',channelId='444444444444444444',botId='555555555555555555';
const config={sbi:true,origin:'http://localhost:3000',secret:'test-secret-kage'.repeat(5),production:false,sourceGuilds:[],divisions:[{id:1,guild,news:channelId,name:'DISTRITO ROKUHARA KAGE CLAN',verification:channelId}]};
let db,pool,app,m,service,seq=0,staffId,blocked=false;const sent=[],messages=new Map();let creates=0,edits=0;
const ch={id:channelId,guildId:guild,isTextBased:()=>true,messages:{fetch:async id=>{if(typeof id==='object')return new Map(messages);if(!messages.has(id))throw Object.assign(Error('deleted'),{code:10008});return messages.get(id);}},send:async payload=>{creates++;const msg={id:String(creates),author:{id:botId},...payload,edit:async p=>{edits++;Object.assign(msg,p);},delete:async()=>messages.delete(msg.id)};messages.set(msg.id,msg);return msg;}};
const client={user:{id:botId},channels:{fetch:async()=>ch},users:{fetch:async id=>({send:async payload=>{if(blocked)throw Object.assign(Error('DM blocked'),{code:50007});sent.push({id,payload});return {id:'delivery-'+sent.length};}})}};
const staff=(method,path,body,role='admin')=>request(app)[method]('/api'+path).set('Origin',config.origin).set('Cookie',`ifj_session=${(role==='admin'?'a':'b').repeat(64)}`).set('X-CSRF-Token','staff-csrf').send(body);
function interaction(custom='district-migrate-form',user=person,fields={ifj:m.ifj,shigaku_name:'Kage Shigaku'}){return {id:String(++seq),guildId:guild,user:{id:user},customId:custom,isButton:()=>custom.endsWith('open'),isModalSubmit:()=>!custom.endsWith('open'),fields:{getTextInputValue:key=>fields[key],getUploadedFiles:()=>new Collection(fields.payload?[['card',{buffer:Buffer.from(fields.payload)}]]:[])},deferReply:async function(v){this.deferred=v;},editReply:async function(v){this.result=v;},reply:async function(v){this.result=v;},showModal:async function(v){this.modal=v.toJSON();}};}
before(async()=>{
 db=new PGlite();for(const file of ['schema.sql','district-schema.sql','sbi-schema.sql','member-portal-schema.sql','idrkc-schema.sql','verified-services-schema.sql','embed-publications-schema.sql'])await db.exec(await readFile(new URL('../src/'+file,import.meta.url),'utf8'));
 pool={query:async(sql,args)=>{const r=await db.query(sql,args);return {...r,rowCount:r.affectedRows||r.rows.length};},connect:async()=>({...pool,release(){}})};
 for(const [role,key]of [['admin','a'],['recrutador','b']]){const user=(await pool.query('INSERT INTO staff(username,password_hash,role,discord_id,discord_verified_at) VALUES($1,$1,$1,$2,now()) RETURNING id',[role,role==='admin'?other:'777777777777777777'])).rows[0];if(role==='admin')staffId=user.id;await pool.query("INSERT INTO sessions(token_hash,staff_id,csrf,expires_at) VALUES($1,$2,'staff-csrf',now()+interval '1 hour')",[hash(key.repeat(64),config.secret),user.id]);}
 m=(await pool.query("INSERT INTO members(ifj,name,game_nick,roblox_username,discord_id,division,verified,migration_required) VALUES('001234567890123','Nome antigo','Antigo','RobloxAntigo',$1,1,TRUE,TRUE) RETURNING *",[person])).rows[0];
 service=createDistrictMigration(pool,config,client);app=createApp(pool,config,{ready:()=>true,setup:async()=>{}});
});
after(async()=>db?.close());
test('publication is updated in place and persists the same migration notice',async()=>{
 await service.publish();await service.publish();assert.equal(creates,1);assert.equal(edits,1);
 const n=(await pool.query('SELECT * FROM district_migration_notices')).rows[0];assert.equal(n.channel_id,channelId);assert.equal(n.message_id,'1');assert.equal(messages.get('1').components[0].toJSON().components[0].custom_id,'district-migrate-open');
});
test('form opens immediately, stolen IFJ is refused, own request is private and deduplicated',async()=>{
 const open=interaction('district-migrate-open');await service.interact(open);assert.equal(open.modal.components.length,2);
 const stolen=interaction(undefined,other);await service.interact(stolen);assert.match(stolen.result.content,/não está vinculado/);assert.equal(stolen.deferred.flags,64);assert.equal((await pool.query('SELECT * FROM district_migration_requests')).rowCount,0);
 const own=interaction();await service.interact(own);assert.match(own.result.content,/recebido/);await service.interact(interaction());assert.equal((await pool.query('SELECT * FROM district_migration_requests')).rowCount,1);
});
test('only staff administrators can approve and approval preserves IFJ, updates Shigaku and queues own DM',async()=>{
 const r=(await pool.query('SELECT * FROM district_migration_requests')).rows[0];
 await request(app).post(`/api/district-migrations/${r.id}/approve`).set('Origin',config.origin).send({}).expect(401);
 await staff('post',`/district-migrations/${r.id}/approve`,{},'recrutador').expect(403);
 await staff('post',`/district-migrations/${r.id}/approve`,{}).expect(200);
 const updated=(await pool.query('SELECT * FROM members WHERE id=$1',[m.id])).rows[0];assert.equal(updated.ifj,m.ifj);assert.equal(updated.name,'Kage Shigaku');assert.equal(updated.game_nick,'Kage Shigaku');assert.equal(updated.verified,true);assert.equal(updated.migration_required,false);assert.equal(updated.identity_version,2);
 await staff('post',`/district-migrations/${r.id}/approve`,{}).expect(409);
 const job=(await pool.query("SELECT * FROM jobs WHERE kind='district-migration-decision'")).rows[0];await tx(pool,c=>service.execute(job,c));
 assert.equal(sent.length,1);assert.equal(sent[0].id,person);assert.equal(sent[0].payload.files[0].attachment.subarray(1,4).toString(),'PNG');assert.deepEqual(sent[0].payload.allowedMentions,{parse:[]});assert.match(sent[0].payload.embeds[0].toJSON().description,/Kage Shigaku/);
});
test('changed IFJ cannot approve a stale request and blocked DMs remain a retryable delivery failure',async()=>{
 await pool.query('UPDATE members SET migration_required=TRUE WHERE id=$1',[m.id]);await service.interact(interaction());const r=(await pool.query("SELECT * FROM district_migration_requests WHERE status='pendente'")).rows[0];
 await pool.query('UPDATE members SET identity_version=identity_version+1 WHERE id=$1',[m.id]);await staff('post',`/district-migrations/${r.id}/approve`,{}).expect(409);
 await staff('post',`/district-migrations/${r.id}/reject`,{reason:'Confira seu nome e envie novamente.'}).expect(200);
 const job=(await pool.query('SELECT * FROM jobs WHERE id=(SELECT notification_job_id FROM district_migration_requests WHERE id=$1)',[r.id])).rows[0];blocked=true;await assert.rejects(tx(pool,c=>service.execute(job,c)),e=>e.code===50007);blocked=false;await tx(pool,c=>service.execute(job,c));assert.equal(sent.at(-1).id,person);assert.equal(sent.at(-1).payload.files,undefined);
});
test('stop immediately blocks stale buttons on submit and deletes the own notice without reopening on publish',async()=>{
 const response=await staff('post','/district-migrations/stop',{}).expect(202);const after=interaction();await service.interact(after);assert.match(after.result.content,/encerradas/);
 const job=(await pool.query('SELECT * FROM jobs WHERE id=$1',[response.body.id])).rows[0];await tx(pool,c=>service.execute(job,c));assert.equal(messages.size,0);assert.equal((await pool.query('SELECT * FROM district_migration_notices')).rowCount,0);await service.publish();assert.equal(creates,1);
});
test('card command has no target option, registers in the district and sends only the verified caller card',async()=>{
 const registered=[];const cards=createMemberCards(pool,config,{guilds:{fetch:async id=>({commands:{create:async command=>registered.push({id,command})}})}});
 await cards.register();assert.equal(registered[0].id,guild);assert.equal(memberCardCommand().default_member_permissions,null);assert.deepEqual(memberCardCommand().options,[]);
 const events=[],received=[];const i={id:'777777777777777777',commandName:'ver-sua-carteira',guildId:guild,isChatInputCommand:()=>true,user:{id:person,send:async payload=>{events.push('send');received.push(payload);}},deferReply:async value=>{events.push('defer');assert.equal(value.flags,64);},editReply:async value=>{events.push('reply');i.result=value;}};
 await cards.interact(i);assert.equal(events[0],'defer');assert.deepEqual(events,['defer','send','reply']);assert.match(i.result.content,/enviada/);assert.equal(i.result.files,undefined);assert.match(received[0].files[0].name,new RegExp(m.idrkc));
 await pool.query('UPDATE members SET verified=FALSE WHERE id=$1',[m.id]);await cards.interact(i);assert.match(i.result.content,/Conclua seu tryout/);assert.equal(received.length,1);await pool.query('UPDATE members SET verified=TRUE WHERE id=$1',[m.id]);
 i.user.send=async()=>{throw Object.assign(Error(),{code:50007});};await cards.interact(i);assert.match(i.result.content,/mensagens diretas/);i.user.send=async p=>received.push(p);await cards.interact(i);assert.equal(received.length,2);
});
test('card command suppresses overlapping requests but releases the caller after a render failure',async()=>{
 let release,start;const started=new Promise(r=>start=r),blockedRender=new Promise(r=>release=r),deliveries=[];
 const cards=createMemberCards(pool,config,{}, {render:async()=>{start();await blockedRender;throw Error('render failed');}});
 const make=()=>({id:'nonce',guildId:guild,commandName:'ver-sua-carteira',isChatInputCommand:()=>true,user:{id:person,send:async p=>deliveries.push(p)},deferReply:async()=>{},editReply:async function(v){this.result=v;}});
 const first=cards.interact(make());await started;const next=make();await cards.interact(next);assert.match(next.result.content,/já está sendo preparada/);release();await assert.rejects(first,/render failed/);await assert.rejects(cards.interact(make()),/render failed/);assert.equal(deliveries.length,0);
});
test('button cooldown is per person across buttons, permits another user, and leaves modal submit available',async t=>{
 let now=Date.now();t.mock.method(Date,'now',()=>now);
 const emptyPool={query:async()=>({rows:[],rowCount:0}),connect:async()=>({...emptyPool,release(){}})};
 const verification={download:async file=>file.buffer,decode:async buffer=>buffer.toString()};
 const bot=createBot(emptyPool,config,{verification});t.after(()=>bot.stop());
 const first=interaction('verify');first.isButton=()=>true;first.isModalSubmit=()=>false;await bot.handleInteraction(first);assert.equal(first.modal.custom_id,'verify-card-form');
 const second=interaction('report');second.isButton=()=>true;second.isModalSubmit=()=>false;await bot.handleInteraction(second);assert.match(second.result.content,/3 segundos/);
 const another=interaction('report',other);another.isButton=()=>true;another.isModalSubmit=()=>false;await bot.handleInteraction(another);assert.equal(another.modal.custom_id,'report-card-form');
 const submit=interaction('verify-card-form',person,{payload:buildCardPayload(m)});await bot.handleInteraction(submit);assert.match(submit.result,/revogada|cadastro não existe/);assert.equal(submit.deferred.flags,64);
 const legacy=interaction('verify-form',person,{ifj:m.ifj});await bot.handleInteraction(legacy);assert.match(legacy.result,/formulário foi substituído.*anexe/);
 now+=3000;const later=interaction('verify');later.isButton=()=>true;later.isModalSubmit=()=>false;await bot.handleInteraction(later);assert.equal(later.modal.custom_id,'verify-card-form');
});
