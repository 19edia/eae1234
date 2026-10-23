import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {renderHBCode,decodeHBCodeImage} from '../src/hbcode.js';
import {HBCODE,HBCODE_MARKERS,encodeHBCode,decodeHBCodeBytes,hbcodeCrc32,hbcodeSvg} from '../public/hbcode-codec.js';

// Fictional credentials exercise visual transport; authenticating the HMAC and
// database owner is covered by idrkc.test.js, hbcode-bot.test.js and integration tests.
const payload='7201'+'1234567890123456'+'0000000001'+'123456789012345678901234567890';
const other='7201'+'9876543210987654'+'0000000002'+'098765432109876543210987654321';
const raster=canvas=>canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height);
const background=(w,h)=>{const c=createCanvas(w,h),x=c.getContext('2d');x.fillStyle=HBCODE.black;x.fillRect(0,0,w,h);return c;};
async function plain(value=payload){const c=background(950,88);c.getContext('2d').drawImage(await loadImage(await renderHBCode(value)),0,0);return c;}
async function transform({sx=1,sy=sx,angle=0,shear=0,format='png',padding=20}={}){
 const image=await loadImage(await renderHBCode(payload)),r=angle*Math.PI/180,cos=Math.cos(r),sin=Math.sin(r);
 const a=cos*sx,b=sin*sx,c=(cos*shear-sin)*sy,d=(sin*shear+cos)*sy;
 const corners=[[0,0],[950,0],[0,88],[950,88]].map(([x,y])=>[a*x+c*y,b*x+d*y]);
 const minX=Math.min(...corners.map(p=>p[0])),minY=Math.min(...corners.map(p=>p[1]));
 const w=Math.ceil(Math.max(...corners.map(p=>p[0]))-minX)+padding*2,h=Math.ceil(Math.max(...corners.map(p=>p[1]))-minY)+padding*2;
 const canvas=background(w,h),ctx=canvas.getContext('2d');ctx.setTransform(a,b,c,d,padding-minX,padding-minY);ctx.drawImage(image,0,0);
 const exported=await loadImage(await canvas.encode(format,90)),decoded=background(w,h);decoded.getContext('2d').drawImage(exported,0,0);return raster(decoded);
}
function checksum(bytes){const crc=hbcodeCrc32(bytes.subarray(0,33));for(let i=0;i<4;i++)bytes[33+i]=(crc>>>(24-8*i))&255;return bytes;}

test('HBCode 1.0 has a deterministic BCD packet and standard CRC-32/ISO-HDLC check value',()=>{
 assert.equal(hbcodeCrc32(new TextEncoder().encode('123456789')),0xcbf43926);
 const bytes=encodeHBCode(payload);
 assert.equal(bytes.length,37);assert.deepEqual([...bytes.subarray(0,3)],[0x48,0x42,0x10]);
 assert.deepEqual([...bytes.subarray(3,5)],[0x72,0x01]);
 assert.equal(decodeHBCodeBytes(bytes),payload);
 assert.deepEqual(encodeHBCode(payload),bytes);assert.equal(hbcodeSvg(payload),hbcodeSvg(payload));
 assert.notDeepEqual(encodeHBCode(other),bytes);assert.equal(decodeHBCodeBytes(encodeHBCode(other)),other);
});

test('packet validation rejects wrong length, magic, version, BCD, prefix and CRC',()=>{
 for(const input of [null,undefined,{},[],new Uint8Array(36)])assert.throws(()=>decodeHBCodeBytes(input),{code:'CARD_HBCODE_INVALID'});
 for(const input of [null,123,payload.slice(1),'8201'+payload.slice(4),payload+'1'])assert.throws(()=>encodeHBCode(input));
 for(const [position,value]of [[0,0x49],[2,0x11],[3,0xff],[3,0x82]]){
  const bytes=encodeHBCode(payload);bytes[position]=value;checksum(bytes);
  assert.throws(()=>decodeHBCodeBytes(bytes),{code:'CARD_HBCODE_INVALID'});
 }
 const damaged=encodeHBCode(payload);damaged[14]^=1;
 assert.throws(()=>decodeHBCodeBytes(damaged),{code:'CARD_HBCODE_INVALID'});
});

test('rendered HBCode is a deterministic 950×88 PNG with independently decodable identities',async()=>{
 const first=await renderHBCode(payload),again=await renderHBCode(payload),second=await renderHBCode(other);
 assert.deepEqual(first,again);assert.notDeepEqual(first,second);
 const image=await loadImage(first);assert.equal(image.width,950);assert.equal(image.height,88);
 assert.deepEqual(decodeHBCodeImage(raster(await plain())),[payload]);
 assert.deepEqual(decodeHBCodeImage(raster(await plain(other))),[other]);
});

