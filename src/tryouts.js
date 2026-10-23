import {timingSafeEqual} from 'node:crypto';
import {ActionRowBuilder,ButtonBuilder,ButtonStyle,ChannelType,MessageFlags,PermissionFlagsBits as P,escapeMarkdown} from 'discord.js';
import {RokuharaEmbed as Embed} from './embed-theme.js';
import {BRAND_NAME} from './brand.js';
import {GAMES,gameById} from './games.js';
import {allowed,hash,token} from './security.js';
import {audit,enqueue,tx} from './db.js';

const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const ephemeral={flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}};
const safe=v=>escapeMarkdown(String(v)).replaceAll('@','＠');
const same=(a,b)=>/^[a-f0-9]{64}$/.test(String(a))&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export const tryoutJobs=new Set(['tryout-create','tryout-welcome','tryout-evaluator-dm','tryout-result','tryout-registration-dm','tryout-expire','tryout-expired-dm','tryout-expired-channel','tryout-complete']);
export function tryoutSettings(config){return {enabled:config.tryouts?.enabled===true,evaluatorId:config.tryouts?.evaluatorId||'1480009495915659494',passPercent:config.tryouts?.passPercent??50,registrationHours:config.tryouts?.registrationHours??48};}
export function damagePercent(value){
 if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>100||Math.abs(Math.round(value*100)-value*100)>1e-8)throw fail('Informe a porcentagem de vida retirada do avaliador, de 0 a 100, com até duas casas decimais.');
 return Math.round(value*100)/100;
}
export const evaluatorToken=(s,secret)=>hash(`tryout-evaluation:${s.id}:${s.evaluator_id}:${s.link_nonce}`,secret);
export const registrationToken=(s,secret)=>hash(`tryout-registration:${s.id}:${s.participant_id}:${s.link_nonce}`,secret);
const evaluationUrl=(s,config)=>new URL(`/tryout/${s.id}#${evaluatorToken(s,config.secret)}`,config.origin).href;
const registrationUrl=(s,config)=>new URL(`/cadastro/${registrationToken(s,config.secret)}`,config.origin).href;
const gameName=s=>gameById(s.game_id)?.name||'Deepwoken';
const expose=s=>({id:s.id,game_id:s.game_id,game_name:gameName(s),participant_id:s.participant_id,evaluator_id:s.evaluator_id,participant_nick:s.participant_nick,evaluator_nick:s.evaluator_nick,status:s.status,threshold:Number(s.threshold),damage_percent:s.damage_percent===null?null:Number(s.damage_percent),registration_deadline:s.registration_deadline,registration_hours:s.registration_hours,created_at:s.created_at,evaluated_at:s.evaluated_at,registered_at:s.registered_at});

