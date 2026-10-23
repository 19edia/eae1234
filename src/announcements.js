import {createCanvas,loadImage} from '@napi-rs/canvas';
import {escapeMarkdown} from 'discord.js';
import {RokuharaEmbed} from './embed-theme.js';
const safe=v=>escapeMarkdown(String(v)).replace(/@/g,'＠');
const invalid=()=>Object.assign(new Error('Print inválido. Use PNG ou JPEG de até 2 MB e no máximo 4096 × 4096 pixels.'),{status:400});
export async function normalizePrint(value){
 if(value===undefined||value===null||value==='')return null;
 if(typeof value!=='string'||value.length>2800000||!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(value))throw invalid();
 const bytes=Buffer.from(value.split(',')[1],'base64');if(bytes.length>2*1024*1024)throw invalid();
 // Parse dimensions before decoding, to reject oversized raster allocations.
 let w,h;
 if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.length>=24){w=bytes.readUInt32BE(16);h=bytes.readUInt32BE(20);}
 else if(bytes[0]===255&&bytes[1]===216){let n=2;while(n+4<=bytes.length){if(bytes[n++]!==255)break;const marker=bytes[n++];if(marker===218||marker===217)break;const length=bytes.readUInt16BE(n);if(length<2||n+length>bytes.length)break;if([192,193,194].includes(marker)&&length>=7){h=bytes.readUInt16BE(n+3);w=bytes.readUInt16BE(n+5);break;}n+=length;}}
 if(!w||!h||w>4096||h>4096)throw invalid();
 try{const img=await loadImage(bytes),scale=Math.min(1,1200/w,1200/h),canvas=createCanvas(Math.max(1,Math.round(w*scale)),Math.max(1,Math.round(h*scale))),c=canvas.getContext('2d');c.fillStyle='#101418';c.fillRect(0,0,canvas.width,canvas.height);c.drawImage(img,0,0,canvas.width,canvas.height);return (await canvas.encode('jpeg',85)).toString('base64');}catch{throw invalid();}
}
export function announcementMessage(job,d){
 const p=job.payload,war=job.kind==='war';
 const embed=new RokuharaEmbed(d.id).setColor(war?0xd8ae65:0xeb6d5b).setTitle(war?'HRISTE BOZE • DECLARAÇÃO DE GUERRA':p.title);
 if(war)embed.setDescription('⚔️ **À NOSSA FAMÍLIA**\nHRISTE BOZE, mantenham a união e a disciplina. Lutem lado a lado e honrem nossa aliança. **No campo de batalha do jogo: morte aos inimigos!**\n\n━━━━━━━━━━━━━━━━━━\n🔥 **GUERRA DECLARADA**\nA HRISTE BOZE declara guerra à gang **'+safe(p.gang)+'**.\n\n*União no combate. Respeito às regras do jogo.*').addFields({name:'Motivo',value:safe(p.reason).slice(0,1024)});
 else embed.setDescription(safe(p.description).slice(0,4096)).addFields(...(p.name?[{name:'Pessoa procurada',value:safe(p.name),inline:true}]:[]),{name:'Nick no jogo',value:safe(p.nick),inline:true},{name:'Motivo',value:safe(p.reason).slice(0,1024)});
 const files=[];if(!war&&p.image){files.push({attachment:Buffer.from(p.image,'base64'),name:'procurado.jpg'});embed.setImage('attachment://procurado.jpg');}
 embed.setFooter({text:`${d.name} • Roleplay • Registro ${job.id}`});return {embeds:[embed],files,allowedMentions:{parse:[]}};
}
