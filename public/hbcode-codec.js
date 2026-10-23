// HBCode 1.0: a project-specific visual transport, not a QR standard.
// This module only generates symbols. Credential authenticity remains server-side.
export const HBCODE = Object.freeze({width:950,height:88,columns:37,rows:8,cellWidth:9,cellHeight:8,left:80,right:546,top:16,gold:'#e1bd52',black:'#080908'});
export const HBCODE_MARKERS = Object.freeze([
 {x:24,y:24,name:'cross',bits:['0011100','0011100','1111111','1111111','0011100','0011100','0011100']},
 {x:926,y:24,name:'shield',bits:['1111111','1000001','1001001','1001001','1101011','0111110','0011100']},
 {x:24,y:64,name:'sword',bits:['0001000','0011100','0011100','0011100','1111111','0001000','0011100']},
 {x:926,y:64,name:'diamond',bits:['0001000','0011100','0111110','1111111','0111110','0011100','0001000']}
]);
export function hbcodeCrc32(bytes){
 let crc=0xffffffff;
 for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
 return (crc^0xffffffff)>>>0;
}
export function encodeHBCode(payload){
 if(typeof payload!=='string'||!/^7201\d{56}$/.test(payload))throw new Error('Payload de HBCode inválido.');
 const bytes=new Uint8Array(37);bytes.set([0x48,0x42,0x10]);
 for(let i=0;i<30;i++)bytes[3+i]=(Number(payload[i*2])<<4)|Number(payload[i*2+1]);
 const crc=hbcodeCrc32(bytes.subarray(0,33));
 for(let i=0;i<4;i++)bytes[33+i]=(crc>>>(24-i*8))&255;
 return bytes;
}
export function decodeHBCodeBytes(bytes){
 const invalid=()=>{throw Object.assign(new Error('O HBCode foi alterado ou está danificado. Envie a carteira original.'),{code:'CARD_HBCODE_INVALID'});};
 if(!(bytes instanceof Uint8Array)||bytes.length!==37||bytes[0]!==0x48||bytes[1]!==0x42||bytes[2]!==0x10)invalid();
 const actual=((bytes[33]<<24)|(bytes[34]<<16)|(bytes[35]<<8)|bytes[36])>>>0;
 if(actual!==hbcodeCrc32(bytes.subarray(0,33)))invalid();
 let payload='';for(const value of bytes.subarray(3,33)){if((value>>4)>9||(value&15)>9)invalid();payload+=String(value>>4)+String(value&15);}
 if(!/^7201\d{56}$/.test(payload))invalid();return payload;
}
export function hbcodeSvg(payload){
 const bytes=encodeHBCode(payload),{gold,black}=HBCODE;
 const rect=(x,y,w,h,fill)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
 let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="950" height="88" viewBox="0 0 950 88">${rect(0,0,950,88,black)}`;
 // Engraved rails and ornaments stay outside the data cells and locator frames.
 svg+='<path d="M46 4H437L445 12M505 12L513 4H904M46 84H437L445 76M505 76L513 84H904" fill="none" stroke="#8c742e" stroke-width="1"/>';
 for(const marker of HBCODE_MARKERS){
  svg+=rect(marker.x-12,marker.y-12,24,24,gold)+rect(marker.x-10,marker.y-10,20,20,black);
  marker.bits.forEach((row,y)=>[...row].forEach((value,x)=>{if(value==='1')svg+=rect(marker.x-7+x*2,marker.y-7+y*2,2,2,gold);}));
 }
 for(const left of [HBCODE.left,HBCODE.right])for(let i=0;i<296;i++){
  const x=left+(i%37)*9,y=HBCODE.top+Math.floor(i/37)*8;
  if((bytes[i>>>3]>>>(7-(i&7)))&1)svg+=`<path d="M${x-2} ${y-3}h4l1 1v4l-1 1h-4l-1-1v-4z" fill="${gold}"/>`;
  else svg+=rect(x-2,y-2,4,4,'#292615');
 }
 // Vector HB monogram: no font dependency, secret, member data or metadata.
 svg+='<path d="M475 9L510 26V62L475 79L440 62V26Z" fill="none" stroke="#8c742e" stroke-width="1.5"/>';
 svg+='<path d="M451 27h6v14h13V27h6v34h-6V47h-13v14h-6zM481 27h13l7 5v9l-4 3 5 4v9l-6 4h-15zm6 6v9h6l2-2v-5l-3-2zm0 15v7h7l2-2v-3l-3-2z" fill="'+gold+'" fill-rule="evenodd"/>';
 svg+='<path d="M54 42l4-4 4 4-4 4zM892 42l4-4 4 4-4 4zM472 16h6M475 13v6M472 72h6M475 69v6" fill="none" stroke="'+gold+'" stroke-width="1.2"/>';
 return svg+'</svg>';
}
