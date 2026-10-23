import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {Collection,ModalSubmitFields,ModalSubmitInteraction,PermissionFlagsBits as P} from 'discord.js';
import {createVerifiedServices,downloadCardAttachment,serviceModal} from '../src/verified-services.js';
import {buildCardPayload,CardVerificationError} from '../src/idrkc.js';
import {tx} from '../src/db.js';
import {renderCard} from '../src/cards.js';

const district={id:1,guild:'110000000000000001',category:'110000000000000002',adminRole:'110000000000000003'};
const botId='110000000000000004',ownerId='110000000000000005',adminId='110000000000000006',subId='110000000000000007',moderatorId='110000000000000008',recruiterId='110000000000000009',absentId='110000000000000010';
const config={divisions:[district]},attachment={url:'https://cdn.discordapp.com/attachments/123/456/carteira.png?ex=abc',size:100,contentType:'image/png'};
let db,pool,sequence=0,memberSequence=0,channelSequence=0,channelFailure=false;
const channels=new Collection(),created=[],dmSent=[],dmAttempts=[],blocked=new Set(),present=new Set([ownerId,adminId,subId,moderatorId,recruiterId]),sendNonces=new Map();
const guild={id:district.guild,ownerId,members:{fetch:async id=>{if(!present.has(id))throw Object.assign(Error('Unknown member'),{code:10007});return {id,user:{bot:false}};}},channels:{fetch:async()=>channels,create:async options=>{
 const id=String(120000000000000000n+BigInt(++channelSequence));created.push(options);
 const ch={id,guildId:district.guild,parentId:options.parent,topic:options.topic,permissions:options.permissionOverwrites,
  permissionOverwrites:{set:async values=>{ch.permissions=values;}},send:async payload=>{if(channelFailure)throw Object.assign(Error('Missing Access'),{code:50001});const key=id+':'+payload.nonce;if(sendNonces.has(key))return sendNonces.get(key);const result={id:String(130000000000000000n+BigInt(sendNonces.size)),payload};sendNonces.set(key,result);return result;}};
 channels.set(id,ch);return ch;
}}};
const client={user:{id:botId},guilds:{fetch:async id=>{assert.equal(id,district.guild);return guild;}},users:{fetch:async id=>({send:async payload=>{dmAttempts.push({id,payload});if(blocked.has(id))throw Object.assign(Error('Cannot send messages to this user'),{code:50007});dmSent.push({id,payload});return {id:String(140000000000000000n+BigInt(dmSent.length))};}})}};
const firstOf=async(table)=>Number((await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n);
const rows=async(table)=> (await pool.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
async function member(){const n=++memberSequence;return (await pool.query('INSERT INTO members(ifj,name,game_nick,roblox_username,discord_id,division,verified) VALUES($1,$2,$3,$4,$5,1,true) RETURNING *',[String(n).padStart(15,'0'),`Titular ${n}`,`Shigaku${n}`,`Roblox${n}`,String(150000000000000000n+BigInt(n))])).rows[0];}
function interaction(kind,m,{payload=buildCardPayload(m),subject='Nick desconhecido',id,files=1}={}){
 const events=[],file={...attachment,payload};
 return {id:id||String(160000000000000000n+BigInt(++sequence)),guildId:district.guild,user:{id:m.discord_id},customId:kind,events,
  isButton:()=>['report','ticket'].includes(kind),isModalSubmit:()=>kind.endsWith('form'),
  fields:{getUploadedFiles:()=>new Collection(Array.from({length:files},(_,i)=>[String(i),file])),getTextInputValue:key=>{assert.equal(key,'subject');return subject;}},
  showModal:async function(modal){events.push('modal');this.modal=modal.toJSON();},
  deferReply:async function(options){events.push('defer');this.deferred=options;},editReply:async function(options){events.push('reply');this.result=options;},reply:async function(options){events.push('reply');this.result=options;}};
}
function serviceFor(i,overrides={}){return createVerifiedServices(pool,config,client,{download:async file=>{assert.equal(i.events[0],'defer');i.events.push('download');return Buffer.from(file.payload);},decode:async buffer=>{i.events.push('decode');return buffer.toString();},...overrides});}
async function submit(kind,m,options){const i=interaction(kind,m,options),service=serviceFor(i);assert.equal(await service.interact(i),true);return {i,service};}
const jobFor=async id=>(await pool.query('SELECT * FROM jobs WHERE id=$1',[id])).rows[0];
before(async()=>{
 db=new PGlite();for(const name of ['schema.sql','district-schema.sql','idrkc-schema.sql','verified-services-schema.sql','sbi-schema.sql','member-portal-schema.sql','registration-invites-schema.sql','tryouts-schema.sql'])await db.exec(await readFile(new URL('../src/'+name,import.meta.url),'utf8'));
 pool={query:async(sql,args)=>{if(sql.includes('pg_advisory_xact_lock'))return {rows:[],rowCount:1};const r=await db.query(sql,args);return {...r,rowCount:r.affectedRows||r.rows.length};},connect:async()=>({...pool,release(){}})};
 for(const [role,id,verified,active]of [['admin',adminId,true,true],['sublider',subId,true,true],['moderador',moderatorId,true,true],['recrutador',recruiterId,true,true],['admin',absentId,true,true],['admin','110000000000000011',false,true],['admin','110000000000000012',true,false]])await pool.query('INSERT INTO staff(username,password_hash,role,discord_id,discord_verified_at,active) VALUES($1,$1,$2,$3,CASE WHEN $4 THEN now() ELSE NULL END,$5)',[`staff-${id}`,role,id,verified,active]);
});
after(async()=>db?.close());

test('report asks for own card and only target nickname; ticket asks only for own card',async()=>{
 const report=serviceModal('report').toJSON(),ticket=serviceModal('ticket').toJSON();
 assert.equal(report.custom_id,'report-card-form');assert.equal(report.components.length,2);
 assert.equal(ticket.custom_id,'ticket-card-form');assert.equal(ticket.components.length,1);
 for(const modal of [report,ticket]){const card=modal.components[0].component;assert.equal(card.custom_id,'card');assert.equal(card.type,19);assert.equal(card.required,true);assert.equal(card.min_values,1);assert.equal(card.max_values,1);assert.match(modal.components[0].description,/HBCode/);}
 const nick=report.components[1].component;assert.equal(nick.custom_id,'subject');assert.equal(nick.required,true);assert.equal(nick.max_length,100);
 const m=await member();for(const kind of ['report','ticket']){const i=interaction(kind,m);await serviceFor(i).interact(i);assert.deepEqual(i.events,['modal']);}
});
test('defers privately before downloading or decoding; unknown accused nickname needs no registry entry',async()=>{
 const m=await member(),{i}=await submit('report-card-form',m,{subject:'Alvo nunca cadastrado'});
 assert.deepEqual(i.events,['defer','download','decode','reply']);assert.equal(i.deferred.flags,64);assert.deepEqual(i.deferred.allowedMentions,{parse:[]});assert.match(i.result.content,/Carteira validada/);
 const r=(await rows('reports')).at(-1);assert.equal(r.subject,'Alvo nunca cadastrado');assert.equal(r.member_id,null);assert.equal(r.reporter_member_id,m.id);assert.equal(r.reporter_idrkc,m.idrkc);assert.equal(r.reporter_id,m.discord_id);assert.equal(r.card_version,m.identity_version);
 assert.equal((await jobFor(r.notification_job_id)).kind,'verified-report-notice');assert.ok(r.reason);assert.equal(r.interaction_id,i.id);
});
test('same report interaction is idempotent and a matching accused nick is linked without demanding their card',async()=>{
 const m=await member(),target=await member(),id='169999999999999999',beforeCount=await firstOf('reports');
 await submit('report-card-form',m,{subject:target.game_nick,id});const retry=await submit('report-card-form',m,{subject:target.game_nick,id});
 assert.equal(await firstOf('reports'),beforeCount+1);assert.equal((await rows('reports')).at(-1).member_id,target.id);assert.match(retry.i.result.content,/já recebida/);
});
test('both services reject wrong owner, tampered barcode, stale, revoked and unverified credentials without records',async()=>{
 for(const kind of ['report-card-form','ticket-card-form'])for(const failure of ['wrong-owner','tamper','stale','revoked','unverified']){
  const m=await member(),original=buildCardPayload(m);let payload=original,caller=m;
  if(failure==='wrong-owner')caller=await member();
  if(failure==='tamper')payload=payload.slice(0,-1)+(payload.at(-1)==='9'?'8':'9');
  if(failure==='stale')await pool.query('UPDATE members SET identity_version=identity_version+1 WHERE id=$1',[m.id]);
  if(failure==='revoked')await pool.query('UPDATE members SET card_revoked_at=now() WHERE id=$1',[m.id]);
  if(failure==='unverified')await pool.query('UPDATE members SET verified=false WHERE id=$1',[m.id]);
  const counts=[await firstOf('reports'),await firstOf('tickets'),await firstOf('jobs')];const {i}=await submit(kind,caller,{payload});
  assert.equal(i.events.at(-1),'reply',failure);assert.doesNotMatch(i.result.content,/Carteira validada/,failure);
  assert.deepEqual([await firstOf('reports'),await firstOf('tickets'),await firstOf('jobs')],counts,failure);
 }
});
test('legacy report form cannot bypass identity, invalid upload count cannot create a case',async()=>{
 const m=await member(),legacy=interaction('report-form',m),service=serviceFor(legacy),counts=[await firstOf('reports'),await firstOf('tickets')];
 await service.interact(legacy);assert.match(legacy.result.content,/formulário foi substituído/);assert.deepEqual(legacy.events,['defer','reply']);
 for(const files of [0,2]){const {i}=await submit('report-card-form',m,{files});assert.match(i.result.content,/somente a sua carteira/);assert.deepEqual(i.events,['defer','reply']);}
 assert.deepEqual([await firstOf('reports'),await firstOf('tickets')],counts);
});
test('concurrent submission of one member is acknowledged immediately and decode failures release the guard',async()=>{
 const m=await member(),first=interaction('report-card-form',m),second=interaction('report-card-form',m);let release;
 const service=createVerifiedServices(pool,config,client,{download:async()=>new Promise(resolve=>{release=resolve;}),decode:async()=>{throw new CardVerificationError('CARD_BARCODE_UNREADABLE','Não foi possível ler.');}});
 const waiting=service.interact(first);await new Promise(resolve=>setImmediate(resolve));assert.equal(typeof release,'function');
 await service.interact(second);assert.match(second.result.content,/já está sendo conferida/);assert.deepEqual(second.events,['defer','reply']);
 release(Buffer.from('invalid'));await waiting;assert.match(first.result.content,/Não foi possível ler/);
 const third=interaction('report-card-form',m);const next=service.interact(third);await new Promise(resolve=>setImmediate(resolve));release(Buffer.from('invalid'));await next;assert.match(third.result.content,/Não foi possível ler/);
});
test('tickets are unique, recovered by marker on retry, and expose no Equipe/moderator/recruiter role',async()=>{
 const m=await member(),{service}=await submit('ticket-card-form',m),t=(await rows('tickets')).at(-1),job=await jobFor(t.notification_job_id),beforeCreated=created.length;
 await submit('ticket-card-form',m);assert.equal((await pool.query('SELECT * FROM tickets WHERE member_id=$1',[m.id])).rows.length,1);
 channelFailure=true;await assert.rejects(tx(pool,c=>service.execute(job,c)),{code:50001});channelFailure=false;
 assert.equal(created.length,beforeCreated+1);assert.equal((await pool.query('SELECT channel_id FROM tickets WHERE id=$1',[t.id])).rows[0].channel_id,null);
 await tx(pool,c=>service.execute(job,c));assert.equal(created.length,beforeCreated+1,'reuse the private channel after transaction rollback');
 const updated=(await pool.query('SELECT * FROM tickets WHERE id=$1',[t.id])).rows[0],channel=channels.get(updated.channel_id),access=channel.permissions;
 assert.deepEqual(access.find(row=>row.id===district.guild).deny,[P.ViewChannel]);
 assert.deepEqual(new Set(access.filter(row=>row.allow).map(row=>row.id)),new Set([m.discord_id,ownerId,adminId,subId,botId]));
 assert.equal(access.some(row=>[district.adminRole,moderatorId,recruiterId,absentId].includes(row.id)),false);
 const message=sendNonces.get(channel.id+':ticket-'+job.id).payload;assert.deepEqual(message.allowedMentions,{parse:[]});assert.equal(message.components[0].toJSON().components[0].custom_id,`close:${t.id}`);
 const again=await submit('ticket-card-form',m);assert.match(again.i.result.content,new RegExp(updated.channel_id));
});
test('queued tickets stop if the verified card version or owner changes before channel creation',async()=>{
 for(const change of ['identity_version=identity_version+1',"discord_id='199999999999999991'",'verified=false','card_revoked_at=now()']){
  const m=await member(),{service}=await submit('ticket-card-form',m),t=(await rows('tickets')).at(-1),job=await jobFor(t.notification_job_id),beforeCreated=created.length;
  await pool.query(`UPDATE members SET ${change} WHERE id=$1`,[m.id]);
  await assert.rejects(tx(pool,c=>service.execute(job,c)),{code:'IDRKC_CHANGED'},change);assert.equal(created.length,beforeCreated,change);
 }
});
test('a newly valid card recovers the same failed ticket and job without duplicating either record',async()=>{
 const m=await member(),{service}=await submit('ticket-card-form',m),ticket=(await rows('tickets')).at(-1),job=await jobFor(ticket.notification_job_id);
 const fresh=(await pool.query('UPDATE members SET identity_version=identity_version+1 WHERE id=$1 RETURNING *',[m.id])).rows[0];
 await assert.rejects(tx(pool,c=>service.execute(job,c)),{code:'IDRKC_CHANGED'});
 await pool.query("UPDATE jobs SET status='failed',attempts=8,error='IDRKC_CHANGED' WHERE id=$1",[job.id]);
 const counts=[await firstOf('tickets'),await firstOf('jobs')];await submit('ticket-card-form',m);
 assert.equal((await jobFor(job.id)).status,'failed','the old credential cannot restart the request');
 const retry=await submit('ticket-card-form',fresh);assert.match(retry.i.result.content,/reencaminhad|novamente|reabert|fila/i);
 assert.deepEqual([await firstOf('tickets'),await firstOf('jobs')],counts);
 const recovered=(await pool.query('SELECT * FROM tickets WHERE id=$1',[ticket.id])).rows[0],retriedJob=await jobFor(job.id);
 assert.equal(recovered.card_version,fresh.identity_version);assert.equal(recovered.idrkc,fresh.idrkc);assert.equal(recovered.notification_job_id,job.id);
 assert.equal(retriedJob.status,'pending');assert.equal(retriedJob.attempts,0);assert.equal(retriedJob.error,null);
 await tx(pool,c=>service.execute(retriedJob,c));assert.ok((await pool.query('SELECT channel_id FROM tickets WHERE id=$1',[ticket.id])).rows[0].channel_id);
});
test('report delivery commits successful administrators and retries only the recipient whose DM was blocked',async()=>{
 const m=await member(),{service}=await submit('report-card-form',m,{subject:'alvo @everyone **teste**'}),r=(await rows('reports')).at(-1),job=await jobFor(r.notification_job_id),beforeSent=dmSent.length,beforeAttempts=dmAttempts.length;
 blocked.add(subId);const outcome=await tx(pool,c=>service.execute(job,c));blocked.clear();
 assert.equal(outcome.retry.code,50007);assert.equal(dmSent.length,beforeSent+2);
 let delivered=(await pool.query('SELECT * FROM service_deliveries WHERE job_id=$1',[job.id])).rows;assert.deepEqual(new Set(delivered.map(item=>item.recipient_id)),new Set([ownerId,adminId]));
 const result=await tx(pool,c=>service.execute(job,c));assert.equal(result,undefined);assert.equal(dmSent.length,beforeSent+3);assert.equal(dmSent.at(-1).id,subId);
 delivered=(await pool.query('SELECT * FROM service_deliveries WHERE job_id=$1',[job.id])).rows;assert.equal(delivered.length,3);
 await tx(pool,c=>service.execute(job,c));assert.equal(dmSent.length,beforeSent+3,'persistent recipient records prevent duplicates even on later retries');
 const payload=dmSent.at(-1).payload;assert.deepEqual(payload.allowedMentions,{parse:[]});assert.equal(payload.enforceNonce,true);assert.match(payload.nonce,/^[a-f0-9]{24}$/);
 const deliveries=dmSent.slice(beforeSent);assert.equal(new Set(deliveries.map(d=>d.payload.nonce)).size,3,'each recipient needs a distinct nonce');
 for(const delivery of deliveries)assert.match(delivery.payload.nonce,/^[a-f0-9]{24}$/,'nonce fits Discord 25-character limit');
 const retriedAttempts=dmAttempts.slice(beforeAttempts).filter(d=>d.id===subId);assert.equal(retriedAttempts.length,2);assert.equal(retriedAttempts[0].payload.nonce,retriedAttempts[1].payload.nonce,'recipient nonce remains stable on retry');
 const embed=payload.embeds[0].toJSON();assert.match(embed.description,new RegExp(`https://discord.com/users/${m.discord_id}`));assert.match(embed.description,new RegExp(m.idrkc));assert.equal(embed.description.includes('@everyone'),false);
});

test('download accepts signed normal and ephemeral Discord attachments and rejects redirects',async()=>{
 for(const host of ['cdn.discordapp.com','media.discordapp.net'])for(const route of ['attachments','ephemeral-attachments']){
  const signed=`https://${host}/${route}/123/456/carteira.png?ex=abc&is=def&hm=0123456789`,calls=[];
  const buffer=await downloadCardAttachment({...attachment,url:signed},{fetchImpl:async(url,options)=>{calls.push({url,options});return new Response(Uint8Array.from([1,2,3]),{headers:{'content-length':'3'}});}});
  assert.deepEqual(buffer,Buffer.from([1,2,3]));assert.equal(calls.length,1);assert.equal(calls[0].url.href,signed);assert.equal(calls[0].options.redirect,'error');assert.ok(calls[0].options.signal instanceof AbortSignal);
 }
 let fetched=0;const fetchImpl=async()=>{fetched++;throw Error('must not fetch');};
 for(const url of ['http://cdn.discordapp.com/attachments/1/2/a.png','https://example.com/attachments/a.png','https://cdn.discordapp.com.evil.test/attachments/a.png','https://127.0.0.1/attachments/a.png','https://cdn.discordapp.com@evil.test/attachments/a.png','https://x:y@cdn.discordapp.com/attachments/a.png','https://cdn.discordapp.com:9443/attachments/a.png','https://cdn.discordapp.com/icons/1/a.png','file:///etc/passwd'])await assert.rejects(downloadCardAttachment({...attachment,url},{fetchImpl}),{code:'CARD_UPLOAD_INVALID'});
 for(const url of ['https://cdn.discordapp.com.evil.test/ephemeral-attachments/1/2/a.png','https://media.discordapp.net.evil.test/ephemeral-attachments/1/2/a.png','https://user:pass@cdn.discordapp.com/ephemeral-attachments/1/2/a.png','https://media.discordapp.net:9443/ephemeral-attachments/1/2/a.png','https://cdn.discordapp.com/ephemeral-attachments-other/1/2/a.png','https://cdn.discordapp.com/attachments-other/1/2/a.png','https://cdn.discordapp.com/icons/ephemeral-attachments/1/2/a.png','https://cdn.discordapp.com/ephemeral-attachments/../icons/a.png'])await assert.rejects(downloadCardAttachment({...attachment,url},{fetchImpl}),{code:'CARD_UPLOAD_INVALID'});
 assert.equal(fetched,0);
 await assert.rejects(downloadCardAttachment(attachment,{fetchImpl:async(_url,options)=>{assert.equal(options.redirect,'error');throw new TypeError('unexpected redirect');}}),TypeError);
});
test('real modal file resolution downloads an ephemeral PNG card and binds ticket creation to its owner',async()=>{
 const m=await member(),other=await member(),png=await renderCard(m,'DISTRITO ROKUHARA KAGE CLAN');
 const fileId='170000000000000001',url=`https://cdn.discordapp.com/ephemeral-attachments/${botId}/${fileId}/carteira.png?ex=abc&is=def&hm=0123456789`;
 const resolved={attachments:{[fileId]:{id:fileId,filename:'carteira.png',size:png.length,content_type:'image/png',ephemeral:true,url,proxy_url:url,width:1600,height:1100}}};
 const component={type:18,id:1,component:{type:19,id:2,custom_id:'card',values:[fileId]}};
 const fields=new ModalSubmitFields([ModalSubmitInteraction.transformComponent(component,resolved)]);
 const uploaded=fields.getUploadedFiles('card',true).first();assert.equal(uploaded.ephemeral,true);assert.equal(uploaded.contentType,'image/png');
 const service=createVerifiedServices(pool,config,client,{download:file=>downloadCardAttachment(file,{fetchImpl:async request=>{assert.equal(request.href,url);return new Response(png,{headers:{'content-length':String(png.length)}});}})});
 const beforeCount=await firstOf('tickets');
 const outsider=interaction('ticket-card-form',other);outsider.fields=fields;await service.interact(outsider);
 assert.match(outsider.result.content,/própria carteira/);assert.equal(await firstOf('tickets'),beforeCount);
 const owner=interaction('ticket-card-form',m);owner.fields=fields;await service.interact(owner);
 assert.match(owner.result.content,/Carteira validada/);assert.equal(await firstOf('tickets'),beforeCount+1);
 const ticket=(await rows('tickets')).at(-1);assert.equal(ticket.user_id,m.discord_id);assert.equal(ticket.member_id,m.id);
});
test('download enforces declared and streamed byte limits, type and upstream success',async()=>{
 const limit=8*1024*1024;
 for(const changes of [{size:0},{size:NaN},{size:limit+1},{contentType:'image/svg+xml'},{contentType:'application/pdf'}])await assert.rejects(downloadCardAttachment({...attachment,...changes},{fetchImpl:async()=>{throw Error('must not fetch');}}),{code:'CARD_UPLOAD_INVALID'});
 let cancelled=false;
 await assert.rejects(downloadCardAttachment(attachment,{fetchImpl:async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(1));},cancel(){cancelled=true;}}),{headers:{'content-length':String(limit+1)}})}),{code:'CARD_UPLOAD_INVALID'});assert.equal(cancelled,true);
 await assert.rejects(downloadCardAttachment(attachment,{fetchImpl:async()=>new Response(new Uint8Array(limit+1))}),{code:'CARD_UPLOAD_INVALID'});
 await assert.rejects(downloadCardAttachment(attachment,{fetchImpl:async()=>new Response('gone',{status:404})}),{code:'CARD_UPLOAD_INVALID'});
});


test('a verified card without tryout admission cannot create member support channels',async()=>{
 const m=await member(),i=interaction('ticket-card-form',m),before=await firstOf('tickets');
 const gated=createVerifiedServices(pool,{...config,tryouts:{enabled:true}},client,{download:async file=>Buffer.from(file.payload),decode:async buffer=>buffer.toString()});
 await gated.interact(i);
 assert.match(i.result.content,/tryout e o cadastro obrigatório/);
 assert.equal(await firstOf('tickets'),before);
});