// Every admission checks the latest attempt. Portal/card access still requires
// bound registration or the legacy snapshot. Discord role reconciliation also
// accepts panel-verified members without a tryout history, as requested by the owner.
async function admission(c,config,discordId,guildId,member,{panelRoles=false}={}){
 if(!tryoutSettings(config).enabled)return member;
 const s=(await c.query('SELECT * FROM tryout_sessions WHERE participant_id=$1 AND guild_id=$2 ORDER BY id DESC LIMIT 1',[discordId,guildId])).rows[0];
 if(member?.card_revoked_at)return null;
 if(s?.status==='passed'&&new Date(s.registration_deadline).getTime()>Date.now())return {verified:true,account_kind:'membro',member_rank:'Membro',division:1};
 if(s?.status==='registered'&&member&&s.member_id===member.id)return member;
 if(!s&&panelRoles&&member?.verified&&member.discord_id===discordId&&config.divisions.some(d=>d.guild===guildId))return member;
 if(!s&&member?.verified&&!member.card_revoked_at&&(await c.query('SELECT l.member_id FROM tryout_legacy_members l JOIN member_accounts a ON a.member_id=l.member_id AND a.discord_id=l.discord_id AND a.active=TRUE WHERE l.member_id=$1 AND l.discord_id=$2 AND l.guild_id=$3',[member.id,discordId,guildId])).rowCount)return member;
 return null;
}
export function tryoutAdmission(c,config,discordId,guildId,member){return admission(c,config,discordId,guildId,member);}
export function tryoutRoleAdmission(c,config,discordId,guildId,member){return admission(c,config,discordId,guildId,member,{panelRoles:true});}
export async function tryoutMemberAccess(c,config,member){
 if(!tryoutSettings(config).enabled)return true;
 if(!member?.verified||member.card_revoked_at)return false;
 for(const d of config.divisions){
  const admitted=await tryoutAdmission(c,config,member.discord_id,d.guild,member);
  // Provisional access opens Discord channels, but the member portal and card
  // require the mandatory bound signup to have been completed.
  if(admitted===member)return true;
 }
 return false;
}
export async function assertTryoutRegistration(c,invite,discordId,config){
 if(invite.bound_discord_id&&invite.bound_discord_id!==discordId)throw fail('Este cadastro pertence ao participante aprovado no tryout.',403);
 if(!invite.tryout_id)return null;
 const s=(await c.query('SELECT * FROM tryout_sessions WHERE id=$1 FOR UPDATE',[invite.tryout_id])).rows[0];
 if(s&&config&&!config.divisions.some(d=>d.guild===s.guild_id))throw fail('A guilda mudou de servidor. Solicite um novo tryout no servidor atual.',410);
 if(!s||s.participant_id!==discordId||s.status!=='passed'||new Date(s.registration_deadline).getTime()<=Date.now())throw fail('Seu prazo de cadastro acabou ou o tryout foi encerrado. Solicite um novo tryout.',410);
 return s;
}
export async function completeTryoutRegistration(c,invite,member,config){
 if(!invite.tryout_id)return;
 await assertTryoutRegistration(c,invite,member.discord_id,config);
 await c.query("UPDATE tryout_sessions SET status='registered',member_id=$1,registered_at=now(),updated_at=now() WHERE id=$2",[member.id,invite.tryout_id]);
 await enqueue(c,'tryout-complete',{tryoutId:invite.tryout_id});
}
export async function recordTryoutResult(pool,config,id,score,staffId){
 const value=damagePercent(score);
 return tx(pool,async c=>{
  const s=(await c.query('SELECT * FROM tryout_sessions WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!s)throw fail('Tryout não encontrado.',404);
  if(!config.divisions.some(d=>d.guild===s.guild_id))throw fail('Este tryout pertence ao servidor anterior. Abra um novo tryout na guilda atual.',410);
  const actor=(await c.query('SELECT * FROM staff WHERE id=$1 FOR SHARE',[staffId])).rows[0];
  if(!actor?.active||!actor.discord_verified_at||actor.discord_id!==s.evaluator_id||!allowed(actor.role,'createIFJ'))throw fail('Somente o avaliador designado com Discord confirmado pode registrar o resultado.',403);
  if(new Date(s.link_expires_at).getTime()<=Date.now())throw fail('O link da avaliação expirou. Abra uma nova avaliação pelo botão do canal.',410);
  // Repeat submissions are harmless; a conflicting result cannot replace a decision.
  if(s.status!=='pending'){
   if(s.damage_percent!==null&&Number(s.damage_percent)===value)return expose(s);
   throw fail('Este tryout já foi decidido. O resultado não pode ser alterado.',409);
  }
  const passed=value>=Number(s.threshold),deadline=passed?new Date(Date.now()+s.registration_hours*3600000):null;
  let inviteId=null;
  if(passed){
   const raw=registrationToken(s,config.secret);
   inviteId=(await c.query("INSERT INTO registration_invites(token_hash,created_by,account_kind,member_rank,expires_at,bound_discord_id,tryout_id) VALUES($1,$2,'membro','Membro',$3,$4,$5) RETURNING id",[hash(raw,config.secret),staffId,deadline,s.participant_id,s.id])).rows[0].id;
  }
  const updated=(await c.query('UPDATE tryout_sessions SET status=$1,damage_percent=$2,registration_deadline=$3,registration_invite_id=$4,evaluated_by=$5,evaluated_at=now(),updated_at=now() WHERE id=$6 RETURNING *',[passed?'passed':'failed',value,deadline,inviteId,staffId,s.id])).rows[0];
  if(!passed){
   await c.query('UPDATE members SET verified=FALSE,updated_at=now() WHERE discord_id=$1',[s.participant_id]);
   await c.query('DELETE FROM member_sessions WHERE account_id IN (SELECT a.id FROM member_accounts a JOIN members m ON m.id=a.member_id WHERE m.discord_id=$1)',[s.participant_id]);
  }
  await enqueue(c,'sync-role',{discordId:s.participant_id});
  await enqueue(c,'tryout-result',{tryoutId:s.id});
  if(passed){
   await enqueue(c,'tryout-registration-dm',{tryoutId:s.id});
   const expiry=await enqueue(c,'tryout-expire',{tryoutId:s.id});
   await c.query('UPDATE jobs SET next_at=$1 WHERE id=$2',[deadline,expiry]);
  }
  await audit(c,staffId,'Tryout avaliado',{tryoutId:s.id,participantId:s.participant_id,gameId:s.game_id,damagePercent:value,threshold:Number(s.threshold),passed});
  return expose(updated);
 });
}
export async function expireTryout(c,id,config){
 const initial=(await c.query('SELECT registration_invite_id FROM tryout_sessions WHERE id=$1',[id])).rows[0];
 // Keep invite -> tryout -> member lock order equal to signup completion.
 if(initial?.registration_invite_id)await c.query('SELECT id FROM registration_invites WHERE id=$1 FOR UPDATE',[initial.registration_invite_id]);
 const s=(await c.query('SELECT * FROM tryout_sessions WHERE id=$1 FOR UPDATE',[id])).rows[0];
 if(!s||s.status!=='passed'||new Date(s.registration_deadline).getTime()>Date.now())return false;
 await c.query("UPDATE tryout_sessions SET status='expired',updated_at=now() WHERE id=$1",[s.id]);
 await c.query('UPDATE registration_invites SET revoked_at=now() WHERE id=$1 AND consumed_at IS NULL',[s.registration_invite_id]);
 // A deadline from a previous server cannot revoke a completed admission in
 // the current destination after /criar transfers the guild.
 if(!config||config.divisions.some(d=>d.guild===s.guild_id)){
  await c.query('UPDATE members SET verified=FALSE,updated_at=now() WHERE discord_id=$1',[s.participant_id]);
  await c.query('DELETE FROM member_sessions WHERE account_id IN (SELECT a.id FROM member_accounts a JOIN members m ON m.id=a.member_id WHERE m.discord_id=$1)',[s.participant_id]);
 }
 for(const kind of ['sync-role','tryout-expired-dm','tryout-expired-channel'])await enqueue(c,kind,kind==='sync-role'?{discordId:s.participant_id}:{tryoutId:s.id});
 await audit(c,'tryout-deadline','Reprovado por cadastro não concluído',{tryoutId:s.id,participantId:s.participant_id});
 return true;
}

export function tryoutRoutes(app,pool,config){
 if(!tryoutSettings(config).enabled)return;
 const authorize=async(req,res,next)=>{
  if(!req.auth)return res.status(401).json({error:'Entre na conta da equipe e vincule seu Discord para avaliar.',code:'TRYOUT_LOGIN_REQUIRED'});
  if(!/^\d+$/.test(req.params.id))throw fail('Tryout não encontrado.',404);
  const s=(await pool.query('SELECT * FROM tryout_sessions WHERE id=$1',[req.params.id])).rows[0];
  if(!s)throw fail('Tryout não encontrado.',404);
  if(!config.divisions.some(d=>d.guild===s.guild_id))throw fail('Este tryout pertence ao servidor anterior. Abra um novo tryout na guilda atual.',410);
  if(!req.auth.discord_verified_at||req.auth.discord_id!==s.evaluator_id||!allowed(req.auth.role,'createIFJ'))throw fail('Somente o avaliador designado, com Discord confirmado, pode abrir esta avaliação.',403);
  const raw=req.get('authorization')?.replace(/^Bearer /,'');
  if(new Date(s.link_expires_at).getTime()<=Date.now()||!same(raw,evaluatorToken(s,config.secret)))throw fail('Link de avaliação inválido ou expirado. No canal, clique em Abrir avaliação para gerar outro.',410);
  req.tryout=s;next();
 };
 app.get('/api/tryouts/:id',authorize,(req,res)=>res.json({tryout:expose(req.tryout),csrf:req.auth.csrf}));
 app.post('/api/tryouts/:id/result',authorize,async(req,res)=>{
  if(req.get('origin')!==config.origin||req.get('x-csrf-token')!==req.auth.csrf)throw fail('Sessão inválida. Recarregue o link.',403);
  res.json({tryout:await recordTryoutResult(pool,config,req.tryout.id,req.body.damage_percent,req.auth.staff_id)});
 });
 app.get('/api/tryouts',async(req,res)=>{
  if(!req.auth)return res.status(401).json({error:'Entre na conta da equipe.'});
  if(!req.auth.discord_verified_at||!allowed(req.auth.role,'createIFJ'))throw fail('Confirme seu Discord de avaliador.',403);
  const rows=(await pool.query('SELECT * FROM tryout_sessions WHERE evaluator_id=$1 ORDER BY id DESC LIMIT 100',[req.auth.discord_id])).rows;
  res.json(rows.map(s=>({...expose(s),url:new Date(s.link_expires_at).getTime()>Date.now()?evaluationUrl(s,config):null,channel_url:s.channel_id?`https://discord.com/channels/${s.guild_id}/${s.channel_id}`:null})));
 });
}

export function createTryouts(pool,config,client){
 const settings=tryoutSettings(config);
 async function sessionChannel(s){const ch=await client.channels.fetch(s.channel_id);if(!ch||ch.guildId!==s.guild_id||!ch.send)throw Error('TRYOUT_CHANNEL_UNAVAILABLE');return ch;}
 async function enqueueOnce(c,kind,s,scope=''){return c.query('INSERT INTO jobs(kind,payload,dedupe_key) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[kind,JSON.stringify({tryoutId:s.id}),`${kind}:${s.id}${scope?':'+scope:''}`]);}
 async function start(i,gameId){
  const game=gameById(gameId);if(!game)throw fail('Escolha Westbound, Deepwoken ou Klase para iniciar seu tryout.');
  const d=config.divisions.find(v=>v.guild===i.guildId);if(!d)throw fail('Execute /criar antes de abrir tryouts.');
  const g=await client.guilds.fetch(i.guildId),evaluatorId=settings.evaluatorId||g.ownerId;
  if(i.user.id===evaluatorId)throw fail('O avaliador não pode participar do próprio tryout.');
  const evaluator=await g.members.fetch(evaluatorId),participant=await g.members.fetch(i.user.id);
  if(evaluator.user?.bot||participant.user?.bot)throw fail('Tryouts exigem contas humanas.');
  return tx(pool,async c=>{
   await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`tryout:${g.id}:${i.user.id}`]);
   const current=(await c.query('SELECT * FROM tryout_sessions WHERE guild_id=$1 AND participant_id=$2 ORDER BY id DESC LIMIT 1 FOR UPDATE',[g.id,i.user.id])).rows[0];
   if(current&&['pending','passed'].includes(current.status)){
    const ch=current.channel_id?(await g.channels.fetch()).get(current.channel_id):null;
    if(ch?.guildId===g.id&&ch.send)return current;
    // A repeated click recovers a failed creation or deleted private channel.
    // Never lock/update an existing job while holding this session: the worker
    // locks jobs first. Pending work already covers an in-flight creation.
    if(current.channel_id){await c.query('UPDATE tryout_sessions SET channel_id=NULL,updated_at=now() WHERE id=$1',[current.id]);current.channel_id=null;}
    if(!(await c.query("SELECT id FROM jobs WHERE kind='tryout-create' AND status='pending' AND payload->>'tryoutId'=$1 LIMIT 1",[String(current.id)])).rowCount)await enqueue(c,'tryout-create',{tryoutId:current.id});
    return current;
   }
   if(current?.status==='registered'&&(await c.query('SELECT id FROM members WHERE id=$1 AND discord_id=$2 AND verified=TRUE AND card_revoked_at IS NULL',[current.member_id,i.user.id])).rowCount)throw fail('Seu cadastro já foi concluído. Acesse o painel de membros.');
   const s=(await c.query('INSERT INTO tryout_sessions(guild_id,participant_id,evaluator_id,participant_nick,evaluator_nick,threshold,registration_hours,link_nonce,link_expires_at,game_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',[g.id,i.user.id,evaluatorId,participant.displayName||participant.user.username,evaluator.displayName||evaluator.user.username,settings.passPercent,settings.registrationHours,token(),new Date(Date.now()+72*3600000),game.id])).rows[0];
   await enqueueOnce(c,'tryout-create',s);await audit(c,i.user.id,'Tryout solicitado',{tryoutId:s.id,gameId:game.id});return s;
  });
 }
 async function interact(i){
  if(!settings.enabled)return false;
  const opening=i.isButton?.()&&['tryout-start','verify'].includes(i.customId);
  const selection=i.isButton?.()&&i.customId.startsWith('tryout-game:');
  const recover=i.isButton?.()&&/^tryout-evaluate:\d+$/.test(i.customId);
  const legacy=(i.isModalSubmit?.()&&['verify-card-form','verify-form'].includes(i.customId))||(i.isButton?.()&&/^(confirm|cancel):/.test(i.customId));
  if(!opening&&!selection&&!recover&&!legacy)return false;
  await i.deferReply(ephemeral);
  try{
   if(legacy){await i.editReply('O acesso agora exige tryout. Use o botão Iniciar tryout no painel da guilda.');return true;}
   if(opening){await i.editReply({content:'Em qual jogo você quer fazer seu tryout? Escolha uma opção para abrir o canal privado com o avaliador.',components:[new ActionRowBuilder().addComponents(...GAMES.map(game=>new ButtonBuilder().setCustomId(`tryout-game:${game.id}`).setLabel(game.name).setStyle(ButtonStyle.Primary)))]});return true;}
   if(recover){
    const s=await tx(pool,async c=>{const r=(await c.query('SELECT * FROM tryout_sessions WHERE id=$1 FOR UPDATE',[Number(i.customId.split(':')[1])])).rows[0];
     if(!r||r.evaluator_id!==i.user.id||r.guild_id!==i.guildId||r.channel_id!==i.channelId)throw fail('Somente o avaliador designado pode abrir este link.',403);
     if(new Date(r.link_expires_at).getTime()<=Date.now()){r.link_expires_at=new Date(Date.now()+72*3600000);await c.query('UPDATE tryout_sessions SET link_expires_at=$1 WHERE id=$2',[r.link_expires_at,r.id]);}
     return r;});
    await i.editReply({content:`Abra sua avaliação de ${gameName(s)}. Entre no painel da equipe e confirme o mesmo Discord.`,components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(evaluationUrl(s,config)).setLabel('Avaliar tryout'))]});return true;
   }
   const selected=i.customId.slice('tryout-game:'.length),s=await start(i,selected);
   const existing=s.game_id!==selected?`Você já tem um tryout ativo de ${gameName(s)}. Termine essa tentativa antes de escolher outro jogo. `:'';
   await i.editReply({content:existing+(s.channel_id?`Seu tryout de ${gameName(s)} está em <#${s.channel_id}>.`:`Tryout de ${gameName(s)} solicitado. O bot está preparando seu canal privado com o avaliador.`),components:[]});
  }catch(e){if(e.status)await i.editReply(e.message);else throw e;}
  return true;
 }
 async function execute(job,c){
  const s=(await c.query('SELECT * FROM tryout_sessions WHERE id=$1',[job.payload.tryoutId])).rows[0];if(!s)return;
  if(job.kind==='tryout-expire'){await expireTryout(c,s.id,config);return;}
  const nonce={nonce:`hb-${job.id}`,enforceNonce:true,allowedMentions:{parse:[]}};
  let sent;
  if(job.kind==='tryout-create'){
   const g=await client.guilds.fetch(s.guild_id),d=config.divisions.find(v=>v.guild===s.guild_id);if(!d)throw Error('TRYOUT_GUILD_NOT_CONFIGURED');
   const all=await g.channels.fetch(),marker=`HRISTE-TRYOUT:${s.id}`;
   let ch=(s.channel_id&&all.get(s.channel_id))||[...all.values()].find(v=>v?.topic===marker);
   if(!ch){
    const parent=d.resources?.['tryouts-category'];if(!parent)throw Error('TRYOUT_CATEGORY_NOT_CONFIGURED');
    const me=await g.members.fetchMe();
    ch=await g.channels.create({name:`tryout-${s.game_id}-${s.id}`,type:ChannelType.GuildText,parent,topic:marker,permissionOverwrites:[{id:g.id,type:0,deny:[P.ViewChannel]},{id:me.id,type:1,allow:[P.ViewChannel,P.SendMessages,P.ReadMessageHistory,P.EmbedLinks,P.ManageChannels]},{id:s.participant_id,type:1,allow:[P.ViewChannel,P.SendMessages,P.ReadMessageHistory]},{id:s.evaluator_id,type:1,allow:[P.ViewChannel,P.SendMessages,P.ReadMessageHistory,P.EmbedLinks]}],reason:`${BRAND_NAME}: tryout privado ${s.id} • ${gameName(s)}`});
   }
   await c.query('UPDATE tryout_sessions SET channel_id=$1,updated_at=now() WHERE id=$2',[ch.id,s.id]);
   await enqueueOnce(c,'tryout-welcome',s,ch.id);
   await enqueueOnce(c,'tryout-evaluator-dm',s);
   // A recreated channel must also restore the still-valid mandatory signup.
   if(s.status==='passed')await enqueueOnce(c,'tryout-result',s,ch.id);
   return;
  }
  if(job.kind==='tryout-welcome'){
   sent=await (await sessionChannel(s)).send({...nonce,embeds:[new Embed().setTitle(`Tryout #${s.id} • ${gameName(s)}`).setDescription(`Participante: **${safe(s.participant_nick)}**\nAvaliador: **${safe(s.evaluator_nick)}**\n\nRetire pelo menos **${Number(s.threshold)}%** da vida do avaliador. A decisão é calculada automaticamente.\n\nDepois de aprovado, seu cadastro é obrigatório em **${s.registration_hours} horas** para manter os canais.`)],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`tryout-evaluate:${s.id}`).setLabel('Abrir avaliação • avaliador').setStyle(ButtonStyle.Primary))]});
  }else if(job.kind==='tryout-evaluator-dm'){
   sent=await (await client.users.fetch(s.evaluator_id)).send({...nonce,embeds:[new Embed().setTitle(`Avaliação de ${safe(s.participant_nick)}`).setDescription(`Tryout #${s.id} • **${gameName(s)}** • Avaliador: **${safe(s.evaluator_nick)}**.\nAbra o link e informe a porcentagem de vida que o participante retirou de você. Você precisará entrar na conta da equipe com este Discord confirmado.`)],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Registrar resultado').setURL(evaluationUrl(s,config)))]});
  }else if(job.kind==='tryout-result'){
   const passed=Number(s.damage_percent)>=Number(s.threshold);
   const open=passed&&s.status==='passed'&&new Date(s.registration_deadline).getTime()>Date.now();
   const outcome=s.status==='registered'?'\n\nCadastro concluído. Seu acesso de membro está confirmado.':passed&&!open?'\n\nO prazo obrigatório de cadastro terminou. Seu acesso foi revogado e você foi reprovado.':open?`\n\nAcesso provisório autorizado. Conclua o cadastro obrigatório até <t:${Math.floor(new Date(s.registration_deadline).getTime()/1000)}:F>. Sem cadastro, seu cargo será removido e você será reprovado.`:'\n\nO mínimo não foi atingido. Converse com o avaliador sobre outra tentativa.';
   sent=await (await sessionChannel(s)).send({...nonce,embeds:[new Embed().setTitle(passed&&!open&&s.status!=='registered'?'REPROVADO • CADASTRO NÃO CONCLUÍDO':passed?'APROVADO NO TRYOUT':'REPROVADO NO TRYOUT').setDescription(`Jogo: **${gameName(s)}**.\n**${safe(s.participant_nick)}** retirou **${Number(s.damage_percent)}%** da vida de **${safe(s.evaluator_nick)}**.\nMínimo: **${Number(s.threshold)}%**.${outcome}`)],components:open?[new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Cadastro obrigatório').setURL(registrationUrl(s,config)),new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Painel de membros').setURL(new URL('/membros',config.origin).href))]:[]});
  }else if(job.kind==='tryout-registration-dm'){
   if(s.status!=='passed'||new Date(s.registration_deadline).getTime()<=Date.now()||!config.divisions.some(d=>d.guild===s.guild_id))return;
   sent=await (await client.users.fetch(s.participant_id)).send({...nonce,embeds:[new Embed().setTitle(`Bem-vindo à ${BRAND_NAME}`).setDescription(`Você passou no tryout de **${gameName(s)}** com **${Number(s.damage_percent)}%**. Faça seu cadastro até <t:${Math.floor(new Date(s.registration_deadline).getTime()/1000)}:F>.\n\n**É obrigatório:** sem cadastro concluído, você perde o cargo e é reprovado. O link pertence ao seu Discord. Se as DMs falharem, ele também está no canal do tryout.`)],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Concluir meu cadastro').setURL(registrationUrl(s,config)),new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Painel de membros').setURL(new URL('/membros',config.origin).href))]});
  }else if(job.kind==='tryout-expired-dm'||job.kind==='tryout-expired-channel'){
   if(s.status!=='expired')return;
   const target=job.kind==='tryout-expired-dm'?await client.users.fetch(s.participant_id):await sessionChannel(s);
   const currentGuild=config.divisions.some(d=>d.guild===s.guild_id);
   sent=await target.send({...nonce,embeds:[new Embed().setTitle('Reprovado • cadastro não concluído').setDescription(`**${safe(s.participant_nick)}**, no tryout de **${gameName(s)}**, o prazo de ${s.registration_hours} horas terminou sem o cadastro obrigatório. ${currentGuild?'Seu acesso foi revogado e a remoção dos cargos está na fila automática. Solicite outro tryout para tentar novamente.':'Este tryout do servidor anterior foi encerrado. Seu cadastro no servidor atual não foi alterado.'}`)]});
  }else if(job.kind==='tryout-complete'){
   if(s.status!=='registered')return;
   sent=await (await sessionChannel(s)).send({...nonce,embeds:[new Embed().setTitle('Cadastro concluído • membro confirmado').setDescription(`**${safe(s.participant_nick)}** concluiu o cadastro obrigatório após o tryout de **${gameName(s)}**. Seu acesso está confirmado; sua carteira será entregue pelo bot.`)],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Meu painel').setURL(new URL('/membros',config.origin).href))]});
  }
  if(sent)await c.query('UPDATE jobs SET message_id=$1 WHERE id=$2',[sent.id,job.id]);
 }
 async function schedule(){
  if(!settings.enabled)return;
  // Recovery scan survives restarts and re-queues a missing or failed deadline job.
  const due=(await pool.query("SELECT id FROM tryout_sessions WHERE status='passed' AND registration_deadline<=now() ORDER BY id LIMIT 100")).rows;
  for(const s of due)await tx(pool,c=>expireTryout(c,s.id,config));
 }
 return {start,interact,execute,schedule};
}
