import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import bwipjs from 'bwip-js';
import {PGlite} from '@electric-sql/pglite';
import {ModalSubmitFields,ModalSubmitInteraction} from 'discord.js';
import {createBot} from '../src/bot.js';
import {renderCard} from '../src/cards.js';
import {buildCardPayload} from '../src/idrkc.js';
import {downloadCardAttachment} from '../src/verified-services.js';
import {hash} from '../src/security.js';

// Exercise the production bot router, Discord's file-field resolution, bounded
// download, real pixel decoder and PostgreSQL queries. Only Discord HTTP is local.
const guild='180000000000000001';
const config={secret:'hbcode-bot-regression-secret'.repeat(3),tryouts:{enabled:false},divisions:[{id:1,guild}]};
const uploads=new Map();
let db,pool,bot,sequence=0,downloaded=0;
const count=async table=>Number((await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n);
const challenge=async member=>(await pool.query('SELECT * FROM confirmations WHERE member_id=$1',[member.id])).rows[0];
async function member(){
 const n=++sequence;
 return (await pool.query('INSERT INTO members(ifj,name,game_nick,roblox_username,discord_id,division,verified,member_rank) VALUES($1,$2,$3,$4,$5,1,false,$6) RETURNING *',[
  String(n).padStart(15,'0'),`Titular real ${n}`,`Combatente${n}`,`Roblox${n}`,String(181000000000000000n+BigInt(n)),n%2?'Veterano':'Recrutador'
 ])).rows[0];
}
function interaction(customId,m){
 return {customId,guildId:guild,user:{id:m.discord_id},events:[],isButton:()=>!customId.endsWith('-form'),isModalSubmit:()=>customId.endsWith('-form'),isChatInputCommand:()=>false,
  showModal:async function(modal){this.modal=modal.toJSON();this.events.push('modal');},
  deferReply:async function(value){assert.equal(value.flags,64);this.events.push('defer');},
  deferUpdate:async function(){this.events.push('defer-update');},
  editReply:async function(value){this.result=value;this.events.push('reply');},
  reply:async function(value){this.result=value;this.events.push('reply');}
 };
}
function uploadInteraction(m,image,type='image/png'){
 const i=interaction('verify-card-form',m),fileId=String(182000000000000000n+BigInt(++sequence));
 const url=`https://cdn.discordapp.com/ephemeral-attachments/183000000000000001/${fileId}/carteira.${type.split('/')[1]}?ex=abc&is=def&hm=0123456789`;
 uploads.set(url,{image,interaction:i});
 const attachment={id:fileId,filename:'carteira.'+type.split('/')[1],size:image.length,content_type:type,ephemeral:true,url,proxy_url:url,width:1600,height:1100};
 const component={type:18,id:1,component:{type:19,id:2,custom_id:'card',values:[fileId]}};
 i.fields=new ModalSubmitFields([ModalSubmitInteraction.transformComponent(component,{attachments:{[fileId]:attachment}})]);
 return i;
}
async function submit(m,image,type){const i=uploadInteraction(m,image,type);await bot.handleInteraction(i);assert.deepEqual(i.events,['defer','download','reply']);return i;}
async function exportCard(png,format){const image=await loadImage(png),canvas=createCanvas(image.width,image.height);canvas.getContext('2d').drawImage(image,0,0);return canvas.encode(format,94);}
before(async()=>{
 db=new PGlite();
 for(const name of ['schema.sql','district-schema.sql','idrkc-schema.sql'])await db.exec(await readFile(new URL('../src/'+name,import.meta.url),'utf8'));
 pool={query:async(sql,args)=>{const result=await db.query(sql,args);return {...result,rowCount:result.affectedRows||result.rows.length};},connect:async()=>({...pool,release(){}})};
 bot=createBot(pool,config,{verification:{download:file=>downloadCardAttachment(file,{fetchImpl:async(url,options)=>{
  assert.equal(options.redirect,'error');const found=uploads.get(url.href);assert.ok(found,'only the current Discord attachment is downloaded');assert.equal(found.interaction.events[0],'defer');found.interaction.events.push('download');downloaded++;
  return new Response(found.image,{headers:{'content-length':String(found.image.length)}});
 }})}});
});
after(async()=>{await bot?.stop();await db?.close();});

test('the existing bot upload flow identifies two different complete HBCode cards after image export',async()=>{
 const owners=[await member(),await member()];assert.notEqual(owners[0].idrkc,owners[1].idrkc);
 for(const [n,m]of owners.entries()){
  // Visible text is untrusted: only the current database name and rank can appear
  // in the confirmation, even if someone edits the surrounding card graphics.
  const png=await renderCard({...m,name:'Nome visual adulterado',member_rank:'Líder'},'GUILDA HRISTE BOZE');
  const i=await submit(m,n?await exportCard(png,'webp'):png,n?'image/webp':'image/png');
  assert.match(i.result.content,new RegExp(m.name));assert.match(i.result.content,new RegExp(m.member_rank));assert.doesNotMatch(i.result.content,/Nome visual adulterado/);
  const proof=await challenge(m);assert.equal(proof.discord_id,m.discord_id);assert.equal(proof.card_proof_hash,hash(buildCardPayload(m),config.secret));
  const confirm=interaction('confirm:'+proof.token,m);await bot.handleInteraction(confirm);assert.match(confirm.result.content,/Dados confirmados/);
  assert.equal((await pool.query('SELECT verified FROM members WHERE id=$1',[m.id])).rows[0].verified,true);
  assert.equal((await pool.query("SELECT * FROM jobs WHERE kind='sync-role' AND payload->>'discordId'=$1",[m.discord_id])).rowCount,1);
 }
 assert.equal(downloaded,2);
});

test('complete HBCode uploads reject copied, revoked, missing, forged and stale credentials without granting access',async()=>{
 const cases=[
  ['copied',/própria carteira/],['revoked',/revogada/],['missing',/cadastro não existe/],['forged',/inválido ou foi alterado/],['stale',/desatualizada/]
 ];
 for(const [kind,message]of cases){
  const m=await member();let renderMember=m,caller=m;
  if(kind==='copied')caller=await member();
  if(kind==='forged')renderMember={...m,card_secret:'11111111-2222-4333-8444-555555555555'};
  const png=await renderCard(renderMember,'GUILDA HRISTE BOZE');
  if(kind==='revoked')await pool.query('UPDATE members SET card_revoked_at=now() WHERE id=$1',[m.id]);
  if(kind==='missing')await pool.query('DELETE FROM members WHERE id=$1',[m.id]);
  if(kind==='stale')await pool.query('UPDATE members SET identity_version=identity_version+1 WHERE id=$1',[m.id]);
  const before=[await count('confirmations'),await count('jobs')],i=await submit(caller,png);
  assert.equal(typeof i.result,'string',kind);assert.match(i.result,message,kind);
  assert.deepEqual([await count('confirmations'),await count('jobs')],before,kind);
  if(kind!=='missing')assert.equal((await pool.query('SELECT verified FROM members WHERE id=$1',[m.id])).rows[0].verified,false,kind);
 }
});

test('an unreadable code on the complete card is rejected by the production pixel decoder',async()=>{
 const m=await member(),png=await renderCard(m,'GUILDA HRISTE BOZE'),image=await loadImage(png),canvas=createCanvas(image.width,image.height),c=canvas.getContext('2d');
 c.drawImage(image,0,0);c.fillStyle='#000';c.fillRect(542,902,950,88);
 const before=await count('jobs'),i=await submit(m,await canvas.encode('png'));
 assert.equal(typeof i.result,'string');assert.doesNotMatch(i.result,/Carteira conferida/);assert.equal(await challenge(m),undefined);assert.equal(await count('jobs'),before);
});

test('a previously issued signed Code128 card remains usable through the same bot upload flow',async()=>{
 const m=await member(),png=await renderCard(m,'GUILDA HRISTE BOZE'),image=await loadImage(png),canvas=createCanvas(image.width,image.height),c=canvas.getContext('2d');
 const legacy=await loadImage(await bwipjs.toBuffer({bcid:'code128',text:buildCardPayload(m),scale:2,height:12,includetext:false,paddingwidth:12,paddingheight:4,backgroundcolor:'FFFFFF',barcolor:'000000'}));
 c.drawImage(image,0,0);c.fillStyle='#fff';c.fillRect(542,902,950,88);c.imageSmoothingEnabled=false;c.drawImage(legacy,Math.round(1017-legacy.width/2),Math.round(946-legacy.height/2));
 const i=await submit(m,await canvas.encode('png'));assert.match(i.result.content,new RegExp(m.name));assert.equal((await challenge(m)).card_proof_hash,hash(buildCardPayload(m),config.secret));
 assert.equal((await pool.query('SELECT verified FROM members WHERE id=$1',[m.id])).rows[0].verified,false,'old cards still need their owner to confirm');
});

test('two vertically aligned copies of a legacy credential cannot create an upload confirmation',async()=>{
 const m=await member(),legacy=await loadImage(await bwipjs.toBuffer({bcid:'code128',text:buildCardPayload(m),scale:2,height:12,paddingwidth:12,paddingheight:4,backgroundcolor:'FFFFFF',barcolor:'000000'}));
 // ZXing can merge aligned, identical Code128 rows into one tall symbol. The
 // production decoder must still reject the two separate physical regions.
 const canvas=createCanvas(legacy.width+40,legacy.height*2+80),c=canvas.getContext('2d');
 c.fillStyle='#fff';c.fillRect(0,0,canvas.width,canvas.height);c.drawImage(legacy,20,30);c.drawImage(legacy,20,legacy.height+60);
 const rotated=createCanvas(canvas.height,canvas.width),r=rotated.getContext('2d');r.translate(canvas.height,0);r.rotate(Math.PI/2);r.drawImage(canvas,0,0);
 const before=[await count('confirmations'),await count('jobs')];
 for(const [label,image]of [['vertical copies',canvas],['rotated copies',rotated]]){
  const i=await submit(m,await image.encode('png'));
  assert.equal(typeof i.result,'string',label);assert.match(i.result,/somente uma carteira/,label);
  assert.equal(await challenge(m),undefined,label);assert.deepEqual([await count('confirmations'),await count('jobs')],before,label);
 }
 assert.equal((await pool.query('SELECT verified FROM members WHERE id=$1',[m.id])).rows[0].verified,false);
});
