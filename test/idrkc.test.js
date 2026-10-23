import {test,before} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import bwipjs from 'bwip-js';
import {buildCardPayload,parseCardPayload,verifyCardPayload,verifyCardBuffer,publicCardMember,ensureIdrkcIdentity} from '../src/idrkc.js';
import {renderCardBarcode,decodeCardBarcode,inspectCardImage,MAX_CARD_IMAGE_BYTES} from '../src/barcode.js';
import {renderCard,cardFields} from '../src/cards.js';
import {DISTRICT_NAME} from '../src/brand.js';

const member={id:42,name:'Lukas Kage',game_nick:'Lukas Kage',roblox_username:'LukasRokuhara',discord_id:'123456789012345678',ifj:'000123456789012',idrkc:'1042000000000042',card_secret:'be3dc854-77cc-4a62-856f-0493f58e84a5',identity_version:2,created_at:'2026-09-22T12:00:00Z',verified:true,suspect:false,account_kind:'membro',member_rank:'Membro'};
const fakePool=value=>({query:async(text,args)=>({rows:value&&args[0]===value.idrkc?[value]:[]})});
const options={discordId:member.discord_id};
const rejectsCode=(promise,code)=>assert.rejects(promise,error=>error.code===code,code);
let card;
before(async()=>{card=await renderCard(member,DISTRICT_NAME,{issuedAt:new Date('2026-10-07T12:00:00Z')});});

test('IDRKC schema upgrades existing rows once, preserves accounts and never reuses identifiers',async()=>{
 const db=new PGlite();
 try{
  await db.exec(await readFile(new URL('../src/schema.sql',import.meta.url),'utf8'));
  await db.query("INSERT INTO members(ifj,name,game_nick,roblox_username,discord_id,division,verified) VALUES('000123456789012','Titular original','Nick','Roblox','123456789012345678',1,true)");
  const sql=await readFile(new URL('../src/idrkc-schema.sql',import.meta.url),'utf8');
  await db.exec(sql);const first=(await db.query('SELECT * FROM members')).rows[0];
  assert.match(first.idrkc,/^\d{16}$/);assert.match(first.card_secret,/^[\da-f-]{36}$/);assert.equal(first.ifj,'000123456789012');assert.equal(first.name,'Titular original');assert.equal(first.verified,true);
  await db.exec(sql);const again=(await db.query('SELECT * FROM members')).rows[0];assert.equal(again.idrkc,first.idrkc);assert.equal(again.card_secret,first.card_secret);assert.equal(again.identity_version,first.identity_version);
  assert.equal((await ensureIdrkcIdentity(db,first.id)).idrkc,first.idrkc);
  await db.query('DELETE FROM members WHERE id=$1',[first.id]);
  await db.query("INSERT INTO members(ifj,name,game_nick,roblox_username,discord_id,division) VALUES('000123456789013','Novo titular','Novo','Roblox2','223456789012345678',1)");
  const second=(await db.query('SELECT * FROM members')).rows[0];assert.notEqual(second.idrkc,first.idrkc);assert.notEqual(second.card_secret,first.card_secret);
  assert.equal((await db.query('SELECT count(*)::int n FROM used_idrkcs')).rows[0].n,2);
 }finally{await db.close();}
});

test('cards show HB-ID instead of legacy IFJ and preserve all five role crests',async()=>{
 assert.equal(cardFields(member,DISTRICT_NAME).at(-1).label,'HB-ID');assert.equal(cardFields(member,DISTRICT_NAME).at(-1).value,member.idrkc);
 assert.equal(cardFields(member,DISTRICT_NAME).some(x=>x.value===member.ifj),false);
 const hashes=new Set();
 for(const change of [{member_rank:'Membro'},{member_rank:'Líder'},{member_rank:'Sub líder'},{member_rank:'High member'},{account_kind:'aliado',allied_gang:'Ryuketsu',member_rank:'Aliado'}]){
  const png=await renderCard({...member,...change},DISTRICT_NAME,{issuedAt:new Date('2026-10-07T12:00:00Z')});
  assert.equal(await decodeCardBarcode(png),buildCardPayload(member));hashes.add(png.toString('base64'));
 }
 assert.equal(hashes.size,5);
});

test('real HBCode decodes from PNG, JPEG, WebP, crop, resized card and rotation',async()=>{
 const expected=buildCardPayload(member),image=await loadImage(card);
 assert.equal(expected.length,60);assert.match(expected,/^7201\d{56}$/);assert.deepEqual(parseCardPayload(expected),{idrkc:member.idrkc,version:2});
 const canvas=createCanvas(image.width,image.height);canvas.getContext('2d').drawImage(image,0,0);
 const inputs=[['original PNG',card],['JPEG',await canvas.encode('jpeg',90)],['WebP',await canvas.encode('webp',92)]];
 const cropped=createCanvas(950,88);cropped.getContext('2d').drawImage(image,542,902,950,88,0,0,950,88);inputs.push(['cropped barcode',await cropped.encode('png')]);
 const resized=createCanvas(1280,880);resized.getContext('2d').drawImage(image,0,0,1280,880);inputs.push(['80 percent resize',await resized.encode('png')]);
 const rotated=createCanvas(image.height,image.width),r=rotated.getContext('2d');r.translate(image.height,0);r.rotate(Math.PI/2);r.drawImage(image,0,0);inputs.push(['90 degree rotation',await rotated.encode('png')]);
 for(const [label,buffer]of inputs){assert.equal(await decodeCardBarcode(buffer),expected,label);const safe=await verifyCardBuffer(fakePool(member),buffer,options);assert.equal(safe.idrkc,member.idrkc,label);assert.equal('card_secret'in safe,false,label);}
});

