import {ROLE_ENV} from './config-rules.js';
import {deleteCommand,deletionHandler} from './delete-structure.js';
import {rankRoles,categories,textChannels,voiceChannels} from './server-layout.js';
import {assertManagedRoles} from './role-policy.js';
import {DISTRICT_NAME,DISTRICT_COLOR,saveSbiDistrict,canConfigureDestination} from './sbi.js';
import {SlashCommandBuilder,PermissionFlagsBits as P,ChannelType as T,MessageFlags,AttachmentBuilder} from 'discord.js';
export class ProvisionError extends Error {}
const ensure=(ok,message)=>{if(!ok)throw new ProvisionError(message);};
export function createCommand(){return new SlashCommandBuilder().setName('criar').setDescription('Configurar o GUILDA HRISTE BOZE e salvar tudo no SBI').setDefaultMemberPermissions(P.Administrator).setDMPermission(false).toJSON();}
export function configureCommand(){return new SlashCommandBuilder().setName('configurar').setDescription('Configurar cargos e permissões da guilda').setDefaultMemberPermissions(P.Administrator).setDMPermission(false).addSubcommand(s=>s.setName('cargos').setDescription('Dar os cargos e patentes aos membros verificados no painel')).addSubcommand(s=>s.setName('permissoes').setDescription('Reaplicar permissões nos canais e categorias da guilda')).toJSON();}
export async function registerCreate(client,divisions=[]){
 await client.application.commands.create(createCommand());
 await client.application.commands.create(configureCommand());
 for(const d of divisions){const g=await client.guilds.fetch(d.guild);await g.commands.create(createCommand());await g.commands.create(configureCommand());await g.commands.create(deleteCommand());}
}
export async function checkProvisionGuild(g,{rolesOnly=false}={}){
 const me=await g.members.fetchMe();
 ensure(me.permissions.has(rolesOnly?[P.ManageRoles]:[P.ManageChannels,P.ManageRoles,P.ViewChannel,P.SendMessages,P.EmbedLinks,P.AttachFiles,P.ReadMessageHistory,P.Connect,P.Speak]),rolesOnly?'O bot precisa de Gerenciar cargos.':'O bot precisa de Gerenciar canais, Gerenciar cargos, Ver canais, Enviar mensagens, Incorporar links, Anexar arquivos, Ler histórico, Conectar e Falar.');
 return me;
}
const botAllow=[P.ViewChannel,P.SendMessages,P.EmbedLinks,P.AttachFiles,P.ReadMessageHistory,P.ManageChannels,P.ManageRoles,P.Connect,P.Speak];
function channelPermissions(g,me,d,key,scope){
 if(key==='tryouts-category')return [{id:g.id,type:0,deny:[P.ViewChannel]},{id:me.id,type:1,allow:botAllow}];
 return [{id:g.id,type:0,...(scope==='public'?{allow:[P.ViewChannel,P.ReadMessageHistory],deny:[P.SendMessages]}:{deny:[P.ViewChannel]})},{id:me.id,type:1,allow:botAllow},{id:d.adminRole,type:0,allow:[P.ViewChannel,P.SendMessages,P.ReadMessageHistory,P.Connect,P.Speak]},...(['members','readonly'].includes(scope)?[{id:d.memberRole,type:0,allow:[P.ViewChannel,P.ReadMessageHistory,P.Connect,P.Speak,...(scope==='members'?[P.SendMessages]:[])],...(scope==='readonly'?{deny:[P.SendMessages]}:{})}]:[])];
}
export async function provisionGuild(g,input={}, {persist=async()=>{},rolesOnly=false}={}){
 const d={...input,id:1,name:DISTRICT_NAME,guild:g.id,rankRoles:{...input.rankRoles},resources:{...input.resources}};
 const me=await checkProvisionGuild(g,{rolesOnly}),roles=await g.roles.fetch(),channels=rolesOnly?new Map():await g.channels.fetch(),tag='HB-D1';
 const oldRoles={member:['✅','Membro verificado'],admin:['🛡️','Equipe'],leader:['👑','Líder'],subleader:['⚜️','Sub líder'],high:['💎','High member'],moderator:['🔰','Moderador'],recruiter:['📋','Recrutador'],ally:['🤝','Aliado'],veteran:['⭐','Veterano'],rookie:['🌱','Novato']};
 const oldCategories={entry:['🚪','PORTAL','ENTRADA'],info:['📜','INFORMAÇÕES'],internal:['💬','CONVIVÊNCIA','DIVISÃO'],operations:['⚔️','OPERAÇÕES'],training:['🎯','TREINAMENTOS'],voice:['🎙️','CENTRAL DE CALLS'],staff:['🛡️','COMANDO','EQUIPE'],'tickets-category':['🎫','ATENDIMENTOS','ATENDIMENTOS']};
 const oldVoices={voice1:['🔊','Call 1'],voice2:['🔊','Call 2'],'voice-training':['🥋','Treinamento'],'voice-operations':['⚔️','Operações'],'voice-staff':['🛡️','Reunião da equipe'],'voice-interview':['📋','Entrevistas']};
 const legacyNames=(spec,type)=>{if(!spec)return [];const [emoji,title,old]=spec;return type==='category'?[`RKC • 🟠 ${emoji} ━ ${title}`,`IFJ-D1 • 🟠 ${emoji} ━ ${title}`,`IFJ-D1 • 🟢 ${emoji} ━ ${title}`,`IFJ-D1 • ${old||title}`]:[`RKC • ${emoji} ┃ ${title}`,`IFJ-D1 • ${emoji} ┃ ${title}`,`IFJ-D1 • ${title}`];};
 const unique=(items,predicate)=>{const found=[...items.values()].filter(x=>x&&predicate(x));ensure(found.length<=1,'Há nomes da guilda duplicados. Renomeie as cópias antes de repetir /criar.');return found[0];};
 const roleMap=new Map(),inventory=[],notes=[];
 await persist(d);
 async function role(key,emoji,suffix){
  const configured=key==='member'?d.memberRole:key==='admin'?d.adminRole:d.rankRoles[key],name=`HB • ${emoji} ┃ ${suffix}`;
  let r=(configured&&roles.get(configured))||unique(roles,x=>[name,...legacyNames(oldRoles[key],'role')].includes(x.name));
  if(!r){r=await g.roles.create({name,color:DISTRICT_COLOR,hoist:['leader','subleader','high','admin'].includes(key),mentionable:false,permissions:[],reason:'Estrutura GUILDA HRISTE BOZE'});roles.set(r.id,r);}
  else if(r.editable&&!r.managed)await r.edit({name,color:DISTRICT_COLOR,reason:'Atualizar identidade HRISTE BOZE'});
  else notes.push(`Cargo ${r.name}: coloque o bot acima dele para permitir atualizar a aparência.`);
  if(rolesOnly&&['member','admin'].includes(key)&&configured!==r.id)d.permissionRepairPending=true;
  if(key==='member')d.memberRole=r.id;else if(key==='admin')d.adminRole=r.id;else d.rankRoles[key]=r.id;
  roleMap.set(key,r);inventory.push(`CARGO | ${r.name} | ${r.id}`);await persist(d);return r;
 }
 const member=await role(...rankRoles[0]),admin=await role(...rankRoles[1]);
 ensure(member.id!==g.id&&admin.id!==g.id&&member.id!==admin.id&&!member.managed&&!admin.managed&&!member.permissions.has(P.Administrator)&&!admin.permissions.has(P.Administrator),'Cargos de acesso inválidos: Juramentado e Conselho devem ser cargos comuns, sem Administrator.');
 ensure(me.roles.highest.comparePositionTo(member)>0,'Coloque o cargo do bot acima do cargo de Juramentado.');
 for(const spec of rankRoles.slice(2))await role(...spec);
 try{assertManagedRoles(g,d,roles,me);}catch(e){throw new ProvisionError(e.message);}
 if(rolesOnly)return {district:d,inventory:`${DISTRICT_NAME} · servidor ${g.id}\n${rankRoles.length} cargos configurados\n\n${inventory.join('\n')}\n\n${notes.join('\n')}`};
 const property={verification:'verification',welcome:'welcome',guide:'guide',wanted:'wanted',tickets:'tickets',reports:'reports','tickets-category':'category','staff-text':'staffChannel',alliances:'allianceChannel',news:'newsChannel'};
 async function channel(key,name,type,scope,parent,legacy=[]){
  const marker=`${tag}:${key}`,configured=d.resources[key]||d[property[key]];
  let ch=(configured&&channels.get(configured))||unique(channels,x=>type===T.GuildText?[marker,`IFJ-D1:${key}`].includes(x.topic):x.type===type&&[name,...legacy].includes(x.name));
  // Category itself is bot-only. Each tryout grants only its examiner and participant.
  const permissions=channelPermissions(g,me,d,key,scope);
  const data={name,type,permissionOverwrites:permissions,...(parent?{parent:parent.id}:{}),...(type===T.GuildText?{topic:marker}:{})};
  if(ch){ensure(ch.type===type,'Um canal da guilda tem tipo incompatível.');const {type:unused,...edit}=data;await ch.edit({...edit,reason:'Atualizar GUILDA HRISTE BOZE'});}
  else{ch=await g.channels.create({...data,reason:'Estrutura GUILDA HRISTE BOZE'});channels.set(ch.id,ch);}
  d.resources[key]=ch.id;if(property[key])d[property[key]]=ch.id;if(key==='news')d.news=ch.id;
  inventory.push(`${type===T.GuildCategory?'CATEGORIA':type===T.GuildVoice?'CALL':'TEXTO'} | ${ch.name} | ${ch.id}`);await persist(d);return ch;
 }
 const categoryMap=new Map();
 for(const [key,title,emoji,scope]of categories)categoryMap.set(key,await channel(key,`HB • 🟡 ${emoji} ━ ${title}`,T.GuildCategory,scope,undefined,legacyNames(oldCategories[key],'category')));
 for(const [key,title,emoji,parent,scope]of textChannels)await channel(key,`${emoji}┃${title}`,T.GuildText,scope,categoryMap.get(parent));
 for(const [key,title,emoji,parent,scope]of voiceChannels)await channel(key,`HB • ${emoji} ┃ ${title}`,T.GuildVoice,scope,categoryMap.get(parent),legacyNames(oldVoices[key],'voice'));
 if(d.permissionRepairPending){delete d.permissionRepairPending;await persist(d);}
 if(!d.invite&&me.permissions.has(P.CreateInstantInvite)){
  const welcome=channels.get(d.welcome);
  if(welcome?.createInvite)try{const invite=await welcome.createInvite({maxAge:0,maxUses:0,unique:false,reason:'Convite da guilda salvo pelo SBI'});d.invite=invite.url;await persist(d);}catch{notes.push('Convite não criado: revise Criar convite no canal de boas-vindas.');}
 }
 if(g.name!==DISTRICT_NAME&&g.setName&&me.permissions.has(P.ManageGuild))await g.setName(DISTRICT_NAME,'Identidade da guilda HRISTE BOZE');
 else if(g.name!==DISTRICT_NAME)notes.push(`Nome do servidor: ${DISTRICT_NAME}. Para o bot atualizar o nome, conceda Gerenciar servidor.`);
 const values={GUILD_ID:g.id,MEMBER_ROLE_ID:d.memberRole,ADMIN_ROLE_ID:d.adminRole,VERIFICATION_CHANNEL_ID:d.verification,WELCOME_CHANNEL_ID:d.welcome,GUIDE_CHANNEL_ID:d.guide,WANTED_CHANNEL_ID:d.wanted,TICKETS_CHANNEL_ID:d.tickets,REPORTS_CHANNEL_ID:d.reports,TICKET_CATEGORY_ID:d.category,STAFF_CHANNEL_ID:d.staffChannel,ALLIANCE_CHANNEL_ID:d.allianceChannel,NEWS_CHANNEL_ID:d.newsChannel,...Object.fromEntries(Object.entries(ROLE_ENV).map(([key,suffix])=>[suffix,d.rankRoles[key]]))};
 return {district:d,env:Object.entries(values).map(([key,value])=>`DIV_1_${key}=${value}`).join('\n')+'\n',inventory:`${DISTRICT_NAME} · servidor ${g.id}\n${categories.length} categorias • ${textChannels.length} textos • ${voiceChannels.length} calls • ${rankRoles.length} cargos\n\n${inventory.join('\n')}\n\n${notes.join('\n')}\n\nSBI: cargos, canais e servidor salvos automaticamente no banco. Não é necessário copiar IDs para variáveis. Líder, Sub líder, High member e Moderador recebem Conselho conforme o cadastro. Conselho não deve receber Administrator global.\n`};
}
export async function configureGuildPermissions(g,d){
 const me=await g.members.fetchMe();
 ensure(me.permissions.has([P.ManageChannels,P.ViewChannel]),'O bot precisa de Gerenciar canais e Ver canais.');
 const roles=await g.roles.fetch();
 const member=roles.get(d.memberRole),admin=roles.get(d.adminRole);
 ensure(member&&admin&&member.id!==g.id&&admin.id!==g.id&&member.id!==admin.id&&!member.managed&&!admin.managed&&!member.permissions.has(P.Administrator)&&!admin.permissions.has(P.Administrator),'Cargos de acesso ausentes ou inválidos. Execute /configurar cargos antes de configurar permissões.');
 const channels=await g.channels.fetch(),targets=[...categories.map(([key,,,scope])=>({key,scope,type:T.GuildCategory})),...textChannels.map(([key,,,,scope])=>({key,scope,type:T.GuildText})),...voiceChannels.map(([key,,,,scope])=>({key,scope,type:T.GuildVoice}))];
 const inventory=[],missing=[];
 // Only known, persisted layout IDs are eligible. Per-person tryouts and tickets remain private.
 for(const target of targets){
  const channel=channels.get(d.resources?.[target.key]);
  if(!channel){missing.push(target.key);continue;}
  ensure(channel.type===target.type,`O recurso ${target.key} tem tipo incompatível. Confira o SBI antes de repetir.`);
 }
 for(const {key,scope} of targets){
  const channel=channels.get(d.resources?.[key]);if(!channel)continue;
  await channel.edit({permissionOverwrites:channelPermissions(g,me,d,key,scope),reason:'HRISTE BOZE /configurar permissoes'});
  inventory.push(`${key} | ${channel.id}`);
 }
 return {count:inventory.length,missing,inventory:`${DISTRICT_NAME}\nPermissões atualizadas: ${inventory.length}\n${inventory.join('\n')}\n${missing.length?`Recursos ausentes: ${missing.join(', ')}. Use /criar para recriá-los.`:''}`};
}
export function createProvisionHandler(client,divisions,{pool,config={divisions},onConfigured=async()=>{},onRolesConfigured=async()=>0}={}){
 const locks=new Set(),remove=deletionHandler(client,divisions,locks);
 return async i=>{
  if(await remove(i))return true;
  if(!i.isChatInputCommand?.()||!['criar','configurar'].includes(i.commandName))return false;
  const configuring=i.commandName==='configurar',command=`/${i.commandName}`;
  await i.deferReply({flags:MessageFlags.Ephemeral});let locked=false,connection,dbLock=false,saved=false;const guildId=i.guildId;
  try{
   ensure(guildId,`Execute ${command} dentro do servidor da guilda.`);
   const g=await client.guilds.fetch(guildId),actor=await g.members.fetch(i.user.id);
   ensure(g.ownerId===i.user.id||actor.permissions.has(P.Administrator),`Somente o dono ou um administrador do Discord pode executar ${command}.`);
   ensure(pool,'O SBI precisa do banco de dados. Inicie a aplicação com npm start e tente novamente.');
   if(!configuring)ensure(await canConfigureDestination(pool,config,guildId,i.user.id),'Para transferir a guilda para outro servidor, vincule este Discord a uma conta Administrador ou Sub líder no painel central.');
   ensure(!locks.size,'A guilda já está sendo configurada. Aguarde.');locks.add(guildId);locked=true;
   connection=await pool.connect();
   const lock=await connection.query('SELECT pg_try_advisory_lock(735190248) AS locked');dbLock=Boolean(lock.rows[0]?.locked);
   ensure(dbLock,'O SBI já está configurando a guilda em outra instância. Aguarde.');
   // Refresh under the shared lock to stop two different guilds claiming one district.
   const current=await connection.query('SELECT * FROM sbi_district WHERE singleton=TRUE');
   const row=current.rows[0];if(row?.guild_id){config.sbiState={...row.state,guild:row.guild_id};config.sourceGuilds=[...new Set([...(config.sourceGuilds||[]),...(row.source_guilds||[])])];}
   if(configuring){
    ensure(row?.status==='ready'&&row.guild_id===guildId,'Use /criar primeiro neste servidor. /configurar só atende a guilda já configurada e não transfere o servidor.');
    const action=i.options?.getSubcommand();
    ensure(['cargos','permissoes'].includes(action),'Escolha /configurar cargos ou /configurar permissoes.');
    const district={...row.state,id:1,guild:guildId};
    if(action==='cargos'){
     const result=await provisionGuild(g,district,{rolesOnly:true,persist:d=>saveSbiDistrict(pool,config,d,{complete:true})});
     let d=await saveSbiDistrict(pool,config,result.district,{complete:true});saved=true;
     // A replaced access-role ID must also replace old permission overwrites.
     // Persist the pending flag so a Discord permission failure is repaired on retry.
     if(d.permissionRepairPending){await configureGuildPermissions(g,d);delete d.permissionRepairPending;d=await saveSbiDistrict(pool,config,d,{complete:true});}
     const queued=await onRolesConfigured(d);
     await i.editReply({content:`Cargos configurados e IDs salvos. A sincronização automática foi enfileirada${Number.isInteger(queued)?` para ${queued} cadastro(s)`:''}: membros verificados no painel recebem Juramentado e o cargo da patente cadastrada, inclusive os membros sem histórico de tryout. A equipe elegível também recebe Conselho. Reprovações, revogações e prazos vencidos continuam sem acesso; aprovados com cadastro pendente mantêm somente acesso provisório.`,files:[new AttachmentBuilder(Buffer.from(result.inventory),{name:'hriste-boze-cargos.txt'})],allowedMentions:{parse:[]}});
    }else{
     const result=await configureGuildPermissions(g,district);
     await i.editReply({content:`Permissões atualizadas em ${result.count} canais e categorias da guilda. Canais privados individuais de tryout e atendimento foram preservados.${result.missing.length?' Existem recursos ausentes; execute /criar para recriá-los.':''}`,files:[new AttachmentBuilder(Buffer.from(result.inventory),{name:'hriste-boze-permissoes.txt'})],allowedMentions:{parse:[]}});
    }
    return true;
   }
   ensure(await canConfigureDestination(pool,config,guildId,i.user.id),'A guilda pertence a outro servidor. Vincule seu Discord à administração central para transferir.');
   const previous=config.sbiState?.guild===guildId?config.sbiState:config.legacyDistrict?.guild===guildId?config.legacyDistrict:{id:1,guild:guildId};
   const result=await provisionGuild(g,previous,{persist:d=>saveSbiDistrict(pool,config,d)});
   const d=await saveSbiDistrict(pool,config,result.district,{complete:true});saved=true;
   await onConfigured(d);
   await i.editReply({content:'Guilda configurada! O SBI salvou os cargos e canais no banco. Os painéis foram atualizados; novos participantes entram pelo tryout e completam o cadastro obrigatório. Você pode repetir /criar para atualizar a estrutura existente.',files:[new AttachmentBuilder(Buffer.from(result.inventory),{name:'hriste-boze-estrutura.txt'})],allowedMentions:{parse:[]}});
  }catch(e){console.error(`${command}:`,e.code||e.name);await i.editReply({content:(e instanceof ProvisionError?e.message:configuring?`Não foi possível terminar ${command}. Confira as permissões e a hierarquia do bot e repita o comando; o progresso salvo foi preservado.`:saved?'O SBI salvou a estrutura, mas a publicação dos painéis não terminou. Confira as permissões dos canais e repita /criar.':'Não foi possível terminar a configuração. O SBI guardou o progresso; confira as permissões do bot e repita /criar para continuar.').slice(0,1950),allowedMentions:{parse:[]}}).catch(()=>{});}
  finally{if(dbLock)await connection.query('SELECT pg_advisory_unlock(735190248)').catch(()=>{});connection?.release();if(locked)locks.delete(guildId);}
  return true;
 };
}

