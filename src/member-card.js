import {AttachmentBuilder,MessageFlags,SlashCommandBuilder} from 'discord.js';
import {RokuharaEmbed} from './embed-theme.js';
import {DISTRICT_NAME} from './brand.js';
import {renderCard} from './cards.js';
import {tx} from './db.js';
import {tryoutMemberAccess} from './tryouts.js';
export const memberCardCommand=()=>new SlashCommandBuilder().setName('ver-sua-carteira').setDescription('Receber sua carteira verificada no privado').setDefaultMemberPermissions(null).toJSON();
export function createMemberCards(pool,config,client,{render=renderCard}={}){
 const pending=new Set();
 async function register(){for(const d of config.divisions){const g=await client.guilds.fetch(d.guild);await g.commands.create(memberCardCommand());}}
 async function interact(i){
  if(!i.isChatInputCommand?.()||i.commandName!=='ver-sua-carteira')return false;
  await i.deferReply({flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}});
  const reply=content=>i.editReply({content,allowedMentions:{parse:[]}});
  if(!config.divisions.some(d=>d.guild===i.guildId)){await reply('Use /ver-sua-carteira no GUILDA HRISTE BOZE.');return true;}
  if(pending.has(i.user.id)){await reply('Sua carteira já está sendo preparada. Aguarde o privado.');return true;}
  pending.add(i.user.id);
  try{
   const result=await tx(pool,async c=>{
    const m=(await c.query('SELECT * FROM members WHERE discord_id=$1 FOR SHARE',[i.user.id])).rows[0];
    if(!m)return 'Você ainda não possui um HB-ID vinculado a este Discord. Procure a equipe.';
    if(!m.verified||m.card_revoked_at||!await tryoutMemberAccess(c,config,m))return 'Conclua seu tryout e o cadastro obrigatório antes de pedir sua carteira.';
    const file=`HRISTE-BOZE-${m.idrkc}-v${m.identity_version}.png`,png=await render(m,DISTRICT_NAME);
    await i.user.send({embeds:[new RokuharaEmbed().setTitle('Sua carteira • HRISTE BOZE').setDescription('Sua carteira atual está anexada. Guarde seu HB-ID em particular.').setImage(`attachment://${file}`)],files:[new AttachmentBuilder(png,{name:file})],allowedMentions:{parse:[]},nonce:i.id,enforceNonce:true});
    return 'Sua carteira foi enviada no seu privado!';
   });await reply(result);
  }catch(e){if(Number(e.code)!==50007)throw e;await reply('Permita mensagens diretas de membros deste servidor e desbloqueie o bot. Depois use /ver-sua-carteira novamente.');}
  finally{pending.delete(i.user.id);}
  return true;
 }
 return {register,interact};
}
