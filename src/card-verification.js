import {ActionRowBuilder,ButtonBuilder,ButtonStyle,FileUploadBuilder,LabelBuilder,MessageFlags,ModalBuilder,escapeMarkdown} from 'discord.js';
import {decodeCardBarcode} from './barcode.js';
import {buildCardPayload,CardVerificationError,verifyCardPayload} from './idrkc.js';
import {downloadCardAttachment} from './verified-services.js';
import {ALLIANCE_NOTICE,bothDivisions} from './identity.js';
import {DISTRICT_NAME} from './brand.js';
import {hash,token} from './security.js';
import {enqueue,tx} from './db.js';

const ephemeral={flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}};
const safe=value=>escapeMarkdown(String(value)).replaceAll('@','＠');
const button=(id,label,style)=>new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
export function verificationModal(){
 return new ModalBuilder().setCustomId('verify-card-form').setTitle('Verificar minha carteira').addLabelComponents(
  new LabelBuilder().setLabel('Sua carteira HB-ID').setDescription('Anexe a carteira original, com HBCode ou código antigo. PNG, JPG ou WebP; até 8 MB.').setFileUploadComponent(new FileUploadBuilder().setCustomId('card').setMinValues(1).setMaxValues(1).setRequired(true))
 );
}
export function createCardVerification(pool,config,{download=downloadCardAttachment,decode=decodeCardBarcode}={}){
 const pending=new Set();
 async function interact(i){
  const opening=i.isButton?.()&&i.customId==='verify';
  const submit=i.isModalSubmit?.()&&['verify-card-form','verify-form'].includes(i.customId);
  const confirmation=i.isButton?.()&&/^(confirm|cancel):/.test(i.customId);
  if(!opening&&!submit&&!confirmation)return false;
  const district=config.divisions.find(d=>d.guild===i.guildId);
  if(!district){await i.reply({...ephemeral,content:'Servidor não configurado.'});return true;}
  if(opening){await i.showModal(verificationModal());return true;}
  if(confirmation){
   await i.deferUpdate();
   const [action,nonce]=i.customId.split(':');
   const message=await tx(pool,async c=>{
    const challenge=(await c.query('SELECT * FROM confirmations WHERE token=$1 AND discord_id=$2 AND guild_id=$3 AND expires_at>now()',[nonce,i.user.id,i.guildId])).rows[0];
    if(!challenge)return 'Confirmação expirada ou já utilizada. Inicie novamente.';
    const member=(await c.query('SELECT * FROM members WHERE id=$1 FOR UPDATE',[challenge.member_id])).rows[0];
    const consumed=await c.query('DELETE FROM confirmations WHERE token=$1 AND discord_id=$2 AND guild_id=$3 AND expires_at>now() RETURNING token',[nonce,i.user.id,i.guildId]);
    if(!consumed.rowCount)return 'Confirmação expirada ou já utilizada. Inicie novamente.';
    if(action==='cancel')return 'Verificação cancelada.';
    if(!member||member.card_revoked_at||member.migration_required||member.identity_version!==challenge.member_version||(!bothDivisions(member)&&member.division!==district.id)||member.discord_id!==i.user.id)return 'Carteira inválida ou atualizada. Envie a versão atual para verificar seu acesso.';
    if(!challenge.card_proof_hash||challenge.card_proof_hash!==hash(buildCardPayload(member),config.secret))return 'A carteira foi atualizada. Clique em Verificar meu HB-ID e anexe a versão atual.';
    await c.query('UPDATE members SET verified=TRUE WHERE id=$1',[member.id]);
    await enqueue(c,'sync-role',{discordId:i.user.id});
    return 'Dados confirmados! O bot está liberando seu acesso. Se os canais não aparecerem, avise um administrador.';
   });
   await i.editReply({content:message,components:[],allowedMentions:{parse:[]}});return true;
  }
  await i.deferReply(ephemeral);
  if(i.customId==='verify-form'){await i.editReply('Este formulário foi substituído. Clique em Verificar meu HB-ID e anexe sua carteira com HBCode.');return true;}
  if(pending.has(i.user.id)){await i.editReply('Sua carteira já está sendo conferida. Aguarde a resposta.');return true;}
  pending.add(i.user.id);
  try{
   const files=i.fields.getUploadedFiles('card',true);
   if(files?.size!==1)throw new CardVerificationError('CARD_UPLOAD_INVALID','Anexe somente a sua carteira HB-ID.');
   const payload=await decode(await download(files.first()));
   const result=await tx(pool,async c=>{
    // An issued but not yet verified card must be accepted for this first verification.
    const member=await verifyCardPayload(c,payload,{discordId:i.user.id,requireVerified:false,lock:true});
    if(member.migration_required)return {message:'Antes de verificar, solicite sua imigração nos avisos e aguarde a aprovação da administração.'};
    if(!bothDivisions(member)&&member.division!==district.id)return {message:'Seu HB-ID pertence à outra divisão. Acesse o servidor da sua divisão.'};
    const nonce=token();
    await c.query('INSERT INTO confirmations(token,member_id,discord_id,guild_id,expires_at,member_version,card_proof_hash) VALUES($1,$2,$3,$4,$5,$6,$7)',[nonce,member.id,i.user.id,i.guildId,new Date(Date.now()+5*60000),member.identity_version,hash(payload,config.secret)]);
    return {member,nonce};
   });
   if(result.message){await i.editReply(result.message);return true;}
   const {member:m,nonce}=result;
   await i.editReply({content:`Carteira conferida. Confirme seus dados:\nNome: **${safe(m.name)}**\nTipo: **${m.account_kind==='aliado'?'Aliado':'Membro'}**${m.account_kind==='aliado'?`\nGang aliada: **${safe(m.allied_gang)}**\n${ALLIANCE_NOTICE}`:`\nPatente: **${safe(m.member_rank)}**`}\nNome no jogo: **${safe(m.game_nick||'Não informado')}**\nUsuário Roblox: **${safe(m.roblox_username||'Não informado')}**\nAcesso: **${safe(DISTRICT_NAME)}**\nEssa confirmação expira em 5 minutos.`,components:[new ActionRowBuilder().addComponents(button(`confirm:${nonce}`,'Sou eu',ButtonStyle.Success),button(`cancel:${nonce}`,'Cancelar',ButtonStyle.Secondary))],allowedMentions:{parse:[]}});
  }catch(error){
   if(error instanceof CardVerificationError||typeof error.code==='string'&&error.code.startsWith('CARD_'))await i.editReply(error.message);
   else if(['TimeoutError','AbortError'].includes(error.name))await i.editReply('A leitura da imagem demorou. Tente novamente com a carteira original.');
   else throw error;
  }finally{pending.delete(i.user.id);}
  return true;
 }
 return {interact};
}
