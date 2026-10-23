import {publishPanel,findPanel,panelPayload} from './panels.js';
import {RokuharaEmbed as EmbedBuilder} from './embed-theme.js';
import {PermissionFlagsBits,ButtonBuilder,ButtonStyle,ActionRowBuilder,TextInputBuilder,TextInputStyle,ModalBuilder,SlashCommandBuilder,AttachmentBuilder,MessageFlags,escapeMarkdown} from 'discord.js';
import {tx} from './db.js';
import {text} from './security.js';
import {renderCard} from './cards.js';
import {bothDivisions} from './identity.js';
const safe=value=>escapeMarkdown(String(value)).replace(/@/g,'＠');
const commands=['imigração','imigracao'];
const privateReply={flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}};
export const communityJobs=new Set(['welcome','report-resolution','immigration-decision']);
export function guideMessage(d){return {embeds:[new EmbedBuilder(d.id).setTitle('Como entrar • HRISTE BOZE').setDescription([
 '**Westbound · Deepwoken · Klase. Uma guilda, três jogos.**',
 `Vá a <#${d.verification}> e clique em **Iniciar tryout**. Escolha **Westbound**, **Deepwoken** ou **Klase**. O bot abre um canal privado entre você e o examinador para o jogo escolhido.`,
 'O examinador registra a porcentagem de vida que você retirou no combate. O bot publica o resultado no canal e decide a aprovação conforme a nota mínima configurada.',
 '**Cadastro obrigatório:** depois de passar, complete o link enviado pelo bot dentro do prazo informado. Se o prazo terminar sem cadastro, o acesso será removido, o tryout será reprovado e você receberá um aviso na DM.'
 ].join('\n\n')).addFields(
 {name:'01 · Combate e avaliação',value:'Espere o examinador no canal privado. Os dois nicks aparecem automaticamente na avaliação.'},
 {name:'02 · Complete o cadastro',value:'Use seu convite pessoal, informe o nome no jogo e a conta Roblox, confirme o Discord e crie sua senha.'},
 {name:'03 · Sua carteira HB-ID',value:'Após concluir, acesse o painel de membros, baixe a carteira e acompanhe os avisos. /ver-sua-carteira entrega uma cópia no privado.'},
 {name:'Proteja sua identidade',value:'O HB-ID possui 16 números e HBCode autenticado. Use o PNG original em tickets e denúncias; nunca publique sua carteira.'}
 ).setFooter({text:`${d.name} • Mantenha as mensagens privadas do bot ativadas`})],allowedMentions:{parse:[]}};}
