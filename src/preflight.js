import {access,readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {passwordHash,passwordMatches,allowed,generateIFJ} from './security.js';
import {readConfig,ConfigurationError} from './config.js';
import {createStartupGate} from './startup-http.js';
import {setTimeout as delay} from 'node:timers/promises';
import {loadSbiConfig} from './sbi.js';
export class StartupError extends Error{constructor(message){super(message);this.name='StartupError';}}
export function safeFailure(error){
 if(error instanceof StartupError||error instanceof ConfigurationError)return error.message;
 const known={'ALLY_CONFIG':'Confira OLD_ALLY_ROLE_ID no servidor antigo e os convites das divisões.','DisallowedIntents':'Discord: ative Server Members Intent em Developer Portal → Bot.','4014':'Discord: ative Server Members Intent em Developer Portal → Bot.','28P01':'Banco: usuário/senha inválidos. Confira DATABASE_URL.','3D000':'Banco de dados não encontrado.','42501':'Banco: sem permissão para esquema/tabelas.','42P01':'Banco: tabela obrigatória ausente.','42703':'Banco: coluna obrigatória ausente.','ENOTFOUND':'Host não encontrado. Confira o endereço e o DNS.','ECONNREFUSED':'Conexão recusada pelo serviço.','ETIMEDOUT':'Tempo limite de conexão excedido.','ENETUNREACH':'Rede indisponível; confira o Session pooler IPv4.','DEPTH_ZERO_SELF_SIGNED_CERT':'Certificado TLS não confiável; configure a CA oficial.','SELF_SIGNED_CERT_IN_CHAIN':'Cadeia TLS não confiável; configure a CA oficial.','UNABLE_TO_VERIFY_LEAF_SIGNATURE':'Não foi possível validar o certificado TLS.','ENOENT':'Arquivo obrigatório ou certificado não encontrado.','EADDRINUSE':'A porta já está em uso.','TokenInvalid':'Token Discord inválido.','50001':'Discord: sem acesso ao servidor/canal.','50013':'Discord: faltam permissões.','10003':'Discord: canal não encontrado.','10004':'Discord: servidor não encontrado.'};
 return known[String(error?.code)]||'Falha no teste. Confira a conexão, os arquivos e as permissões da etapa indicada; detalhes sensíveis foram omitidos.';
}
export function reporter(write=line=>console.log(line)){
 return {line:(status,label)=>write(`[INICIALIZAÇÃO][${status}] ${label}`),async test(label,fn){write(`[INICIALIZAÇÃO][TESTANDO] ${label}`);try{const result=await fn();write(`[INICIALIZAÇÃO][OK] ${label}`);return result;}catch(e){write(`[INICIALIZAÇÃO][ERRO] ${label}: ${safeFailure(e)}`);throw e;}}};
}
export async function systemChecks(){
 const [major,minor]=process.versions.node.split('.').map(Number);if(major<22||(major===22&&minor<12))throw new StartupError('Use Node.js 22.12 ou superior.');
 for(const file of ['../public/index.html','../public/panel.html','../public/app.js','../public/login.js','../public/panel.css','../public/login.css','../public/member.html','../public/member.js','../public/member.css','./schema.sql','./district-schema.sql','./sbi-schema.sql','./member-portal-schema.sql','./idrkc-schema.sql','./verified-services-schema.sql','./embed-publications-schema.sql','./registration-invites-schema.sql','./card-login-schema.sql','./card-login.js','./card-verification.js','../public/registration.html','../public/registration.js','../public/registration.css','../public/kage-brand.css','../public/admin-theme.css','../public/member-theme.css','../public/access-theme.css','../public/studio-theme.css','../public/deepwoken-guild-art.svg','../public/tryout.html','../public/tryout.js','../public/tryout.css','./tryouts.js','./tryouts-schema.sql'])await access(new URL(file,import.meta.url));
 for(const file of ['./account-profile.js','./discord-profiles.js','../public/discord-profile.js'])await access(new URL(file,import.meta.url));
 const pass=randomBytes(24).toString('hex'),encrypted=await passwordHash(pass);
 if(!await passwordMatches(pass,encrypted)||await passwordMatches(pass+'x',encrypted))throw new StartupError('O autoteste de proteção de senhas falhou.');
 for(const [role,op,result]of [['admin','admin',true],['moderador','admin',false],['recrutador','deleteIFJ',true],['recrutador','editIFJ',true],['recrutador','warn',false],['moderador','warn',true],['moderador','deleteIFJ',true],['recrutador','createIFJ',true]])if(allowed(role,op)!==result)throw new StartupError('O autoteste de permissões falhou.');
 const {renderCard}=await import('./cards.js');const png=await renderCard({id:0,name:'Autoteste',account_kind:'membro',member_rank:'Membro',game_nick:'Teste',roblox_username:'Teste',discord_id:'10000000000000000',ifj:'000000000000000',idrkc:'1042000000000042',card_secret:'be3dc854-77cc-4a62-856f-0493f58e84a5',created_at:new Date(),identity_version:1},'Teste');if(png.subarray(1,4).toString()!=='PNG')throw new StartupError('O autoteste de geração PNG falhou.');
 if(!/^\d{15}$/.test(generateIFJ()))throw new StartupError('O autoteste de geração de IFJ falhou.');
}
export async function checkCertificate(config){const cert=new URL(config.database).searchParams.get('sslrootcert');if(cert){const pem=await readFile(cert,'utf8');if(!pem.includes('-----BEGIN CERTIFICATE-----'))throw new StartupError('O arquivo sslrootcert não contém certificado PEM válido.');}}
const columns={tryout_sessions:'id,guild_id,game_id,participant_id,evaluator_id,status,damage_percent,threshold,registration_deadline,registration_invite_id,member_id',tryout_legacy_members:'member_id,discord_id,guild_id',card_login_sessions:'token_hash,created_at,expires_at,last_upload_at,consumed_at',card_login_challenges:'token_hash,member_id,discord_id,identity_version,proof_hash,code_hash,attempts,sent_at,expires_at',registration_invites:'id,token_hash,created_by,account_kind,member_rank,expires_at,consumed_at,revoked_at,member_id',registration_invite_challenges:'invite_id,nonce_hash,details,discord_id,code_hash,attempts,code_expires_at',ally_imports:'id,source_guild,source_role,discord_id,username,display_name,actor_id,status,member_id,notification_job_id',immigration_notices:'guild_id,channel_id,message_id,deadline,created_at',warnings:'id,interaction_id,guild_id,division,discord_id,actor_id,reason,notification_job_id,created_at',staff:'id,username,password_hash,role,active,discord_id,discord_verified_at',staff_discord_challenges:'staff_id,discord_id,code_hash,attempts,created_at,expires_at',sessions:'token_hash,staff_id,csrf,expires_at',members:'id,ifj,idrkc,card_secret,card_revoked_at,name,game_nick,roblox_username,discord_id,division,verified,suspect,account_kind,allied_gang,member_rank,identity_version,updated_at,auto_allied,discord_username',used_ifjs:'digest',confirmations:'token,member_id,discord_id,guild_id,expires_at,member_version,card_proof_hash',reports:'id,member_id,subject,reporter_id,division,reason,status,resolution,reviewed_by,notification_job_id',immigrations:'id,discord_id,guild_id,game_nick,discord_name,status,reason,reviewed_by,member_id,notification_job_id,created_at,decided_at',tickets:'id,guild_id,user_id,channel_id,status,closed_by',jobs:'id,kind,payload,status,attempts,error,next_at,message_id,dedupe_key',panels:'channel_id,message_id',audit:'id,actor,action,detail',used_idrkcs:'idrkc',idrkc_deliveries:'id,member_id,discord_id,guild_id,identity_version,status,job_id,message_id',service_deliveries:'job_id,recipient_id,message_id',embed_publications:'id,payload,guild_id,channel_id,message_id,job_id,published_at',member_accounts:'id,member_id,discord_id,password_hash,active',member_sessions:'token_hash,account_id,csrf,expires_at'};
export async function checkDatabase(pool){
 for(const [table,fields]of Object.entries(columns))await pool.query(`SELECT ${fields} FROM ${table} LIMIT 0`);
 const admin=await pool.query("SELECT id FROM staff WHERE active=TRUE AND role='admin' LIMIT 1");if(!admin.rowCount)throw new StartupError('Não há administrador ativo no banco. Restaure o acesso administrativo antes de iniciar.');
 const c=await pool.connect();try{await c.query('BEGIN');const r=await c.query("INSERT INTO audit(actor,action) VALUES('preflight','autoteste temporário') RETURNING id");await c.query("UPDATE audit SET detail=$1 WHERE id=$2",['{"tested":true}',r.rows[0].id]);await c.query('DELETE FROM audit WHERE id=$1',[r.rows[0].id]);await c.query('ROLLBACK');}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
}
// Render gets a status port immediately. Application routes and the queue are
// enabled only after database, SBI and Discord checks complete.
export async function boot({env=process.env,makePool,initialize,makeBot,makeApp,listen,log=reporter(),checks={},signal}){
 let pool,bot,server;
 try{
  log.line('TESTANDO','Variáveis de ambiente (valores secretos ocultos)');
  const config=readConfig(env,c=>log.line(!c.ok?'ERRO':c.skip?'DISPENSADO':'OK',`${c.key}${c.ok?'':`: ${c.message}`}`));
  const gate=createStartupGate();
  server=await log.test('Abrir porta de inicialização HTTP',()=>listen(gate.handler,config.port));
  await log.test('Sistema: Node, arquivos, senhas, patentes, HB-ID e PNG',checks.system||systemChecks);
  await log.test('Certificado TLS configurado',()=>checkCertificate(config));
  pool=makePool(config.database);
  await log.test('Banco: conexão PostgreSQL',()=>pool.query('SELECT 1'));
  await log.test('Banco: estrutura e administrador inicial',()=>initialize(pool,env));
  await log.test('SBI: carregar distrito e recursos salvos',()=> (checks.sbi||loadSbiConfig)(pool,config));
  await log.test('Banco: tabelas, leitura e escrita com rollback',()=> (checks.database||checkDatabase)(pool));
  bot=makeBot(pool,config);
  if(config.botEnabled){
   for(;;){
    try{await log.test('Discord: autenticação e conexão Gateway',()=>bot.start({signal}));break;}
    catch(e){if(e.code!=='DISCORD_RATE_LIMITED'||!Number.isFinite(e.retryAfterMs)||e.retryAfterMs<=0)throw e;
     await bot.stop();const until=Date.now()+e.retryAfterMs;
     gate.wait(until,()=>pool.query({text:'SELECT 1',query_timeout:3000}));
     log.line('AGUARDANDO',`Discord solicitou uma pausa de ${Math.ceil(e.retryAfterMs/1000)} segundos. Nova tentativa automática após o prazo.`);
     while(Date.now()<until)await delay(Math.min(60000,until-Date.now()),undefined,{signal});
     signal?.throwIfAborted();gate.resume();bot=makeBot(pool,config);
    }
   }
   await log.test('Discord: servidores, cargos, canais e permissões',()=>bot.validate(log));
  }else log.line('DISPENSADO','Discord desativado explicitamente por BOT_ENABLED=false. Apenas o painel será iniciado.');
  const app=makeApp(pool,config,bot);
  signal?.throwIfAborted();
  if(config.botEnabled)bot.activate();
  gate.activate(app);
  log.line('PRONTO','Todos os testes obrigatórios passaram. Servidor iniciado.');
  return {server,pool,bot,config};
 }catch(e){
  log.line('BLOQUEADO',`${safeFailure(e)} Servidor NÃO iniciado; encerrando com código 1.`);
  if(server)await new Promise(resolve=>server.close(resolve));
  if(bot)await bot.stop().catch(()=>{});
  if(pool)await pool.end().catch(()=>{});
  throw e;
 }
}
