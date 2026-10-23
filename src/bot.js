import {createCardVerification} from './card-verification.js';
import {createTryouts,tryoutJobs,tryoutRoleAdmission,tryoutSettings,tryoutMemberAccess} from './tryouts.js';
import {createDiscordProfileLookup} from './discord-profiles.js';
import {createRegistrationMemberSearch} from './registration-discord.js';
import {createVerifiedServices,verifiedServiceJobs} from './verified-services.js';
import {createIdrkcDelivery} from './idrkc-delivery.js';
import {createEmbedPublications} from './embed-publications.js';
import {publishPanel} from './panels.js';
import {announcementMessage} from './announcements.js';
import {publishAlliance} from './alliance-notice.js';
import {RokuharaEmbed as EmbedBuilder} from './embed-theme.js';
import {createAllyMigration,allyJobs} from './ally-migration.js';
import {createWarnings} from './warnings.js';
import {createCommunity,communityJobs} from './community.js';
import {createMemberCards} from './member-card.js';
import {createDistrictMigration,districtJobs} from './district-migration.js';
import {BRAND_NAME,DISTRICT_NAME} from './brand.js';
import {connectDiscord,gatewayRestOptions} from './discord-connection.js';
import {synchronizeRoles} from './role-policy.js';
import {registerCreate,createProvisionHandler} from './provision.js';
import {validateDiscord} from './discord-checks.js';
import {reporter} from './preflight.js';
import {Client,GatewayIntentBits,ActionRowBuilder,ButtonBuilder,ButtonStyle,ChannelType,PermissionFlagsBits,MessageFlags,escapeMarkdown} from 'discord.js';
import {tx,enqueue,audit,enqueueRoleReconciliation} from './db.js';
const row=(...buttons)=>new ActionRowBuilder().addComponents(buttons);
const button=(id,label,style=ButtonStyle.Primary)=>new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
const safe=value=>escapeMarkdown(String(value)).replace(/@/g,'＠');
const ephemeral={flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}};
export function createBot(pool,config,{verification}={}){
 const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers],allowedMentions:{parse:[]},rest:gatewayRestOptions()});
 const searchRegistrationMembers=createRegistrationMemberSearch(client,config);
 const getDiscordProfile=createDiscordProfileLookup(client);
 const allies=createAllyMigration(pool,config,client);
 const warnings=createWarnings(pool,config,client);
 const community=createCommunity(pool,config,client);
 const memberCards=createMemberCards(pool,config,client);
 const migrations=createDistrictMigration(pool,config,client);
 const services=createVerifiedServices(pool,config,client);
 const cardVerification=createCardVerification(pool,config,verification);
 const deliveries=createIdrkcDelivery(pool,config,client);
 const publications=createEmbedPublications(pool,config,client);
 const tryouts=createTryouts(pool,config,client);
 const provision=createProvisionHandler(client,config.divisions,{pool,config,onRolesConfigured:async()=>{const result=await enqueueRoleReconciliation(pool);return result.rowCount;},onConfigured:async()=>{await validateDiscord(client,config,reporter());await warnings.register();await memberCards.register();await setup();await migrations.publish();await deliveries.schedule();await enqueueRoleReconciliation(pool);}});
 let timer;let busy=false;let activated=false;
 const cooldown=new Map();
 const byGuild=id=>config.divisions.find(d=>d.guild===id);
 const ready=()=>client.isReady();
 const requireReady=()=>{if(!ready())throw Object.assign(new Error('Bot ainda não está conectado.'),{status:503});};
 async function guild(id){return client.guilds.fetch(id);}
 async function channel(id,guildId){const c=await client.channels.fetch(id);if(!c||c.guildId!==guildId||!c.isTextBased()||!('send'in c))throw new Error('Canal inválido ou fora do servidor configurado.');return c;}
 function guard(i){const key=i.user.id;const now=Date.now();if((cooldown.get(key)||0)>now)return false;cooldown.set(key,now+3000);if(cooldown.size>10000)for(const[k,v]of cooldown)if(v<=now)cooldown.delete(k);return true;}
 async function isAdmin(i,d){const member=await i.guild.members.fetch(i.user.id);if(i.guild.ownerId===i.user.id||member.permissions?.has(PermissionFlagsBits.Administrator))return true;return Boolean((await pool.query("SELECT id FROM staff WHERE active=TRUE AND discord_verified_at IS NOT NULL AND discord_id=$1 AND role IN ('admin','sublider')",[i.user.id])).rows.length);}
 async function sendStaffLinkCode(discordId,code,username){
  requireReady();
  const user=await client.users.fetch(discordId);if(user.bot)throw new Error('Use uma conta humana.');
  let present=false;for(const guildId of new Set([...config.divisions.map(d=>d.guild),...(config.sourceGuilds??[])])){const g=await guild(guildId).catch(e=>{if([10004,50001].includes(Number(e.code)))return null;throw e;});if(!g)continue;const m=await g.members.fetch({user:discordId,force:true}).catch(e=>{if(e.code===10007)return null;throw e;});if(m){present=true;break;}}
  if(!present&&config.divisions.length)throw new Error('Entre na guilda ou no servidor de origem antes de vincular sua conta.');
  await user.send({embeds:[new EmbedBuilder().setTitle('Confirme seu Discord no painel').setDescription(`Login: **${safe(username)}**\n\nSeu código: **${code}**\n\nDigite-o apenas no painel onde iniciou a vinculação. Válido por 10 minutos. Não compartilhe. Se você não solicitou, ignore esta mensagem.`)],allowedMentions:{parse:[]}});
 }
 async function setup(){
  requireReady();
  for(const d of config.divisions){
   const g=await guild(d.guild);const roles=await g.roles.fetch();
   const memberRole=roles.get(d.memberRole),adminRole=roles.get(d.adminRole);const me=await g.members.fetchMe();
   if(!memberRole||!adminRole||d.memberRole===d.adminRole||memberRole.id===g.id||memberRole.managed||memberRole.permissions.has(PermissionFlagsBits.Administrator))throw new Error(`Revise os cargos da ${d.name}. O cargo de membro não pode ser administrativo.`);
   if(me.roles.highest.comparePositionTo(memberRole)<=0||!me.permissions.has(PermissionFlagsBits.ManageRoles))throw new Error(`O cargo do bot precisa estar acima do cargo de membro na ${d.name}, com Gerenciar cargos.`);
   const category=await g.channels.fetch(d.category);if(category?.type!==ChannelType.GuildCategory)throw new Error(`Categoria de tickets inválida na ${d.name}.`);
   // Ticket channels are created with explicit overwrites, never inherited public permissions.
   for(const [id,title,description,custom,label]of [
    [d.verification,`Tryouts • ${BRAND_NAME}`,`⚔️ **WESTBOUND · DEEPWOKEN · KLASE**\nClique em Iniciar tryout e escolha um dos três jogos. O bot abre um canal privado com o avaliador para o jogo escolhido. Retire pelo menos **${tryoutSettings(config).passPercent}%** da vida dele para passar.\n\nApós a aprovação, conclua seu cadastro obrigatório em **${tryoutSettings(config).registrationHours} horas**. Sem cadastro, seu cargo será removido e você será reprovado, com aviso na DM.`,'tryout-start','Iniciar tryout'],
    [d.tickets,'Atendimento','🎫 **PRECISA DE AJUDA?**\nAnexe sua própria carteira HB-ID com HBCode.\n\nO bot confere a autenticidade e o vínculo com seu Discord antes de abrir um canal privado com a administração. Acompanhe também no painel de membros.','ticket','Abrir ticket'],
    [d.reports,'Denúncias','🛡️ **CANAL DE CONFIANÇA**\nAnexe sua própria carteira HB-ID e informe somente o nick da pessoa denunciada.\n\nO bot valida o HBCode e seu Discord antes de encaminhar o caso à administração. Sua resposta é privada. Acompanhe no painel de membros.','report','Fazer denúncia']
   ]){
    const c=await channel(id,d.guild);const content={embeds:[new EmbedBuilder(d.id).setTitle(title).setDescription(description).addFields({name:'Próximo passo',value:`Use o botão **${label}** abaixo. O atendimento começa com uma resposta privada.`}).setFooter({text:`${d.name} • Central de serviços`})],components:[row(button(custom,label))],allowedMentions:{parse:[]}};
    await publishPanel(pool,client,c,id,custom,content);
   }
   await channel(d.wanted,d.guild);
   await community.publishGuide(d);
   await publishAlliance(pool,client,d,config.hydraInvite);
  }
 }
 async function closeTicket(id,actor){
  requireReady();
  await tx(pool,async c=>{const ticket=(await c.query('SELECT * FROM tickets WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!ticket)throw new Error('Ticket não encontrado.');if(ticket.status==='resolvido')return;
   await c.query("UPDATE tickets SET status='fechando',closed_by=$1 WHERE id=$2",[actor,id]);await enqueue(c,'close-ticket',{id});await audit(c,actor,'Ticket encerrado',{ticketId:id});
  });
 }
 async function interact(i){
  const choosingTryout=tryoutSettings(config).enabled&&['tryout-start','verify'].includes(i.customId);
  if(i.isButton?.()&&!choosingTryout&&!guard(i))return i.reply({...ephemeral,content:'Aguarde 3 segundos entre os cliques nos botões do bot.'});
  if(await tryouts.interact(i))return;
  if(await services.interact(i))return;
  if(await cardVerification.interact(i))return;
  if(await memberCards.interact(i))return;
  if(await migrations.interact(i))return;
  if(await allies.interact(i))return;
  if(await warnings.interact(i))return;
  if(!config.sbi&&await community.interact(i))return;
  if(await provision(i))return;
  if(i.isChatInputCommand?.())return i.reply({...ephemeral,content:'Este comando não está disponível. Use /ver-sua-carteira ou consulte os avisos da guilda.'});
  if(!i.isButton()&&!i.isModalSubmit())return;
  const d=byGuild(i.guildId);if(!d)return i.reply({...ephemeral,content:'Servidor não configurado.'});
  await i.deferReply(ephemeral);
  if(i.isButton()&&i.customId.startsWith('close:')){
   if(!await isAdmin(i,d))return i.editReply('Somente administradores podem encerrar o ticket.');
   const id=Number(i.customId.split(':')[1]);const t=(await pool.query('SELECT * FROM tickets WHERE id=$1 AND guild_id=$2 AND channel_id=$3',[id,i.guildId,i.channelId])).rows[0];
   if(!t)return i.editReply('Ticket não encontrado neste canal.');await closeTicket(id,i.user.id);return i.editReply('Ticket resolvido. O canal será removido e o registro ficará no painel.');
  }
  return i.editReply('Ação não reconhecida.');
 }
 client.on('interactionCreate',i=>(activated?interact(i):i.reply({...ephemeral,content:'Sistema em verificação de inicialização. Tente novamente em instantes.'})).catch(async e=>{console.error('Interação falhou:',e.code||e.name);const msg={content:'Não foi possível concluir. Tente novamente ou procure um administrador.',allowedMentions:{parse:[]}};try{if(i.deferred||i.replied)await i.editReply(msg);else await i.reply({...ephemeral,...msg});}catch{}}));
 async function memberJoined(member){
  const configured=config.divisions.some(d=>d.guild===member.guild.id);
  // Discord drops roles when someone leaves. Re-evaluate the latest admission
  // on every return, including a previous role job skipped while absent.
  if(configured)await enqueue(pool,'sync-role',{discordId:member.id});
  await community.joined(member);
  if(configured)await deliveries.schedule(member.id);
 }
 client.on('guildMemberAdd',member=>memberJoined(member).catch(e=>console.error('Entrada na guilda:',e.code||e.name)));
 async function execute(job,c){
  if(tryoutJobs.has(job.kind))return tryouts.execute(job,c);
  if(job.kind==='idrkc-delivery'){
   if(tryoutSettings(config).enabled){const delivery=(await c.query('SELECT * FROM idrkc_deliveries WHERE id=$1',[job.payload.deliveryId])).rows[0];if(delivery){const member=(await c.query('SELECT * FROM members WHERE id=$1',[delivery.member_id])).rows[0];if(!await tryoutMemberAccess(c,config,member)){await c.query("UPDATE idrkc_deliveries SET status='superseded' WHERE id=$1",[delivery.id]);return;}}}
   return deliveries.execute(job,c);
  }
  if(verifiedServiceJobs.has(job.kind))return services.execute(job,c);
  if(job.kind==='embed-publication')return publications.execute(job,c);
  if(districtJobs.has(job.kind))return migrations.execute(job,c);
  if(job.kind==='publish-panels'){await setup();await migrations.publish();return;}
  if(allyJobs.has(job.kind))return allies.execute(job,c);
  if(job.kind==='warning-dm')return warnings.execute(job,c);
  if(communityJobs.has(job.kind))return community.execute(job,c);
  const p=job.payload;
  if(job.kind==='sync-role'){
   await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`role:${p.discordId}`]);
   const member=(await c.query('SELECT * FROM members WHERE discord_id=$1 FOR UPDATE',[p.discordId])).rows[0];
   for(const d of config.divisions){
    const g=await guild(d.guild);const user=await g.members.fetch({user:p.discordId,force:true}).catch(e=>{if(e.code===10007)return null;throw e;});if(!user)continue;
    await synchronizeRoles(g,d,user,await tryoutRoleAdmission(c,config,p.discordId,d.guild,member));
   }return;
  }
  if(job.kind==='announcement'||job.kind==='war'){
   const d=config.divisions.find(x=>x.id===p.division)||config.divisions[0];const ch=await channel(d.wanted,d.guild);
   const sent=await ch.send({...announcementMessage(job,d),nonce:String(job.id),enforceNonce:true});
   await c.query('UPDATE jobs SET message_id=$1 WHERE id=$2',[sent.id,job.id]);return;
  }
  if(job.kind==='report-notice'){
   const d=config.divisions.find(x=>x.id===p.division)||config.divisions[0];if(!d?.staffChannel)return;
   const ch=await channel(d.staffChannel,d.guild);
   // Do not publish names or report details; full content is restricted to the admin dashboard.
   const sent=await ch.send({content:`Nova denúncia #${p.reportId}. Analise no painel administrativo.`,allowedMentions:{parse:[]},nonce:String(job.id),enforceNonce:true});await c.query('UPDATE jobs SET message_id=$1 WHERE id=$2',[sent.id,job.id]);return;
  }
  if(job.kind==='close-ticket'){
   const t=(await c.query('SELECT * FROM tickets WHERE id=$1 FOR UPDATE',[p.id])).rows[0];if(!t||t.status==='resolvido')return;
   if(t.channel_id){const ch=await client.channels.fetch(t.channel_id).catch(e=>{if(e.code===10003)return null;throw e;});if(ch){if(ch.guildId!==t.guild_id)throw new Error('Servidor de ticket inválido.');await ch.delete('Ticket resolvido');}}
   await c.query("UPDATE tickets SET status='resolvido' WHERE id=$1",[t.id]);return;
  }
  throw new Error('Tipo de operação desconhecido.');
 }
 async function work(){
  if(busy||!ready()||!config.divisions.length)return;busy=true;
  try{
   for(let n=0;n<10;n++){
    let picked;
    try{const processed=await tx(pool,async c=>{
     const job=(await c.query("SELECT * FROM jobs WHERE status='pending' AND next_at<=now() ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1")).rows[0];if(!job)return false;picked=job;
     const outcome=await execute(job,c);if(outcome?.retry){const attempts=job.attempts+1;await c.query('UPDATE jobs SET attempts=$1,status=$2,error=$3,next_at=$4 WHERE id=$5',[attempts,attempts>=8||Number(outcome.retry.code)===50007?'failed':'pending',Number(outcome.retry.code)===50007?'Um administrador bloqueou mensagens privadas. O caso está disponível no painel; permita DMs e tente novamente.':`Falha de entrega: ${outcome.retry.code||outcome.retry.name}`,new Date(Date.now()+Math.min(300000,2000*2**attempts)),job.id]);}else await c.query("UPDATE jobs SET status='sent',error=NULL WHERE id=$1",[job.id]);return true;
    });if(!processed)break;
    }catch(e){if(!picked)throw e;const attempts=picked.attempts+1;await pool.query('UPDATE jobs SET attempts=$1,status=$2,error=$3,next_at=$4 WHERE id=$5',[attempts,(picked.kind!=='sync-role'&&(attempts>=8||[50007,'IFJ_CHANGED','IDRKC_CHANGED'].includes(e.code)))?'failed':'pending',e.code===50007?'Discord bloqueou a mensagem privada. Peça ao destinatário para permitir DMs e tente novamente.':['IFJ_CHANGED','IDRKC_CHANGED'].includes(e.code)?'Cadastro cancelado ou Discord alterado. Carteira não enviada.':`Discord/operação: ${e.code||e.name}. Verifique canais, cargos, permissões e conexão.`,new Date(Date.now()+Math.min(300000,2000*2**attempts)),picked.id]);}
   }
   await pool.query('DELETE FROM confirmations WHERE expires_at<now()');await pool.query('DELETE FROM sessions WHERE expires_at<now()');
  }catch(e){console.error('Fila do bot:',e.code||e.name);}finally{busy=false;}
 }
 let lastDeliveryScan=0;
 async function tick(){if(Date.now()-lastDeliveryScan>60000){lastDeliveryScan=Date.now();try{await tryouts.schedule();await deliveries.schedule();}catch(e){console.error('Fila HB-ID / tryouts:',e.code||e.name);lastDeliveryScan=0;}}await work();}
 function activate(){if(activated)return;activated=true;timer=setInterval(tick,3000);timer.unref();tick();}
 async function start(options={}){
  if(!config.botEnabled)return;
  await connectDiscord(client,config.token,options);
 }
 client.on('error',e=>console.error('Conexão Discord:',e.code||e.name));
 return {ready,setup,searchRegistrationMembers,getDiscordProfile,sendStaffLinkCode,sendMemberSignupCode:sendStaffLinkCode,closeTicket,client,handleInteraction:interact,handleMemberJoin:memberJoined,publishGuide:community.publishGuide,start,activate,validate:async log=>{await log.test('SBI: registrar /criar',()=>registerCreate(client,config.divisions.length?config.divisions:config.legacyDistrict?.guild?[config.legacyDistrict]:[]));if(!config.divisions.length){console.info('[SBI] Use /criar no servidor de destino. A guilda ainda não foi configurada.');return;}await validateDiscord(client,config,log);await log.test('Discord: registrar /warn e /ver-sua-carteira',async()=>{await warnings.register();await memberCards.register();});await log.test('Discord: atualizar painéis da guilda',setup);await log.test('Discord: atualizar aviso de imigração',migrations.publish);},stop:async()=>{activated=false;clearInterval(timer);await client.destroy();},work};
}


