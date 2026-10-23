import {publishPanel} from './panels.js';
import {RokuharaEmbed} from './embed-theme.js';
import {BRAND_NAME} from './brand.js';
export function allianceMessage(d,invite){
 const description=['**DIPLOMACIA • WESTBOUND · DEEPWOKEN · KLASE**','As alianças da **'+BRAND_NAME+'** são confirmadas pela liderança. Respeite as regras das guildas parceiras e combine as expedições com a equipe.','**PACTOS E EXPEDIÇÕES**\nUse este espaço para acordos de cooperação, grupos PvE e treinos entre guildas.',invite?'**COMUNIDADE PARCEIRA**\n'+invite:'Nenhum convite de parceiro foi configurado. Consulte a liderança para propor uma aliança.'].join('\n\n');
 return {embeds:[new RokuharaEmbed(d.id).setTitle(BRAND_NAME+' • Alianças').setDescription(description).addFields({name:'Nosso compromisso',value:'Respeito às regras, cooperação e diálogo com a liderança.'}).setFooter({text:BRAND_NAME+' • Diplomacia'})],allowedMentions:{parse:[]}};
}
export async function publishAlliance(pool,client,d,invite){
 if(!d.allianceChannel)return;
 const ch=await client.channels.fetch(d.allianceChannel);
 if(!ch||ch.guildId!==d.guild||!ch.isTextBased()||!ch.send)throw new Error('Canal de alianças inválido.');
 await publishPanel(pool,client,ch,d.allianceChannel,'alliance',allianceMessage(d,invite));
}
