import {ActionRowBuilder,AttachmentBuilder,ButtonBuilder,ButtonStyle,ChannelType,MessageFlags,ModalBuilder,PermissionFlagsBits as P,TextInputBuilder,TextInputStyle,escapeMarkdown} from 'discord.js';
import {RokuharaEmbed} from './embed-theme.js';
import {BRAND_NAME,DISTRICT_NAME} from './brand.js';
import {renderCard} from './cards.js';
import {publishPanel} from './panels.js';
import {tx,enqueue,audit} from './db.js';
import {text} from './security.js';

const privateReply={flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}};
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
export const districtJobs=new Set(['district-migration-decision','district-migration-stop','district-migration-publish']);
export function migrationNotice(){
 return {embeds:[new RokuharaEmbed().setTitle(`IMIGRAÇÃO DE MEMBROS PARA ${DISTRICT_NAME}`).setDescription('**O próximo capítulo da nossa família começa aqui.**\nInforme seu HB-ID e o nome que você usa no jogo. A administração vai conferir seu pedido.').addFields({name:'01 · Confirme sua identidade',value:'Use o HB-ID vinculado à sua própria conta Discord. Cadastros antigos também são reconhecidos pelo código anterior.'},{name:'02 · Informe seu nome no jogo',value:'Após aprovação, esse será o nome na sua nova carteira da guilda.'},{name:'03 · Aguarde a administração',value:'Você receberá a decisão e, se aprovado, a nova carteira amarela e preta por mensagem privada. Permita mensagens diretas do servidor.'}).setFooter({text:`${BRAND_NAME} • Solicitação reservada à equipe`})],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('district-migrate-open').setLabel('Solicitar imigração').setStyle(ButtonStyle.Primary))],allowedMentions:{parse:[]}};
}
export function createDistrictMigration(pool,config,client){
 async function noticeChannel(guildId,d){
  if(guildId===d.guild&&d.news)return client.channels.fetch(d.news);
  const guild=await client.guilds.fetch(guildId),channels=await guild.channels.fetch();
  const existing=channels.find(ch=>ch?.type===ChannelType.GuildText&&(ch.topic==='KAGE:immigration'||/:news$/.test(ch.topic??'')||/avisos/.test(ch.name)));
  if(existing)return existing;
  return guild.channels.create({name:'📢┃historico-migracao',type:ChannelType.GuildText,topic:'KAGE:immigration',permissionOverwrites:[{id:guild.id,allow:[P.ViewChannel,P.ReadMessageHistory],deny:[P.SendMessages]},{id:client.user.id,allow:[P.ViewChannel,P.SendMessages,P.EmbedLinks,P.ReadMessageHistory]}],reason:'Imigração para a guilda HRISTE BOZE'});
 }
 async function publish(){
  const d=config.divisions[0];if(!d?.guild)return;
  await tx(pool,async c=>{
   await c.query("INSERT INTO district_migration_campaign(id,target_guild) VALUES(1,$1) ON CONFLICT(id) DO NOTHING",[d.guild]);
   const campaign=(await c.query('SELECT * FROM district_migration_campaign WHERE id=1 FOR UPDATE')).rows[0];
   if(campaign.status!=='active')return;
   await c.query('UPDATE district_migration_campaign SET target_guild=$1 WHERE id=1',[d.guild]);
   for(const guildId of new Set([d.guild,...(config.sourceGuilds??[])])){
    let ch;try{ch=await noticeChannel(guildId,d);}catch(e){if(guildId!==d.guild&&[10004,50001].includes(Number(e.code))){console.warn('[IMIGRAÇÃO] Servidor antigo indisponível:',guildId);continue;}throw e;}
    if(!ch||ch.guildId!==guildId||!ch.isTextBased?.()||!ch.send)throw Error('Canal de avisos da imigração inválido.');
    const message=await publishPanel(c,client,ch,ch.id,'district-migration',migrationNotice());
    await c.query('INSERT INTO district_migration_notices(guild_id,channel_id,message_id) VALUES($1,$2,$3) ON CONFLICT(guild_id) DO UPDATE SET channel_id=$2,message_id=$3',[guildId,ch.id,message.id]);
   }
  });
 }
 async function interact(i){
  const click=i.isButton?.()&&i.customId==='district-migrate-open';
  const submit=i.isModalSubmit?.()&&i.customId==='district-migrate-form';
  if(!click&&!submit)return false;
  if(!i.guildId){await i.reply({...privateReply,content:'Use o botão de imigração nos avisos do servidor.'});return true;}
  // Showing the form is the immediate acknowledgement; the authoritative
  // campaign/ownership checks happen on submit, including stale old messages.
  if(click){
   const form=new ModalBuilder().setCustomId('district-migrate-form').setTitle('Imigração • HRISTE BOZE').addComponents([
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('ifj').setLabel('Seu HB-ID (16 números)').setStyle(TextInputStyle.Short).setMinLength(15).setMaxLength(16).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('shigaku_name').setLabel('Seu nome no jogo').setStyle(TextInputStyle.Short).setMaxLength(64).setRequired(true))
   ]);await i.showModal(form);return true;
  }
  await i.deferReply(privateReply);
  const ifj=i.fields.getTextInputValue('ifj').trim(),name=text(i.fields.getTextInputValue('shigaku_name'),'Nome no jogo',64);
  if(!/^\d{15,16}$/.test(ifj)||/[\u0000-\u001f\u007f]/.test(name)){await i.editReply('Informe seu HB-ID de 16 números e um nome no jogo sem quebras de linha.');return true;}
  const result=await tx(pool,async c=>{
   const campaign=(await c.query('SELECT * FROM district_migration_campaign WHERE id=1 FOR SHARE')).rows[0];
   if(campaign?.status!=='active')return 'As imigrações foram encerradas pela administração. Não são aceitos novos pedidos.';
   const origin=(await c.query('SELECT guild_id FROM district_migration_notices WHERE guild_id=$1',[i.guildId])).rows[0];
   if(!origin)return 'Use o aviso de imigração publicado pelo bot em um servidor autorizado.';
   const m=(await c.query('SELECT * FROM members WHERE (idrkc=$1 OR ifj=$1) AND discord_id=$2 FOR UPDATE',[ifj,i.user.id])).rows[0];
   if(!m)return 'Esse HB-ID não está vinculado ao seu Discord. Confira os números ou procure a administração.';
   if(m.district_migrated_at&&!m.migration_required)return 'Sua imigração já foi aprovada. Use /ver-sua-carteira para receber sua carteira novamente.';
   const pending=(await c.query("SELECT id FROM district_migration_requests WHERE discord_id=$1 AND status='pendente'",[i.user.id])).rows[0];
   if(pending)return `Seu pedido #${pending.id} já está em análise. Aguarde a administração.`;
   const r=(await c.query('INSERT INTO district_migration_requests(member_id,discord_id,source_guild,ifj,member_version,shigaku_name) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[m.id,i.user.id,i.guildId,m.ifj,m.identity_version,name])).rows[0];
   await audit(c,`discord:${i.user.id}`,'Imigração solicitada',{requestId:r.id});
   return `Pedido #${r.id} recebido! A administração vai analisar seu nome no jogo. A decisão chegará no seu privado.`;
  });await i.editReply({content:result,allowedMentions:{parse:[]}});return true;
 }
 async function execute(job,c){
  if(job.kind==='district-migration-publish')return publish();
  if(job.kind==='district-migration-stop'){
   for(const n of (await c.query('SELECT * FROM district_migration_notices')).rows){
    try{const ch=await client.channels.fetch(n.channel_id);if(ch){if(ch.guildId!==n.guild_id)throw Error('Aviso pertence a outro servidor.');const message=await ch.messages.fetch(n.message_id);if(message.author?.id!==client.user.id)throw Error('O aviso não pertence a este bot.');await message.delete();}}catch(e){if(![10003,10008].includes(Number(e.code)))throw e;}
    await c.query('DELETE FROM panels WHERE channel_id=$1 AND message_id=$2',[n.channel_id,n.message_id]);
    await c.query('DELETE FROM district_migration_notices WHERE guild_id=$1',[n.guild_id]);
   }return;
  }
  const r=(await c.query('SELECT * FROM district_migration_requests WHERE id=$1',[job.payload.requestId])).rows[0];if(!r||r.status==='pendente')return;
  let payload;
  if(r.status==='aprovada'){
   const m=(await c.query('SELECT * FROM members WHERE id=$1 FOR SHARE',[r.member_id])).rows[0];
   if(!m||m.discord_id!==r.discord_id||!m.verified||m.migration_required)throw Object.assign(Error('Cadastro alterado; carteira não enviada.'),{code:'IFJ_CHANGED'});
   const file=`HB-${m.idrkc}-v${m.identity_version}.png`,png=await renderCard(m,DISTRICT_NAME),d=config.divisions[0];
   const embed=new RokuharaEmbed().setTitle('Imigração aprovada • HRISTE BOZE').setDescription(`**Bem-vindo ao ${DISTRICT_NAME}!**\nSeu nome no jogo: **${escapeMarkdown(m.game_nick).replace(/@/g,'＠')}**.\nSeu cadastro foi preservado. Sua nova carteira HB-ID está anexada.`).setImage(`attachment://${file}`);
   if(d?.invite&&/^https:\/\/(discord\.gg\/|discord\.com\/invite\/)[A-Za-z0-9-]+$/.test(d.invite))embed.addFields({name:'Entre no distrito',value:d.invite});
   else embed.addFields({name:'Entre no distrito',value:'Peça o convite à administração. Seu acesso será liberado ao entrar com esta conta Discord.'});
   payload={embeds:[embed],files:[new AttachmentBuilder(png,{name:file})]};
  }else payload={embeds:[new RokuharaEmbed().setTitle('Retorno da sua imigração').setDescription(`Seu pedido não foi aprovado.\n\n${escapeMarkdown(r.reason??'Procure a equipe.').replace(/@/g,'＠')}`).setFooter({text:`Pedido #${r.id} • Administração HRISTE BOZE`})]};
  const user=await client.users.fetch(r.discord_id),sent=await user.send({...payload,nonce:String(job.id),enforceNonce:true,allowedMentions:{parse:[]}});
  await c.query('UPDATE jobs SET message_id=$1 WHERE id=$2',[sent.id,job.id]);
 }
 return {publish,interact,execute};
}

export function districtMigrationRoutes(app,pool,config,permit){
 app.get('/api/district-migrations',permit('admin'),async(_req,res)=>{
  const campaign=(await pool.query('SELECT * FROM district_migration_campaign WHERE id=1')).rows[0]??null;
  const requests=(await pool.query('SELECT r.*,m.idrkc,m.name AS current_name,j.status AS notification_status,j.error AS notification_error FROM district_migration_requests r LEFT JOIN members m ON m.id=r.member_id LEFT JOIN jobs j ON j.id=r.notification_job_id ORDER BY r.created_at DESC,r.id DESC LIMIT 1000')).rows;
  res.json({campaign,requests});
 });
 app.post('/api/district-migrations/stop',permit('admin'),async(req,res)=>{
  const result=await tx(pool,async c=>{
   const campaign=(await c.query('SELECT * FROM district_migration_campaign WHERE id=1 FOR UPDATE')).rows[0];
   if(!campaign)throw fail('A imigração ainda não foi configurada.',409);
   await c.query("UPDATE district_migration_campaign SET status='stopped',stopped_at=COALESCE(stopped_at,now()) WHERE id=1");
   const pending=(await c.query("SELECT id FROM jobs WHERE kind='district-migration-stop' AND status='pending' LIMIT 1")).rows[0];
   const id=pending?.id??await enqueue(c,'district-migration-stop',{});
   await audit(c,req.auth.staff_id,'Imigrações encerradas',{jobId:id});return {id};
  });res.status(202).json({...result,message:'Novos pedidos bloqueados. A remoção dos avisos está na fila. Os pedidos já recebidos continuam disponíveis para análise.'});
 });
 for(const decision of ['approve','reject'])app.post(`/api/district-migrations/:id/${decision}`,permit('admin'),async(req,res)=>{
  if(decision==='approve'&&!config.divisions[0]?.guild)throw fail('Configure o distrito com /criar antes de aprovar.',409);
  const result=await tx(pool,async c=>{
   const r=(await c.query('SELECT * FROM district_migration_requests WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0];
   if(!r)throw fail('Pedido não encontrado.',404);if(r.status!=='pendente')throw fail('Esse pedido já foi analisado.',409);
   let reason=null;
   if(decision==='approve'){
    const m=(await c.query('SELECT * FROM members WHERE id=$1 FOR UPDATE',[r.member_id])).rows[0];
    if(!m||m.discord_id!==r.discord_id||m.ifj!==r.ifj||m.identity_version!==r.member_version)throw fail('A identidade mudou depois do pedido. Recuse esta solicitação e peça ao titular para enviar outra com os dados atuais.',409);
    await c.query('UPDATE members SET name=$1,game_nick=$1,division=1,verified=TRUE,migration_required=FALSE,district_migrated_at=now(),identity_version=identity_version+1,updated_at=now() WHERE id=$2',[r.shigaku_name,m.id]);
    await c.query('DELETE FROM confirmations WHERE member_id=$1',[m.id]);
    await enqueue(c,'sync-role',{discordId:r.discord_id});
   }else reason=text(req.body.reason,'Motivo da recusa',1800);
   const jobId=await enqueue(c,'district-migration-decision',{requestId:r.id});
   await c.query('UPDATE district_migration_requests SET status=$1,reason=$2,reviewed_by=$3,notification_job_id=$4,decided_at=now() WHERE id=$5',[decision==='approve'?'aprovada':'recusada',reason,req.auth.staff_id,jobId,r.id]);
   await audit(c,req.auth.staff_id,decision==='approve'?'Migração HRISTE BOZE aprovada':'Migração HRISTE BOZE recusada',{requestId:r.id,jobId});
   return {ok:true,message:decision==='approve'?'Imigração aprovada. Cadastro preservado, nome atualizado e nova carteira na fila do privado.':'Pedido recusado. O motivo será enviado no privado.'};
  });res.json(result);
 });
}
