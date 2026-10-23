import {SlashCommandBuilder,PermissionFlagsBits as P,MessageFlags,ActionRowBuilder,ButtonBuilder,ButtonStyle} from 'discord.js';
import {RokuharaEmbed} from './embed-theme.js';
import {tx,enqueue,audit} from './db.js';
import {createMemberRecord} from './member-store.js';
export const allyJobs=new Set(['ally-scan','ally-import','ally-welcome']);
export function createAllyMigration(pool,config,client){
 const enabled=()=>Boolean(config.immigrationGuild&&config.oldAllyRole);
 async function validate(){
  if(!enabled())return;
  const g=await client.guilds.fetch(config.immigrationGuild),roles=await g.roles.fetch();
  if(!roles.has(config.oldAllyRole)||config.oldAllyRole===g.id)throw Object.assign(new Error('OLD_ALLY_ROLE_ID: cargo de aliados não encontrado ou @everyone no servidor antigo.'),{code:'ALLY_CONFIG'});
  await g.commands.create(new SlashCommandBuilder().setName('migrar-aliados').setDescription('Importar aliados do servidor antigo e enviar HB-ID + convite').setDefaultMemberPermissions(P.Administrator).toJSON());
 }
 async function interact(i){
  if(!i.isChatInputCommand?.()||i.commandName!=='migrar-aliados')return false;
  await i.deferReply({flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}});
  if(!enabled()||i.guildId!==config.immigrationGuild){await i.editReply('Use no servidor antigo com IMMIGRATION_GUILD_ID, OLD_ALLY_ROLE_ID e os convites configurados.');return true;}
  const g=await client.guilds.fetch(i.guildId),actor=await g.members.fetch({user:i.user.id,force:true});
  if(g.ownerId!==i.user.id&&!actor.permissions.has(P.Administrator)){await i.editReply('Somente o dono ou um Administrador do Discord no servidor antigo pode migrar aliados.');return true;}
  await tx(pool,async c=>{
   await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`ally-scan:${g.id}`]);
   if((await c.query("SELECT id FROM jobs WHERE kind='ally-scan' AND status='pending' AND payload->>'guildId'=$1",[g.id])).rowCount)return;
   await c.query("INSERT INTO jobs(kind,payload,dedupe_key) VALUES('ally-scan',$1,$2) ON CONFLICT DO NOTHING",[JSON.stringify({guildId:g.id,roleId:config.oldAllyRole,actorId:i.user.id}),`ally-scan:${i.id}`]);
  });
  await i.editReply({embeds:[new RokuharaEmbed().setTitle('Migração de aliados iniciada').setDescription('**01 · CADASTRO**\nVamos salvar os IDs e usuários de quem tem o cargo de aliados.\n\n**02 · CONVITE**\nCada aliado receberá seu HB-ID, um agradecimento e o convite do distrito no privado.\n\n**03 · ACESSO**\nAo entrar no distrito, o aliado cadastrado receberá acesso e o cargo Aliados automaticamente.\n\nAcompanhe o andamento em **Aliados migrados** no painel. Repetir não duplica cadastros.')]});return true;
 }
 async function execute(job,c){
  const p=job.payload;
  if(job.kind==='ally-scan'){
   if(!enabled()||p.guildId!==config.immigrationGuild||p.roleId!==config.oldAllyRole)throw Object.assign(new Error('Configuração de origem alterada.'),{code:'ALLY_CONFIG'});
   const g=await client.guilds.fetch(p.guildId);const roles=await g.roles.fetch();if(!roles.has(p.roleId))throw Object.assign(new Error('Cargo de origem ausente.'),{code:'ALLY_CONFIG'});
   // Fetch ALL members through the gateway: role.members alone contains only cached members.
   const members=await g.members.fetch({withPresences:false,time:60000});let found=0;
   for(const m of members.values()){
    if(m.user.bot||!m.roles.cache.has(p.roleId))continue;found++;
    const r=(await c.query("INSERT INTO ally_imports(source_guild,source_role,discord_id,username,display_name,actor_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(source_guild,discord_id) DO UPDATE SET username=EXCLUDED.username,display_name=EXCLUDED.display_name RETURNING *",[g.id,p.roleId,m.id,m.user.username,m.displayName||m.user.username,p.actorId])).rows[0];
    if(r.status==='pending')await c.query("INSERT INTO jobs(kind,payload,dedupe_key) VALUES('ally-import',$1,$2) ON CONFLICT DO NOTHING",[JSON.stringify({importId:r.id}),`ally-import:${r.id}`]);
   }
   await audit(c,`discord:${p.actorId}`,'Aliados encontrados no servidor antigo',{guildId:g.id,roleId:p.roleId,total:found});return;
  }
  const r=(await c.query('SELECT * FROM ally_imports WHERE id=$1 FOR UPDATE',[p.importId])).rows[0];if(!r)return;
  if(job.kind==='ally-import'){
   if(r.status!=='pending')return;
   if(!enabled()||r.source_guild!==config.immigrationGuild||r.source_role!==config.oldAllyRole)throw Object.assign(new Error('Origem alterada.'),{code:'ALLY_CONFIG'});
   const g=await client.guilds.fetch(r.source_guild),current=await g.members.fetch({user:r.discord_id,force:true}).catch(e=>{if(e.code===10007)return null;throw e;});
   if(!current||current.user.bot||!current.roles.cache.has(r.source_role)){await c.query("UPDATE ally_imports SET status='skipped' WHERE id=$1",[r.id]);return;}
   await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`ally-member:${r.discord_id}`]);
   let m=(await c.query('SELECT * FROM members WHERE discord_id=$1 FOR UPDATE',[r.discord_id])).rows[0];
   if(!m)m=await createMemberRecord(c,{name:r.display_name.slice(0,100),game_nick:null,roblox_username:null,discord_id:r.discord_id,division:1,account_kind:'aliado',allied_gang:'Não informada',member_rank:'Aliado'},null);
   // The source role is the authorization, never a matching name or supplied IFJ.
   await c.query("UPDATE members SET account_kind='aliado',allied_gang=COALESCE(allied_gang,'Não informada'),member_rank='Aliado',verified=TRUE,auto_allied=TRUE,discord_username=$1,identity_version=identity_version+1,updated_at=now() WHERE id=$2",[r.username,m.id]);
   await c.query('DELETE FROM confirmations WHERE member_id=$1',[m.id]);
   await enqueue(c,'sync-role',{discordId:r.discord_id});
   const notification=await enqueue(c,'ally-welcome',{importId:r.id});
   await c.query("UPDATE ally_imports SET status='imported',member_id=$1,notification_job_id=$2 WHERE id=$3",[m.id,notification,r.id]);
   await audit(c,`discord:${r.actor_id}`,'Aliado migrado com acesso automático',{importId:r.id,memberId:m.id,discordId:r.discord_id});return;
  }
  if(job.kind==='ally-welcome'){
   const m=(await c.query('SELECT * FROM members WHERE id=$1 FOR UPDATE',[r.member_id])).rows[0];
   if(!m||m.discord_id!==r.discord_id||!m.auto_allied||!m.verified||m.account_kind!=='aliado')throw Object.assign(new Error('Cadastro revogado.'),{code:'IFJ_CHANGED'});
   const destinations=config.divisions.filter(d=>/^https:\/\/(discord\.gg\/|discord\.com\/invite\/)[A-Za-z0-9-]+$/.test(d.invite||''));
   const embed=new RokuharaEmbed().setTitle('Nossa aliança continua • Você está convidado').setDescription('🤝 **A parceria continua no HRISTE BOZE!**\nSeu cadastro de aliado está pronto e vinculado à sua conta Discord.\n\nEntre no distrito com esta mesma conta para receber seu acesso e o cargo de Aliado. Sua nova carteira HB-ID será entregue no privado após a entrada.').addFields({name:'SEU HB-ID',value:'\`'+m.idrkc+'\`',inline:true},{name:'DISCORD VINCULADO',value:'\`'+m.discord_id+'\`',inline:true}).setFooter({text:'GUILDA HRISTE BOZE • Respeito e parceria'});
   for(const d of destinations)embed.addFields({name:d.name||'Entre no distrito',value:d.invite});
   if(!destinations.length)embed.addFields({name:'Entre no distrito',value:'Peça o convite atual à administração.'});
   const user=await client.users.fetch(r.discord_id);const sent=await user.send({embeds:[embed],components:destinations.length?[new ActionRowBuilder().addComponents(...destinations.map(d=>new ButtonBuilder().setLabel('Entrar no distrito').setStyle(ButtonStyle.Link).setURL(d.invite)))]:[],allowedMentions:{parse:[]},nonce:String(job.id),enforceNonce:true});
   await c.query('UPDATE jobs SET message_id=$1 WHERE id=$2',[sent.id,job.id]);
  }
 }
 return {validate,interact,execute};
}
