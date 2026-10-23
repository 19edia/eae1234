import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import express from 'express';
import request from 'supertest';
import {PGlite} from '@electric-sql/pglite';
import {normalizeEmbedPayload,embedCharacterCount} from '../src/embed-payload.js';
import {embedPublicationRoutes,createEmbedPublications,listMemberEmbedPublications} from '../src/embed-publications.js';
import {tx} from '../src/db.js';

const rich={title:'Distrito ROKUHARA KAGE CLAN',description:'**Quarta-feira:** uma nova história. 🟠',url:'https://discord.com/channels/111/222',color:'#f58a3c',author:{name:'Administração',url:'https://discord.com/',icon_url:'https://cdn.discordapp.com/icons/a.png'},thumbnail:{url:'https://cdn.discordapp.com/icons/b.png'},image:{url:'https://cdn.discordapp.com/attachments/card.png'},fields:[{name:'Quando',value:'Quarta-feira',inline:true},{name:'Onde',value:'No distrito',inline:false}],footer:{text:'Comunicado oficial',icon_url:'https://cdn.discordapp.com/icons/c.png'},timestamp:'2026-10-07T20:00:00-03:00'};
test('normalizes one complete embed, preserving the same data for Discord and the browser',()=>{
 const payload=normalizeEmbedPayload(JSON.stringify(rich));
 assert.equal(payload.embeds[0].color,0xf58a3c);assert.equal(payload.embeds[0].timestamp,'2026-10-07T23:00:00.000Z');
 assert.equal(payload.embeds[0].author.icon_url,rich.author.icon_url);assert.deepEqual(payload.embeds[0].fields,rich.fields);
 assert.deepEqual(payload.allowedMentions,{parse:[]});assert.deepEqual(normalizeEmbedPayload(payload),payload);
 assert.equal(rich.color,'#f58a3c');assert.ok(embedCharacterCount(payload)>100);
});
test('accepts content-only and multiple embeds, always stripping requested pings',()=>{
 const payload=normalizeEmbedPayload({content:'@everyone <@123456789012345678> atualização',embeds:[{title:'Um'},{title:'Dois'}],allowed_mentions:{parse:['everyone','roles','users']}});
 assert.deepEqual(payload.allowedMentions,{parse:[]});assert.equal(payload.allowed_mentions,undefined);
 assert.equal(payload.embeds.length,2);assert.equal(normalizeEmbedPayload({content:'Aviso'}).content,'Aviso');
 assert.equal(normalizeEmbedPayload({title:'RGB',color:'0xFF0000'}).embeds[0].color,0xff0000);
});
test('enforces Discord field limits and the total across every embed',()=>{
 for(const value of [
  {title:'a'.repeat(257)}, {description:'a'.repeat(4097)}, {author:{name:'a'.repeat(257)}},
  {footer:{text:'a'.repeat(2049)}}, {fields:[{name:'a'.repeat(257),value:'ok'}]},
  {fields:[{name:'ok',value:'a'.repeat(1025)}]}, {fields:Array.from({length:26},()=>({name:'ok',value:'ok'}))},
  {embeds:Array.from({length:11},()=>({title:'ok'}))}, {content:'a'.repeat(2001)},
  {embeds:[{description:'a'.repeat(3001)},{description:'a'.repeat(3000)}]}
 ])assert.throws(()=>normalizeEmbedPayload(value),error=>error.status===400);
 const exact=normalizeEmbedPayload({embeds:[{description:'a'.repeat(3000)},{description:'a'.repeat(3000)}]});assert.equal(embedCharacterCount(exact),6000);
});
test('rejects malformed, unsafe, unsupported and empty payloads before enqueueing',()=>{
 for(const value of ['{broken',null,[],{}, {color:123}, {embeds:[]}, {embeds:[null]},
  {description:'ok',color:-1}, {description:'ok',color:16777216}, {description:'ok',color:'orange'},
  {fields:[{name:'A',value:'B',inline:'yes'}]}, {title:'ok',timestamp:'not-a-date'},
  {title:'ok',type:'video'}, {content:'ok',components:[]}, {content:'ok',attachments:[]},
  {content:'ok',username:'A different bot'}, {title:'ok',author:{name:'Bot',proxy_icon_url:'https://x.com'}},
  '{"title":"ok","__proto__":{"polluted":true}}',
  {embeds:[{title:'A',url:'https://example.com'},{title:'B',url:'https://example.com/'}]},
  {title:'x'.repeat(100000)}
 ])assert.throws(()=>normalizeEmbedPayload(value),error=>error.status===400);
 assert.equal({}.polluted,undefined);
 for(const url of ['javascript:alert(1)','data:image/png;base64,abc','http://example.com/a.png','https://localhost/a.png','https://127.0.0.1/a.png','https://[::1]/a.png','https://192.168.0.1/a.png','https://service.internal/a.png','https://user:pass@example.com/a.png'])assert.throws(()=>normalizeEmbedPayload({image:{url}}),error=>error.status===400);
});

