import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {renderCard} from '../src/cards.js';
import {buildCardPayload,verifyCardBuffer} from '../src/idrkc.js';
import {decodeCardBarcode} from '../src/barcode.js';

// Captured from the unmodified renderer before HBCode was implemented.
// These are fictional test identities, never production credentials.
const fixtures=new URL('./fixtures/hbcode-before/',import.meta.url);
const {member,variants}=JSON.parse(await readFile(new URL('fixture.json',fixtures),'utf8'));
const issuedAt=new Date('2026-10-22T12:00:00Z');
async function pixels(png){
 const image=await loadImage(png),canvas=createCanvas(image.width,image.height),c=canvas.getContext('2d');
 c.drawImage(image,0,0);return {width:image.width,height:image.height,data:c.getImageData(0,0,image.width,image.height).data};
}

test('all five card designs are pixel-identical outside the former 950x88 barcode region',async()=>{
 for(let variant=0;variant<variants.length;variant++){
  const before=await pixels(await readFile(new URL(`card-${variant}.png`,fixtures)));
  const after=await pixels(await renderCard({...member,...variants[variant]},'HRISTE BOZE',{issuedAt}));
  assert.equal(after.width,before.width);assert.equal(after.height,before.height);
  let insideChanges=0,outsideChanges=0;
  for(let y=0;y<before.height;y++)for(let x=0;x<before.width;x++){
   const i=4*(y*before.width+x);
   if(before.data[i]===after.data[i]&&before.data[i+1]===after.data[i+1]&&before.data[i+2]===after.data[i+2]&&before.data[i+3]===after.data[i+3])continue;
   if(x>=542&&x<1492&&y>=902&&y<990)insideChanges++;else outsideChanges++;
  }
  assert.equal(outsideChanges,0,`variant ${variant}: surrounding design must not change`);
  assert.ok(insideChanges>1000,`variant ${variant}: the old barcode must be replaced`);
 }
});

test('an existing signed card and its regenerated HBCode resolve to the same current record without migration',async()=>{
 const oldCard=await readFile(new URL('card-0.png',fixtures));
 const newCard=await renderCard(member,'HRISTE BOZE',{issuedAt});
 const payload=buildCardPayload(member);
 const pool={query:async(sql,args)=>{assert.match(sql,/SELECT \* FROM members WHERE idrkc=\$1/);return {rows:args[0]===member.idrkc?[member]:[]};}};
 for(const card of [oldCard,newCard]){
  assert.equal(await decodeCardBarcode(card),payload);
  const verified=await verifyCardBuffer(pool,card,{discordId:member.discord_id});
  assert.equal(verified.id,member.id);assert.equal(verified.idrkc,member.idrkc);assert.equal(verified.identity_version,member.identity_version);
  assert.equal(verified.card_secret,undefined);
 }
});
