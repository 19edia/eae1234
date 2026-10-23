import {ActionRowBuilder,ButtonBuilder,ButtonStyle,ChannelType,FileUploadBuilder,LabelBuilder,MessageFlags,ModalBuilder,PermissionFlagsBits,TextInputBuilder,TextInputStyle,escapeMarkdown} from 'discord.js';
import {decodeCardBarcode} from './barcode.js';
import {CardVerificationError,verifyCardPayload} from './idrkc.js';
import {RokuharaEmbed} from './embed-theme.js';
import {audit,enqueue,tx} from './db.js';
import {text} from './security.js';
import {createHash} from 'node:crypto';
import {tryoutMemberAccess} from './tryouts.js';

const ephemeral={flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}};
const safe=value=>escapeMarkdown(String(value)).replaceAll('@','＠');
const MAX_BYTES=8*1024*1024;
export const verifiedServiceJobs=new Set(['verified-ticket-open','verified-report-notice']);
export function serviceModal(kind){
 const form=new ModalBuilder().setCustomId(`${kind}-card-form`).setTitle(kind==='report'?'Denunciar com sua carteira':'Atendimento com sua carteira');
 form.addLabelComponents(new LabelBuilder().setLabel('Sua carteira HB-ID').setDescription('Envie a carteira original, com HBCode ou código antigo. PNG, JPG ou WebP; até 8 MB.').setFileUploadComponent(new FileUploadBuilder().setCustomId('card').setMinValues(1).setMaxValues(1).setRequired(true)));
 if(kind==='report')form.addLabelComponents(new LabelBuilder().setLabel('Nick da pessoa denunciada').setTextInputComponent(new TextInputBuilder().setCustomId('subject').setStyle(TextInputStyle.Short).setMinLength(2).setMaxLength(100).setRequired(true)));
 return form;
}
// Only download an attachment URL supplied in the Discord interaction, never a URL typed by a user.
export async function downloadCardAttachment(attachment,{fetchImpl=fetch}={}){
 const error=message=>new CardVerificationError('CARD_UPLOAD_INVALID',message);
 if(!attachment||!Number.isFinite(attachment.size)||attachment.size<1||attachment.size>MAX_BYTES)throw error('Envie uma carteira PNG, JPG ou WebP de até 8 MB.');
 if(attachment.contentType&&!/^image\/(png|jpeg|webp)(?:;|$)/i.test(attachment.contentType))throw error('A carteira precisa ser uma imagem PNG, JPG ou WebP.');
 let url;try{url=new URL(attachment.url);}catch{throw error('Anexo inválido. Envie a imagem novamente.');}
 // Modal File Uploads use ephemeral-attachments; message uploads use attachments.
 if(url.protocol!=='https:'||!['cdn.discordapp.com','media.discordapp.net'].includes(url.hostname)||url.username||url.password||url.port||!/^\/(?:ephemeral-)?attachments\//.test(url.pathname))throw error('O arquivo precisa ser anexado diretamente no formulário do Discord.');
 const response=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(12000)});
 if(!response.ok||!response.body)throw error('Não foi possível ler o anexo. Envie a carteira novamente.');
 const length=Number(response.headers.get('content-length')||0);if(length>MAX_BYTES){await response.body.cancel();throw error('A imagem ultrapassa 8 MB.');}
 const reader=response.body.getReader();const chunks=[];let bytes=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>MAX_BYTES){await reader.cancel();throw error('A imagem ultrapassa 8 MB.');}chunks.push(value);}}finally{reader.releaseLock();}
 return Buffer.concat(chunks,bytes);
}
export function createVerifiedServices(pool,config,client,{download=downloadCardAttachment,decode=decodeCardBarcode}={}){
 const pending=new Set();
 async function administrators(guild,c){
  const staff=(await c.query("SELECT discord_id FROM staff WHERE active=TRUE AND role IN ('admin','sublider') AND discord_verified_at IS NOT NULL AND discord_id IS NOT NULL")).rows;
  const ids=new Set([guild.ownerId]);
  for(const {discord_id}of staff){const present=await guild.members.fetch(discord_id).catch(e=>{if(Number(e.code)===10007)return null;throw e;});if(present&&!present.user?.bot)ids.add(discord_id);}
  ids.delete(undefined);ids.delete(client.user.id);return [...ids];
 }
 async function interact(i){
  const open=i.isButton?.()&&['report','ticket'].includes(i.customId);
  const submit=i.isModalSubmit?.()&&['report-card-form','ticket-card-form','report-form'].includes(i.customId);
  if(!open&&!submit)return false;
  const d=config.divisions.find(item=>item.guild===i.guildId);
  if(!d){await i.reply({...ephemeral,content:'Use este serviço na GUILDA HRISTE BOZE.'});return true;}
  if(open){await i.showModal(serviceModal(i.customId));return true;}
  await i.deferReply(ephemeral);
  const reply=content=>i.editReply({content,allowedMentions:{parse:[]}});
  if(i.customId==='report-form'){await reply('Este formulário foi substituído. Clique novamente em Fazer denúncia e anexe sua carteira HB-ID.');return true;}
  if(pending.has(i.user.id)){await reply('Sua carteira já está sendo conferida. Aguarde a resposta.');return true;}
  pending.add(i.user.id);
  try{
   const files=i.fields.getUploadedFiles('card',true);
   if(files?.size!==1)throw new CardVerificationError('CARD_UPLOAD_INVALID','Envie somente a sua carteira HB-ID.');
   const subject=i.customId==='report-card-form'?text(i.fields.getTextInputValue('subject'),'Nick da pessoa denunciada',100,2):null;
   const payload=await decode(await download(files.first()));
   const result=await tx(pool,async c=>{
    const m=await verifyCardPayload(c,payload,{discordId:i.user.id,requireVerified:true,lock:true});
    if(!await tryoutMemberAccess(c,config,m))throw new CardVerificationError('CARD_NOT_ADMITTED','Conclua seu tryout e o cadastro obrigatório para usar os serviços de membros.',403);
    if(subject){
     const existing=(await c.query('SELECT id FROM reports WHERE interaction_id=$1',[i.id])).rows[0];if(existing)return `Denúncia #${existing.id} já recebida. Acompanhe no seu painel.`;
     // A nickname need not exist in the registry. Never demand the accused person's card or Discord ID.
     const found=(await c.query('SELECT id FROM members WHERE lower(game_nick)=lower($1) OR lower(roblox_username)=lower($1) OR lower(name)=lower($1)',[subject])).rows;
     const report=(await c.query('INSERT INTO reports(member_id,subject,reporter_id,division,reason,reporter_member_id,reporter_idrkc,card_version,interaction_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',[found.length===1?found[0].id:null,subject,i.user.id,d.id,'Denúncia recebida com carteira HB-ID autenticada. A administração poderá contatar o denunciante para os detalhes.',m.id,m.idrkc,m.identity_version,i.id])).rows[0];
     const job=await enqueue(c,'verified-report-notice',{reportId:report.id,division:d.id});await c.query('UPDATE reports SET notification_job_id=$1 WHERE id=$2',[job,report.id]);
     await audit(c,i.user.id,'Denúncia autenticada por HB-ID',{reportId:report.id,memberId:m.id,version:m.identity_version});
     return `Carteira validada. Denúncia #${report.id} encaminhada à administração. Acompanhe em Minhas solicitações no painel de membros.`;
    }
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`ticket:${i.guildId}:${i.user.id}`]);
    const existing=(await c.query("SELECT * FROM tickets WHERE guild_id=$1 AND user_id=$2 AND status<>'resolvido'",[i.guildId,i.user.id])).rows[0];
    if(existing){
     if(existing.channel_id)return `Seu atendimento já está aberto: <#${existing.channel_id}>. Acompanhe também no seu painel.`;
     // A newly valid credential can recover an opening that failed after an identity change.
     const job=(await c.query('SELECT id,status FROM jobs WHERE id=$1',[existing.notification_job_id])).rows[0];
     if(job?.status==='failed'){
      await c.query('UPDATE tickets SET member_id=$1,idrkc=$2,card_version=$3 WHERE id=$4',[m.id,m.idrkc,m.identity_version,existing.id]);
      await c.query("UPDATE jobs SET status='pending',attempts=0,error=NULL,next_at=now() WHERE id=$1",[job.id]);
      return `Carteira validada. A abertura do atendimento #${existing.id} será tentada novamente. Acompanhe no seu painel.`;
     }
     return `O atendimento #${existing.id} já está na fila. Acompanhe no seu painel.`;
    }
    const ticket=(await c.query('INSERT INTO tickets(guild_id,user_id,member_id,idrkc,card_version) VALUES($1,$2,$3,$4,$5) RETURNING id',[i.guildId,i.user.id,m.id,m.idrkc,m.identity_version])).rows[0];
    const job=await enqueue(c,'verified-ticket-open',{ticketId:ticket.id,division:d.id});await c.query('UPDATE tickets SET notification_job_id=$1 WHERE id=$2',[job,ticket.id]);
    await audit(c,i.user.id,'Atendimento autenticado por HB-ID',{ticketId:ticket.id,memberId:m.id,version:m.identity_version});
    return `Carteira validada. Atendimento #${ticket.id} encaminhado à administração. O canal privado aparecerá no servidor e em Minhas solicitações no seu painel.`;
   });await reply(result);
  }catch(e){if(e instanceof CardVerificationError||typeof e.code==='string'&&e.code.startsWith('CARD_'))await reply(e.message);else if(['TimeoutError','AbortError'].includes(e.name))await reply('A leitura da imagem demorou demais. Tente novamente com o arquivo original recebido pelo bot.');else throw e;}
  finally{pending.delete(i.user.id);}
  return true;
 }
 async function execute(job,c){
  const d=config.divisions.find(item=>item.id===job.payload.division);if(!d)throw Object.assign(Error('Distrito indisponível'),{code:'DISTRICT_UNAVAILABLE'});
  const guild=await client.guilds.fetch(d.guild);
  if(job.kind==='verified-report-notice'){
   const r=(await c.query('SELECT r.*,m.name AS reporter_name FROM reports r LEFT JOIN members m ON m.id=r.reporter_member_id WHERE r.id=$1',[job.payload.reportId])).rows[0];if(!r)return;
   const recipients=await administrators(guild,c);let failure;
   if(!recipients.length)throw Object.assign(Error('Administração sem destinatário'),{code:'ADMIN_UNAVAILABLE'});
   for(const id of recipients){
    if((await c.query('SELECT message_id FROM service_deliveries WHERE job_id=$1 AND recipient_id=$2',[job.id,id])).rows.length)continue;
    try{
     const user=await client.users.fetch(id);
     const nonce=createHash('sha256').update(`report:${job.id}:${id}`).digest('hex').slice(0,24);
     const sent=await user.send({embeds:[new RokuharaEmbed().setTitle(`Denúncia #${r.id} • HB-ID conferida`).setDescription(`**Pessoa denunciada:** ${safe(r.subject)}\n**Denunciante:** ${safe(r.reporter_name||'Membro cadastrado')}\n**HB-ID:** ${r.reporter_idrkc}\n\n[Contatar denunciante](https://discord.com/users/${r.reporter_id})\nAnalise e registre a conclusão no painel administrativo.`)],allowedMentions:{parse:[]},nonce,enforceNonce:true});
     await c.query('INSERT INTO service_deliveries(job_id,recipient_id,message_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[job.id,id,sent.id]);
    }catch(e){failure=e;}
   }
   // Keep successful deliveries committed. Retry only recipients who did not receive the message.
   if(failure){await c.query('UPDATE jobs SET error=$1 WHERE id=$2',[`ADMIN_DM:${failure.code||failure.name}`,job.id]);return {retry:failure};}
   return;
  }
  if(job.kind==='verified-ticket-open'){
   const t=(await c.query('SELECT * FROM tickets WHERE id=$1 FOR UPDATE',[job.payload.ticketId])).rows[0];if(!t||t.status!=='aberto')return;
   const m=(await c.query('SELECT * FROM members WHERE id=$1 FOR SHARE',[t.member_id])).rows[0];
   if(!m||m.discord_id!==t.user_id||!m.verified||m.card_revoked_at||m.identity_version!==t.card_version||m.idrkc!==t.idrkc)throw Object.assign(Error('Cadastro alterado'),{code:'IDRKC_CHANGED'});
   if(!await tryoutMemberAccess(c,config,m))throw Object.assign(Error('Admissão revogada antes da abertura do atendimento'),{code:'IDRKC_CHANGED'});
   const admins=await administrators(guild,c),topic=`HB-ID atendimento ${t.id} ${t.user_id}`;
   const channels=await guild.channels.fetch();let ch=channels.get(t.channel_id)||channels.find(item=>item?.topic===topic&&item.parentId===d.category);
   const access=[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.AttachFiles];
   const overwrites=[{id:guild.id,deny:[PermissionFlagsBits.ViewChannel]},...new Set([t.user_id,...admins])].map((value,index)=>index===0?value:{id:value,type:1,allow:access});
   overwrites.push({id:client.user.id,type:1,allow:[...access,PermissionFlagsBits.ManageChannels]});
   // The Equipe role also belongs to high members; it must not expose private support channels.
   if(!ch)ch=await guild.channels.create({name:`atendimento-${t.id}`,type:ChannelType.GuildText,parent:d.category,topic,permissionOverwrites:overwrites});
   else if(ch.permissionOverwrites?.set)await ch.permissionOverwrites.set(overwrites);
   const sent=await ch.send({content:`Atendimento de <@${t.user_id}> • carteira HB-ID conferida.`,embeds:[new RokuharaEmbed().setTitle(`Atendimento #${t.id}`).setDescription(`**Membro:** ${safe(m.name)}\n**HB-ID:** ${m.idrkc}\n\nConte à administração como podemos ajudar.`)],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`close:${t.id}`).setLabel('Encerrar atendimento').setStyle(ButtonStyle.Danger))],allowedMentions:{parse:[]},nonce:`ticket-${job.id}`,enforceNonce:true});
   await c.query('UPDATE tickets SET channel_id=$1 WHERE id=$2',[ch.id,t.id]);await c.query('UPDATE jobs SET message_id=$1 WHERE id=$2',[sent.id,job.id]);return;
  }
  throw Error('Serviço desconhecido');
 }
 return {interact,execute};
}
