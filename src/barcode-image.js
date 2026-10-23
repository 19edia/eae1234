// Inspect dimensions before any native decoder can allocate the full raster.
export const MAX_CARD_IMAGE_BYTES=8*1024*1024;
export const MAX_CARD_IMAGE_PIXELS=16_000_000;
export const MAX_CARD_IMAGE_DIMENSION=8192;
export function inspectCardImage(buffer){
 const bad=(code='CARD_IMAGE_INVALID',message='Envie a carteira como imagem PNG, JPEG ou WebP válida.')=>{throw Object.assign(new Error(message),{code,status:400});};
 if(!Buffer.isBuffer(buffer)||buffer.length<24)bad();
 if(buffer.length>MAX_CARD_IMAGE_BYTES)bad('CARD_IMAGE_TOO_LARGE','A imagem da carteira deve ter no máximo 8 MB.');
 let width,height,type;
 if(buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){
  if(buffer.readUInt32BE(8)!==13||buffer.toString('ascii',12,16)!=='IHDR')bad();
  width=buffer.readUInt32BE(16);height=buffer.readUInt32BE(20);type='png';
 }else if(buffer[0]===0xff&&buffer[1]===0xd8){
  type='jpeg';let offset=2;
  while(offset+3<buffer.length){
   if(buffer[offset++]!==0xff)bad();
   while(buffer[offset]===0xff)offset++;
   const marker=buffer[offset++];
   if(marker===0xd9||marker===0xda)break;
   if(marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;
   if(offset+2>buffer.length)bad();
   const length=buffer.readUInt16BE(offset);
   if(length<2||offset+length>buffer.length)bad();
   if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){
    if(length<8)bad();height=buffer.readUInt16BE(offset+3);width=buffer.readUInt16BE(offset+5);break;
   }
   offset+=length;
  }
 }else if(buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP'){
  type='webp';let containerWidth,containerHeight,images=0;
  const end=buffer.readUInt32LE(4)+8;if(end>buffer.length||end<20)bad();
  for(let offset=12;offset+8<=end;){
   const chunk=buffer.toString('ascii',offset,offset+4),size=buffer.readUInt32LE(offset+4),start=offset+8;
   if(start+size>end)bad();
   if(chunk==='ANIM'||chunk==='ANMF')bad('CARD_IMAGE_INVALID','Envie uma imagem estática da carteira, sem animação.');
   if(chunk==='VP8X'){
    if(size<10||(buffer[start]&2))bad('CARD_IMAGE_INVALID','Envie uma imagem estática da carteira, sem animação.');
    containerWidth=1+buffer.readUIntLE(start+4,3);containerHeight=1+buffer.readUIntLE(start+7,3);
   }else if(chunk==='VP8 '){
    if(size<10||!buffer.subarray(start+3,start+6).equals(Buffer.from([0x9d,0x01,0x2a])))bad();
    width=buffer.readUInt16LE(start+6)&0x3fff;height=buffer.readUInt16LE(start+8)&0x3fff;images++;
   }else if(chunk==='VP8L'){
    if(size<5||buffer[start]!==0x2f)bad();
    const bits=buffer.readUInt32LE(start+1);width=1+(bits&0x3fff);height=1+((bits>>>14)&0x3fff);images++;
   }
   offset=start+size+(size%2);
  }
  // Check the coded raster as well as the extended WebP canvas dimensions.
  if(images!==1||(containerWidth&&(containerWidth!==width||containerHeight!==height)))bad();
 }else bad();
 if(!width||!height||width>MAX_CARD_IMAGE_DIMENSION||height>MAX_CARD_IMAGE_DIMENSION||width*height>MAX_CARD_IMAGE_PIXELS)bad('CARD_IMAGE_DIMENSIONS','Use a carteira original, com até 8192 pixels por lado e 16 megapixels.');
 return {type,width,height};
}
