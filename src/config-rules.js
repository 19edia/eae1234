export const ROLE_ENV={"leader": "LEADER_ROLE_ID", "subleader": "SUBLEADER_ROLE_ID", "high": "HIGH_MEMBER_ROLE_ID", "moderator": "MODERATOR_ROLE_ID", "recruiter": "RECRUITER_ROLE_ID", "ally": "ALLY_ROLE_ID", "veteran": "VETERAN_ROLE_ID", "rookie": "ROOKIE_ROLE_ID", "pvp": "PVP_ROLE_ID", "pve": "PVE_ROLE_ID", "builder": "BUILDER_ROLE_ID", "navigator": "NAVIGATOR_ROLE_ID"};
// Shared by the server and the offline assistant. Never returns secret values in diagnostics.
export const ID_FIELDS=['GUILD_ID','MEMBER_ROLE_ID','ADMIN_ROLE_ID','VERIFICATION_CHANNEL_ID','WELCOME_CHANNEL_ID','GUIDE_CHANNEL_ID','WANTED_CHANNEL_ID','TICKETS_CHANNEL_ID','REPORTS_CHANNEL_ID','TICKET_CATEGORY_ID',...Object.values(ROLE_ENV)];
export const looksPlaceholder=value=>/PREENCHA|SUBSTITUA|YOUR.PASSWORD|TOKEN_DO_BOT|HOST_COPIADO|SENHA_CODIFICADA/i.test(value);
export function validateEnvironment(env){
 const checks=[];
 const add=(key,ok,message,skip=false)=>checks.push({key,ok,message:ok?'Formato válido.':message,skip});
 const get=k=>typeof env[k]==='string'?env[k]:'';
 const plain=(key,min=1)=>{const v=get(key);const ok=v.length>=min&&!/[\r\n\0]/.test(v)&&v===v.trim()&&!looksPlaceholder(v);add(key,ok,`Preencha um valor real, sem espaços nas pontas, com pelo menos ${min} caracteres.`);return ok;};
 add('NODE_ENV',['production','development','test'].includes(get('NODE_ENV')),'Use production, development ou test.');
 const version=get('NODE_VERSION');if(version)add('NODE_VERSION',/^(22|24|26)(\.\d+){0,2}$/.test(version),'Use a série 22, 24 ou 26; o runtime também será testado.');else add('NODE_VERSION',true,'',true);
 const mode=get('BOT_ENABLED')||'true';add('BOT_ENABLED',['true','false'].includes(mode),'Use somente true ou false.');
 const port=get('PORT')||'3000';add('PORT',/^\d+$/.test(port)&&Number(port)>0&&Number(port)<=65535,'Use uma porta de 1 a 65535; no Render deixe a plataforma fornecer.');
 let originOK=false;
 try{const u=new URL(get('APP_ORIGIN'));originOK=['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/'&&u.hostname!=='configurar.invalid'&&!u.hostname.endsWith('.invalid')&&(!['production'].includes(get('NODE_ENV'))||u.protocol==='https:')&&!looksPlaceholder(u.hostname)&&[u.origin,u.origin+'/'].includes(get('APP_ORIGIN'));}catch{}
 add('APP_ORIGIN',originOK,'Informe a URL real do painel, sem caminho, consulta ou credenciais. Produção exige HTTPS.');
 let dbOK=false;
 try{const u=new URL(get('DATABASE_URL'));dbOK=['postgres:','postgresql:'].includes(u.protocol)&&Boolean(u.hostname&&u.username&&u.password&&u.pathname.length>1)&&!u.hash&&!looksPlaceholder(get('DATABASE_URL'))&&!/[\[\]\s]/.test(get('DATABASE_URL'))&&u.hostname!=='host'&&u.username!=='USER'&&u.password!=='PASSWORD'&&(!get('NODE_ENV').includes('production')||u.searchParams.get('sslmode')==='verify-full');}catch{}
 add('DATABASE_URL',dbOK,'Use uma URL PostgreSQL real, com usuário, senha codificada e banco. Em produção inclua sslmode=verify-full.');
 plain('SESSION_SECRET',32);
 const evaluator=get('TRYOUT_EVALUATOR_DISCORD_ID');
 if(evaluator)add('TRYOUT_EVALUATOR_DISCORD_ID',/^\d{17,20}$/.test(evaluator),'Informe o ID numérico do avaliador no Discord.');
 const pass=get('TRYOUT_PASS_PERCENT');
 if(pass)add('TRYOUT_PASS_PERCENT',/^(?:\d{1,3})(?:\.\d{1,2})?$/.test(pass)&&Number(pass)>=0&&Number(pass)<=100,'Use uma porcentagem de 0 a 100.');
 const hours=get('TRYOUT_REGISTRATION_HOURS');
 if(hours)add('TRYOUT_REGISTRATION_HOURS',/^\d+$/.test(hours)&&Number(hours)>=1&&Number(hours)<=720,'Use um prazo de cadastro entre 1 e 720 horas.');
 const user=get('INITIAL_ADMIN_USERNAME'),pw=get('INITIAL_ADMIN_PASSWORD');
 if(user||pw){add('INITIAL_ADMIN_USERNAME',/^[a-z0-9_.-]{3,64}$/.test(user)&&!looksPlaceholder(user),'Use 3 a 64 letras minúsculas, números, ponto, hífen ou sublinhado.');plain('INITIAL_ADMIN_PASSWORD',12);add('INITIAL_ADMIN_PASSWORD_LIMIT',pw.length<=128,'A senha inicial pode ter até 128 caracteres.');}
 else add('INITIAL_ADMIN_*',true,'',true);
 if(mode==='true'){
  const token=get('DISCORD_TOKEN');add('DISCORD_TOKEN',token.length>=30&&!/\s/.test(token)&&!looksPlaceholder(token),'Informe o token real do bot (não Application ID). A validade será testada no Discord.');
 }else add('DISCORD_TOKEN',true,'',true);
 // SBI discovers and persists Discord IDs. Legacy district 1 IDs are optional
 // hints for reusing existing resources; district 2 is retained only as a source.
 for(const suffix of [...ID_FIELDS,'STAFF_CHANNEL_ID','ALLIANCE_CHANNEL_ID']){
  const key=`DIV_1_${suffix}`,v=get(key);
  if(!v){add(key,true,'',true);continue;}
  add(key,/^\d{17,20}$/.test(v),'Copie um ID Discord numérico de 17 a 20 dígitos ou remova a variável antiga para usar o SBI.');
 }
 const invite=get('DIV_1_INVITE_URL');
 if(invite)add('DIV_1_INVITE_URL',/^https:\/\/(discord\.gg\/[A-Za-z0-9-]+|discord\.com\/invite\/[A-Za-z0-9-]+)$/.test(invite),'Informe um convite HTTPS válido do Discord.');
 const inviteKey=get('ALLIANCE_INVITE_URL')?'ALLIANCE_INVITE_URL':get('RYUKETSU_INVITE_URL')?'RYUKETSU_INVITE_URL':'HYDRA_INVITE_URL',allyInvite=get(inviteKey);
 if(allyInvite)add(inviteKey,/^https:\/\/(discord\.gg\/[A-Za-z0-9-]+|discord\.com\/invite\/[A-Za-z0-9-]+)$/.test(allyInvite),'Informe o convite HTTPS da guilda parceira.');
 else add(inviteKey,true,'',true);
 return checks;
}