export function createCommunity(pool,config,client){
 async function publishGuide(d){
  const ch=await client.channels.fetch(d.guide);
  if(!ch||ch.guildId!==d.guild||!ch.isTextBased()||!ch.send)throw new Error('Canal como-entrar inválido.');
  await publishPanel(pool,client,ch,d.guide,'guide',guideMessage(d));
 }
 async function register(){
  if(!config.immigrationGuild)return;
  const g=await client.guilds.fetch(config.immigrationGuild);
  for(const name of commands)await g.commands.create(new SlashCommandBuilder().setName(name).setDescription('Publicar aviso de imigração com prazo de 10 dias e botão').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).toJSON());
 }
 async function interact(i){
  const command=i.isChatInputCommand?.()&&commands.includes(i.commandName);
  const submit=i.isModalSubmit?.()&&i.customId==='immigration-form';
  const click=i.isButton?.()&&i.customId==='immigration-open';
  if(!command&&!submit&&!click)return false;
  if(!config.immigrationGuild||i.guildId!==config.immigrationGuild){await i.reply({...privateReply,content:'Use esse comando no servidor antigo da HRISTE BOZE.'});return true;}
  if(command){
   await i.deferReply(privateReply);
   const g=await client.guilds.fetch(i.guildId);
   const actor=await g.members.fetch({user:i.user.id,force:true}).catch(e=>{if(e.code===10007)return null;throw e;});
   if(!actor||(g.ownerId!==i.user.id&&!actor.permissions.has(PermissionFlagsBits.Administrator))){await i.editReply('Somente o dono ou um administrador do servidor antigo pode publicar o aviso. Clique em Solicitar imigração no aviso para preencher seu pedido.');return true;}
   const notice=await tx(pool,async c=>{
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`immigration-notice:${i.guildId}`]);
    const n=(await c.query("INSERT INTO immigration_notices(guild_id,channel_id,deadline) VALUES($1,$2,now()+interval '10 days') ON CONFLICT(guild_id) DO UPDATE SET guild_id=EXCLUDED.guild_id RETURNING *",[i.guildId,i.channelId])).rows[0];
    const ch=await client.channels.fetch(n.channel_id);
    if(!ch||ch.guildId!==i.guildId||!ch.isTextBased()||!ch.send)throw new Error('Canal do aviso indisponível.');
    const timestamp=Math.floor(new Date(n.deadline).getTime()/1000);
    const content={embeds:[new EmbedBuilder().setTitle('HRISTE BOZE • Vamos imigrar!').setColor(0xf3d547).setDescription(`A campanha de transferência de membros fica aberta por 10 dias a partir deste aviso. Acompanhe as instruções da administração da HRISTE BOZE.\n\n**Data anunciada:** <t:${timestamp}:F> (<t:${timestamp}:R>).\n\nClique em **Solicitar imigração** e informe seu nome no jogo e seu nome no Discord. A administração completará seu cadastro e analisará o pedido.\n\nSe aprovado, você receberá o HB-ID e a carteira PNG no privado. Se recusado, receberá o motivo. Ative suas mensagens privadas para receber a resposta.`).setFooter({text:'Transferência de membros • Nenhum servidor é excluído por este aviso.'})],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('immigration-open').setLabel('Solicitar imigração').setStyle(ButtonStyle.Success))],allowedMentions:{parse:[]}};
    const payload=panelPayload(content,'immigration');
    let message=await findPanel(ch,client.user?.id,'immigration',n.message_id);
    if(message)await message.edit(payload);else message=await ch.send({...payload,nonce:i.id,enforceNonce:true});
    await c.query('UPDATE immigration_notices SET message_id=$1 WHERE guild_id=$2',[message.id,i.guildId]);
    return {channelId:n.channel_id,messageId:message.id};
   });
   await i.editReply(`Aviso publicado/atualizado: https://discord.com/channels/${i.guildId}/${notice.channelId}/${notice.messageId}. A data original foi preservada. Os membros entram pelo botão. Este aviso não exclui servidores.`);return true;
  }
  if(click){
   const form=new ModalBuilder().setCustomId('immigration-form').setTitle('Imigração • HRISTE BOZE').addComponents([
    ['game_nick','Seu nome no jogo',64],['discord_name','Seu nome no Discord',100]
   ].map(([key,label,max])=>new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(key).setLabel(label).setMaxLength(max).setRequired(true).setStyle(TextInputStyle.Short))));
   await i.showModal(form);return true;
  }
  await i.deferReply(privateReply);
  const game=text(i.fields.getTextInputValue('game_nick'),'Nome no jogo',64),name=text(i.fields.getTextInputValue('discord_name'),'Nome no Discord',100);
  const result=await tx(pool,async c=>{
   await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`immigration:${i.user.id}`]);
   if((await c.query('SELECT id FROM members WHERE discord_id=$1',[i.user.id])).rowCount)return 'Você já possui HB-ID. Procure a equipe para consultar ou corrigir seu cadastro.';
   if((await c.query("SELECT id FROM immigrations WHERE discord_id=$1 AND status='pendente'",[i.user.id])).rowCount)return 'Você já tem um pedido em análise. Aguarde a decisão do administrador.';
   const r=(await c.query('INSERT INTO immigrations(discord_id,guild_id,game_nick,discord_name) VALUES($1,$2,$3,$4) RETURNING id',[i.user.id,i.guildId,game,name])).rows[0];
   return `Pedido #${r.id} enviado! O administrador completará seus dados. Você receberá a decisão no privado. Permita mensagens privadas de membros deste servidor para receber o HB-ID e a carteira.`;
  });await i.editReply(result);return true;
 }
 async function joined(member){
  const d=config.divisions.find(x=>x.guild===member.guild.id);if(!d||member.user.bot)return;
  const joinedAt=member.joinedTimestamp;if(!joinedAt)throw new Error('Entrada sem data de ingresso.');
  const imported=(await pool.query("SELECT id FROM members WHERE discord_id=$1 AND auto_allied=TRUE AND verified=TRUE AND account_kind='aliado'",[member.id])).rowCount;
  if(imported||config.sbi&&Boolean((await pool.query('SELECT id FROM members WHERE discord_id=$1 AND verified=TRUE',[member.id])).rowCount))await pool.query("INSERT INTO jobs(kind,payload,dedupe_key) VALUES('sync-role',$1,$2) ON CONFLICT DO NOTHING",[JSON.stringify({discordId:member.id}),`ally-join:${d.guild}:${member.id}:${joinedAt}`]);
  await pool.query("INSERT INTO jobs(kind,payload,dedupe_key) VALUES('welcome',$1,$2) ON CONFLICT DO NOTHING",[JSON.stringify({guildId:d.guild,discordId:member.id,joinedAt}),`welcome:${d.guild}:${member.id}:${joinedAt}`]);
 }
 async function execute(job,c){
  const options={allowedMentions:{parse:[]},nonce:String(job.id),enforceNonce:true};let sent;
  if(job.kind==='welcome'){
   const d=config.divisions.find(x=>x.guild===job.payload.guildId);if(!d)return;
   const g=await client.guilds.fetch(d.guild);
   const member=await g.members.fetch({user:job.payload.discordId,force:true}).catch(e=>{if(e.code===10007)return null;throw e;});
   if(!member||member.joinedTimestamp!==job.payload.joinedAt)return;
   const imported=(await c.query("SELECT id FROM members WHERE discord_id=$1 AND auto_allied=TRUE AND verified=TRUE AND account_kind='aliado'",[member.id])).rowCount;
   const ch=await client.channels.fetch(d.welcome);if(ch?.guildId!==d.guild)throw new Error('Canal de boas-vindas inválido.');
   sent=await ch.send({...options,content:`<@${member.id}>`,allowedMentions:{parse:[],users:[member.id]},embeds:[new EmbedBuilder(d.id).setImage(member.displayAvatarURL({extension:'png',size:256})).setAuthor(null).setFooter(null).setTimestamp(null),new EmbedBuilder(d.id).setTitle('Bem-vindo à HRISTE BOZE').setDescription(imported?'🤝 **Cadastro de aliado reconhecido.**\nO bot confere seu cadastro e o acesso autorizado na guilda. Para novas admissões, faça o tryout e conclua o cadastro obrigatório. Consulte o guia e fale com a equipe se precisar de ajuda.':`🪪 **Seu próximo passo**\nLeia o guia em <#${d.guide}> e solicite seu tryout em <#${d.verification}>. Após aprovação, complete o cadastro obrigatório pelo link do bot dentro do prazo.`)]});
  }else if(job.kind==='report-resolution'){
   const r=(await c.query("SELECT * FROM reports WHERE id=$1 AND status='resolvida'",[job.payload.reportId])).rows[0];if(!r)return;
   const user=await client.users.fetch(r.reporter_id);
   sent=await user.send({...options,embeds:[new EmbedBuilder().setTitle(`Resultado da denúncia #${r.id}`).setDescription(safe(r.resolution).slice(0,4096)).setFooter({text:'HRISTE BOZE • Análise da administração'}).setColor(0xf3d547)]});
  }else if(job.kind==='immigration-decision'){
   const r=(await c.query('SELECT * FROM immigrations WHERE id=$1',[job.payload.requestId])).rows[0];if(!r||r.status==='pendente')return;
   let message;
   if(r.status==='aprovada'){
    const m=(await c.query('SELECT * FROM members WHERE id=$1 FOR UPDATE',[r.member_id])).rows[0];
    if(!m||m.discord_id!==r.discord_id)throw Object.assign(new Error('Cadastro cancelado ou Discord alterado; carteira não enviada.'),{code:'IDRKC_CHANGED'});
    const division=config.divisions.find(d=>d.id===m.division);
    const card=await renderCard(m,division.name);
    message={embeds:[new EmbedBuilder().setTitle('Imigração aprovada • HRISTE BOZE').setDescription(`Seu HB-ID: **${m.idrkc}**\nNome: ${safe(m.name)}\nPatente: ${safe(m.member_rank)}\nAcesso: ${safe(division.name)}\n\nSua carteira PNG está anexada. Entre no servidor autorizado. Novas admissões exigem aprovação no tryout e conclusão do cadastro obrigatório pelo link do bot. A transferência do cadastro, sozinha, não libera os canais.\nSe precisar do convite, peça à equipe.`).setColor(0xf3d547)],files:[new AttachmentBuilder(card,{name:`HRISTE BOZE-${m.idrkc}-v${m.identity_version}.png`})]};
   }else message={embeds:[new EmbedBuilder().setTitle('Imigração recusada • HRISTE BOZE').setDescription(safe(r.reason).slice(0,4096)).setColor(0xeb6d5b)]};
   const user=await client.users.fetch(r.discord_id);sent=await user.send({...options,...message});
  }
  if(sent)await c.query('UPDATE jobs SET message_id=$1 WHERE id=$2',[sent.id,job.id]);
 }
 return {register,interact,joined,execute,publishGuide};
}