test('real pixels survive PNG, JPEG, WebP, tight crop, 80% resize, rotation and mild affine skew',async t=>{
 const cases=[['PNG',{}],['JPEG',{format:'jpeg'}],['WebP',{format:'webp'}],['tight crop',{padding:0}],
  ['80 percent',{sx:.8}],['80 percent JPEG',{sx:.8,format:'jpeg'}],['90 degrees',{angle:90}],
  ['180 degrees',{angle:180}],['270 degrees',{angle:270}],['3 degrees',{angle:3}],
  ['minus 5 degrees',{angle:-5}],['5 degrees',{angle:5}],['affine shear',{shear:.08}],
  ['demo anisotropic dimensions',{sx:820/950,sy:220/88}]];
 for(const [name,options]of cases)await t.test(name,async()=>assert.deepEqual(decodeHBCodeImage(await transform(options)),[payload]));
});

test('the complete 4800×3000 demo export can locate an 820×220 code away from the origin',async()=>{
 const canvas=background(4800,3000),ctx=canvas.getContext('2d');
 ctx.drawImage(await loadImage(await renderHBCode(payload)),3560,2308,820,220);
 assert.deepEqual(decodeHBCodeImage(raster(canvas)),[payload]);
});

test('corrupted data in one copy or both copies is rejected; two valid but disagreeing copies are rejected',async()=>{
 for(const copies of [[HBCODE.left],[HBCODE.left,HBCODE.right]]){
  const canvas=await plain(),ctx=canvas.getContext('2d');ctx.fillStyle=HBCODE.gold;
  for(const x of copies)ctx.fillRect(x-3,HBCODE.top-3,6,6); // Flip the first, zero-valued data bit.
  assert.throws(()=>decodeHBCodeImage(raster(canvas)),{code:'CARD_HBCODE_INVALID'});
 }
 const canvas=await plain(),ctx=canvas.getContext('2d'),second=await loadImage(await renderHBCode(other));
 ctx.drawImage(second,538,10,342,64,538,10,342,64);
 assert.throws(()=>decodeHBCodeImage(raster(canvas)),{code:'CARD_HBCODE_INVALID'});
});

test('missing orientation glyphs are unreadable and plain images do not produce a credential',async()=>{
 const canvas=await plain(),ctx=canvas.getContext('2d');ctx.fillStyle=HBCODE.black;
 for(const m of HBCODE_MARKERS)ctx.fillRect(m.x-9,m.y-9,18,18);
 assert.deepEqual(decodeHBCodeImage(raster(canvas)),[]);
 assert.deepEqual(decodeHBCodeImage(raster(background(950,88))),[]);
 assert.throws(()=>decodeHBCodeImage({width:1,height:1,data:new Uint8Array(3)}),{code:'CARD_IMAGE_INVALID'});
 assert.throws(()=>decodeHBCodeImage({width:4001,height:4000,data:[]}),{code:'CARD_IMAGE_INVALID'});
});

test('separate symbols are counted even when the credentials are identical or vertically aligned',async()=>{
 for(const vertical of [false,true])for(const duplicate of [false,true]){
  const canvas=background(vertical?1000:1980,vertical?250:130),ctx=canvas.getContext('2d');
  ctx.drawImage(await loadImage(await renderHBCode(payload)),20,20);
  ctx.drawImage(await loadImage(await renderHBCode(duplicate?payload:other)),vertical?20:1010,vertical?140:20);
  assert.deepEqual(decodeHBCodeImage(raster(canvas)).sort(),[payload,duplicate?payload:other].sort());
 }
});

test('a valid symbol cannot hide a damaged second symbol in a vertically aligned image',async()=>{
 const canvas=background(1000,250),ctx=canvas.getContext('2d'),image=await loadImage(await renderHBCode(payload));
 ctx.drawImage(image,20,20);ctx.drawImage(image,20,140);
 ctx.fillStyle=HBCODE.gold;ctx.fillRect(20+HBCODE.left-3,140+HBCODE.top-3,6,6);
 assert.throws(()=>decodeHBCodeImage(raster(canvas)),{code:'CARD_HBCODE_INVALID'});
});

test('candidate exhaustion rejects the whole image instead of returning a partial valid credential',async()=>{
 const canvas=background(1100,650),ctx=canvas.getContext('2d');ctx.drawImage(await loadImage(await renderHBCode(payload)),20,20);
 for(let i=0;i<270;i++){
  const x=10+(i%30)*36,y=150+Math.floor(i/30)*48;
  ctx.fillStyle=HBCODE.gold;ctx.fillRect(x,y,24,24);ctx.fillStyle=HBCODE.black;ctx.fillRect(x+2,y+2,20,20);
 }
 assert.throws(()=>decodeHBCodeImage(raster(canvas)),{code:'CARD_HBCODE_COMPLEXITY'});
});