let db,pool,app,service,admin,subleader,offline=false,sent=[];
const district={id:1,guild:'111111111111111111',news:'222222222222222222'},config={divisions:[district]};
const channel={id:district.news,guildId:district.guild,isTextBased:()=>true,send:async payload=>{if(offline)throw Object.assign(Error('Discord unavailable'),{code:50001});sent.push(payload);return {id:String(333333333333333330n+BigInt(sent.length))};}};
const action=(method,path,body,role='admin')=>request(app)[method]('/api/embed-publications'+path).set('x-test-role',role).set('x-csrf-token','test-csrf').send(body);
const create=async(payload={embeds:[rich]},extra={})=>(await action('post','',{payload,request_id:randomUUID(),...extra}).expect(202)).body;
const jobFor=async id=>(await pool.query('SELECT * FROM jobs WHERE id=$1',[id])).rows[0];
const deliver=async publication=>tx(pool,async c=>{await service.execute(await jobFor(publication.job_id),c);await c.query("UPDATE jobs SET status='sent',error=NULL WHERE id=$1",[publication.job_id]);});
before(async()=>{
 db=new PGlite();for(const name of ['schema.sql','district-schema.sql','embed-publications-schema.sql'])await db.exec(await readFile(new URL('../src/'+name,import.meta.url),'utf8'));
 pool={query:async(sql,args)=>{const result=await db.query(sql,args);return {...result,rowCount:result.affectedRows||result.rows.length};},connect:async()=>({...pool,release(){}})};
 admin=(await pool.query("INSERT INTO staff(username,password_hash,role) VALUES('embed-admin','hash','admin') RETURNING id")).rows[0].id;
 subleader=(await pool.query("INSERT INTO staff(username,password_hash,role) VALUES('embed-sub','hash','sublider') RETURNING id")).rows[0].id;
 app=express();app.use(express.json({limit:'128kb'}));
 app.use('/api',(req,res,next)=>{const role=req.get('x-test-role');if(!role)return res.sendStatus(401);req.auth={role,staff_id:role==='sublider'?subleader:admin};if(req.method!=='GET'&&req.get('x-csrf-token')!=='test-csrf')return res.sendStatus(403);next();});
 embedPublicationRoutes(app,pool,config);app.use((error,_req,res,_next)=>res.status(error.status||500).json({error:error.message}));
 service=createEmbedPublications(pool,config,{channels:{fetch:async()=>channel}});
});
after(async()=>db?.close());