test('signature rejects changed payload, stale revision, changed owner, revoked and unverified cards',async()=>{
 const payload=buildCardPayload(member),pool=fakePool(member);
 assert.equal((await verifyCardPayload(pool,payload,options)).name,member.name);
 const tampered=payload.slice(0,-1)+(payload.at(-1)==='9'?'8':'9');
 await rejectsCode(verifyCardBuffer(pool,await renderCardBarcode(tampered),options),'CARD_SIGNATURE_INVALID');
 await rejectsCode(verifyCardPayload(fakePool({...member,identity_version:3}),payload,options),'CARD_STALE');
 await rejectsCode(verifyCardPayload(pool,payload,{discordId:'223456789012345678'}),'CARD_WRONG_OWNER');
 await rejectsCode(verifyCardPayload(fakePool({...member,discord_id:'223456789012345678'}),payload,{discordId:'223456789012345678'}),'CARD_SIGNATURE_INVALID');
 await rejectsCode(verifyCardPayload(fakePool({...member,card_revoked_at:new Date()}),payload,options),'CARD_REVOKED');
 await rejectsCode(verifyCardPayload(fakePool(null),payload,options),'CARD_REVOKED');
 await rejectsCode(verifyCardPayload(fakePool({...member,verified:false}),payload,options),'CARD_NOT_VERIFIED');
 await rejectsCode(verifyCardPayload(pool,payload,{}),'CARD_OWNER_REQUIRED');
 await rejectsCode(verifyCardPayload(fakePool({...member,card_secret:'ce3dc854-77cc-4a62-856f-0493f58e84a5'}),payload,options),'CARD_SIGNATURE_INVALID');
 assert.equal('card_secret'in publicCardMember(member),false);
 assert.throws(()=>buildCardPayload({...member,card_secret:undefined}),{code:'CARD_NOT_READY'});
});

test('transactional verification locks the current owner row and concurrent decoding stays bounded',async()=>{
 let locked=false;
 const transaction={query:async(sql,args)=>{assert.match(sql,/WHERE idrkc=\$1 FOR SHARE$/);assert.equal(args[0],member.idrkc);locked=true;return {rows:[member]};}};
 const safe=await verifyCardPayload(transaction,buildCardPayload(member),{...options,lock:true});assert.equal(locked,true);assert.equal(safe.identity_version,2);
 const decoding=decodeCardBarcode(card);
 await rejectsCode(decodeCardBarcode(card),'CARD_DECODER_BUSY');
 assert.equal(await decoding,buildCardPayload(member));
 // Slots are released after the completed worker, including termination cleanup.
 assert.equal(await decodeCardBarcode(card),buildCardPayload(member));
});

test('decoder rejects old arbitrary barcodes, malformed images, excessive bounds and ambiguous cards',async()=>{
 await rejectsCode(decodeCardBarcode(Buffer.from('<svg><text>not an image</text></svg>')),'CARD_IMAGE_INVALID');
 const large=Buffer.alloc(MAX_CARD_IMAGE_BYTES+1);await rejectsCode(decodeCardBarcode(large),'CARD_IMAGE_TOO_LARGE');
 const invalidDims=Buffer.from(card);invalidDims.writeUInt32BE(50000,16);assert.throws(()=>inspectCardImage(invalidDims),{code:'CARD_IMAGE_DIMENSIONS'});
 await rejectsCode(decodeCardBarcode(card.subarray(0,40)),'CARD_IMAGE_INVALID');
 const blank=createCanvas(1600,1100);blank.getContext('2d').fillRect(0,0,1600,1100);await rejectsCode(decodeCardBarcode(await blank.encode('png')),'CARD_BARCODE_UNREADABLE');
 const legacy=await bwipjs.toBuffer({bcid:'code128',text:member.ifj,scale:2,height:15,paddingwidth:12,paddingheight:6,backgroundcolor:'FFFFFF'});await rejectsCode(decodeCardBarcode(legacy),'CARD_BARCODE_INVALID');
 const one=await loadImage(await renderCardBarcode(buildCardPayload(member))),two=await loadImage(await renderCardBarcode(buildCardPayload({...member,idrkc:'1042000000000099'})));
 const combined=createCanvas(one.width+two.width+80,one.height+60),ctx=combined.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,combined.width,combined.height);ctx.drawImage(one,20,30);ctx.drawImage(two,one.width+60,30);
 await rejectsCode(decodeCardBarcode(await combined.encode('png')),'CARD_MULTIPLE_BARCODES');
});

test('duplicate HBCode regions and mixed old/new credentials are rejected even when they identify the same member',async()=>{
 const payload=buildCardPayload(member),hb=await loadImage(await renderCardBarcode(payload));
 const legacy=await loadImage(await bwipjs.toBuffer({bcid:'code128',text:payload,scale:2,height:12,paddingwidth:12,paddingheight:4,backgroundcolor:'FFFFFF'}));
 for(const second of [hb,legacy]){
  const canvas=createCanvas(hb.width+second.width+80,Math.max(hb.height,second.height)+60),c=canvas.getContext('2d');
  c.fillStyle='#fff';c.fillRect(0,0,canvas.width,canvas.height);c.drawImage(hb,20,30);c.drawImage(second,hb.width+60,30);
  await rejectsCode(decodeCardBarcode(await canvas.encode('png')),'CARD_MULTIPLE_BARCODES');
 }
});