test('requires administrator/subleader access and CSRF for publication and preview',async()=>{
 await request(app).get('/api/embed-publications').expect(401);
 for(const role of ['moderador','recrutador','membro']){
  await action('get','',undefined,role).expect(403);await action('post','/preview',{payload:rich},role).expect(403);await action('post','',{payload:rich},role).expect(403);
 }
 await request(app).post('/api/embed-publications/preview').set('x-test-role','admin').send({payload:rich}).expect(403);
 const preview=await action('post','/preview',{payload:rich},'sublider').expect(200);assert.equal(preview.body.payload.embeds[0].title,rich.title);
 const sub=await action('post','',{payload:{title:'Sub líder'},request_id:randomUUID()},'sublider').expect(202);assert.equal(sub.body.status,'pending');
});
test('queues a validated payload once, keeps pending content out of the member feed and detects reused keys',async()=>{
 const id=randomUUID(),publication=await create({embeds:[rich]},{request_id:id});
 const repeat=await create({embeds:[rich]},{request_id:id});assert.equal(publication.id,repeat.id);assert.equal(publication.job_id,repeat.job_id);
 assert.equal(publication.status,'pending');assert.equal(publication.published_at,null);assert.equal(publication.message_url,null);
 assert.equal((await listMemberEmbedPublications(pool)).some(item=>item.id===publication.id),false);
 assert.equal((await pool.query("SELECT count(*)::int AS count FROM jobs WHERE kind='embed-publication' AND payload->>'publicationId'=$1",[String(publication.id)])).rows[0].count,1);
 await action('post','',{payload:{title:'Outro conteúdo'},request_id:id}).expect(409);
 await action('post','',{payload:{embeds:[rich]},request_id:id},'sublider').expect(409);
 await action('post','',{payload:{title:'Inválido'},request_id:'bad'}).expect(400);
 assert.equal((await pool.query('SELECT * FROM embed_publications WHERE id=$1',[publication.id])).rows[0].payload.allowedMentions.parse.length,0);
});
test('delivery publishes identical embeds to Discord and members, and never sends a completed publication twice',async()=>{
 const publication=await create({content:'Aviso @everyone',embeds:[rich]});const beforeCount=sent.length;
 await deliver(publication);assert.equal(sent.length,beforeCount+1);assert.equal(sent.at(-1).nonce,String(publication.job_id));assert.equal(sent.at(-1).enforceNonce,true);
 const item=(await listMemberEmbedPublications(pool)).find(item=>item.id===publication.id);assert.ok(item);assert.deepEqual(item.payload,publication.payload);
 const {nonce,enforceNonce,...delivered}=sent.at(-1);assert.deepEqual(delivered,item.payload);assert.match(item.message_url,/https:\/\/discord\.com\/channels\//);
 assert.equal(item.error,undefined);assert.equal(item.job_id,undefined);
 await deliver(publication);assert.equal(sent.length,beforeCount+1);
 await action('post',`/${publication.id}/retry`,{}).expect(409);
});
test('Discord failure rolls back publication, exposes queue error and retries with the same job nonce',async()=>{
 const publication=await create({title:'Reenvio'});offline=true;
 await assert.rejects(deliver(publication),{code:50001});offline=false;
 assert.equal((await listMemberEmbedPublications(pool)).some(item=>item.id===publication.id),false);
 await pool.query("UPDATE jobs SET status='failed',error='Discord: Missing Access',attempts=8 WHERE id=$1",[publication.job_id]);
 const failed=(await action('get','').expect(200)).body.find(item=>item.id===publication.id);assert.equal(failed.status,'failed');assert.match(failed.error,/Missing Access/);
 const retry=(await action('post',`/${publication.id}/retry`,{}).expect(202)).body;assert.equal(retry.status,'pending');assert.equal(retry.attempts,0);assert.equal(retry.error,null);assert.equal(retry.job_id,publication.job_id);
 await action('post',`/${publication.id}/retry`,{}).expect(409);await deliver(publication);assert.equal(sent.at(-1).nonce,String(publication.job_id));
});
test('publishing requires the SBI news channel and a queued post cannot move to another server',async()=>{
 const publication=await create({title:'Destino fixo'});const previous=config.divisions;
 config.divisions=[];await action('post','',{payload:{title:'Sem distrito'}}).expect(409);await action('post','/preview',{payload:{title:'Prévia funciona sem distrito'}}).expect(200);
 config.divisions=[{...district,guild:'999999999999999999'}];await assert.rejects(deliver(publication),{code:'EMBED_DESTINATION_CHANGED'});config.divisions=previous;
 const oldGuild=channel.guildId;channel.guildId='999999999999999999';await assert.rejects(deliver(publication),{code:'EMBED_CHANNEL_INVALID'});channel.guildId=oldGuild;
 assert.equal((await listMemberEmbedPublications(pool)).some(item=>item.id===publication.id),false);
});
