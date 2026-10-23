import {randomInt,timingSafeEqual} from 'node:crypto';
import {rateLimit} from 'express-rate-limit';
import {allowed,hash,isAdministrator,passwordHash,snowflake,text,token} from './security.js';
import {audit,enqueue,tx} from './db.js';
import {memberData} from './identity.js';
import {createMemberRecord} from './member-store.js';
import {assertTryoutRegistration,completeTryoutRegistration} from './tryouts.js';

const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const TOKEN=/^[a-f0-9]{64}$/;
const CHALLENGE='rkc_registration',SESSION='ifj_member_session';
const CODE_LIFETIME=10*60000,INVITE_LIFETIME=48*3600000;
const cookie=(req,name)=>(req.headers.cookie||'').split(';').map(value=>value.trim()).find(value=>value.startsWith(name+'='))?.slice(name.length+1);
const equal=(a,b)=>TOKEN.test(String(a))&&TOKEN.test(String(b))&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const limited=(windowMs,limit,message)=>rateLimit({windowMs,limit,standardHeaders:'draft-8',legacyHeaders:false,message:{error:message}});
const nonceHash=(id,nonce,secret)=>hash(`registration:${id}:${nonce}`,secret);
const csrfFor=(id,nonce,secret)=>hash(`registration-csrf:${id}:${nonce}`,secret);
const codeHash=(id,nonce,discordId,code,secret)=>hash(`registration-code:${id}:${nonce}:${discordId}:${code}`,secret);
const exposeInvite=row=>({id:row.id,account_kind:row.account_kind,member_rank:row.member_rank,expires_at:row.expires_at,bound_discord_id:row.bound_discord_id||null,tryout_id:row.tryout_id||null});
const exposeMember=m=>({id:m.id,idrkc:m.idrkc,name:m.name,game_nick:m.game_nick,roblox_username:m.roblox_username,discord_id:m.discord_id,member_rank:m.member_rank,account_kind:m.account_kind,verified:m.verified,identity_version:m.identity_version});

function checkCreator(invite){
 if(!invite.creator_active||!allowed(invite.creator_role,'createIFJ'))throw fail('Este convite foi suspenso. Peça um novo link à equipe.',410);
 if(!isAdministrator(invite.creator_role)&&!invite.creator_discord_verified_at)throw fail('A equipe precisa confirmar o Discord antes de liberar este convite.',410);
 if(invite.creator_role==='recrutador'&&invite.member_rank!==(invite.account_kind==='aliado'?'Aliado':'Membro'))throw fail('A autorização deste convite mudou. Peça um novo link à equipe.',410);
}
function checkInvite(invite){
 if(!invite)throw fail('Convite não encontrado. Confira o link recebido.',404);
 if(invite.consumed_at)throw fail('Este convite já foi utilizado. Entre no painel com seu HB-ID e senha.',410);
 if(invite.revoked_at||new Date(invite.expires_at).getTime()<=Date.now())throw fail('Este convite expirou ou foi cancelado. Peça um novo link à equipe.',410);
 checkCreator(invite);
 return invite;
}
async function getInvite(c,raw,secret,{lock=false}={}){
 if(!TOKEN.test(String(raw)))throw fail('Convite inválido. Confira o link recebido.',404);
 const invite=(await c.query('SELECT i.*,s.active AS creator_active,s.role AS creator_role,s.discord_verified_at AS creator_discord_verified_at FROM registration_invites i LEFT JOIN staff s ON s.id=i.created_by WHERE i.token_hash=$1'+(lock?' FOR UPDATE OF i':''),[hash(raw,secret)])).rows[0];
 return checkInvite(invite);
}
function cleanDetails(body,invite){
 const b=memberData({name:body.name,game_nick:body.game_nick,roblox_username:body.roblox_username,allied_gang:body.allied_gang,discord_id:'100000000000000000',division:1,account_kind:invite.account_kind,member_rank:invite.member_rank});
 return {name:b.name,game_nick:b.game_nick,roblox_username:b.roblox_username,allied_gang:b.allied_gang};
}
function profileData(profile){
 if(!profile||profile.bot||!/^\d{17,20}$/.test(String(profile.id))||typeof profile.username!=='string')return null;
 let avatar=null;
 try{const url=new URL(profile.avatar_url);if(url.protocol==='https:'&&['cdn.discordapp.com','media.discordapp.net'].includes(url.hostname))avatar=url.href;}catch{}
 return {id:profile.id,username:profile.username.slice(0,80),display_name:String(profile.display_name||profile.username).slice(0,100),avatar_url:avatar};
}
async function profiles(bot,query){
 if(!bot.ready?.()||!bot.searchRegistrationMembers)throw fail('O bot está desconectado. Aguarde para localizar seu Discord.',503);
 const rows=await bot.searchRegistrationMembers(query);
 if(!Array.isArray(rows))throw fail('Não foi possível consultar os membros do servidor. Tente novamente.',503);
 return rows.map(profileData).filter(Boolean).slice(0,8);
}
async function exactProfile(bot,id){
 const profile=(await profiles(bot,id)).find(row=>row.id===id);
 if(!profile)throw fail('Esse usuário não está no servidor da guilda. Entre no servidor e tente novamente.',404);
 return profile;
}
async function challengeFor(c,invite,req,secret,{lock=false}={}){
 const nonce=cookie(req,CHALLENGE);
 if(!TOKEN.test(String(nonce))||!equal(req.get('x-registration-csrf'),csrfFor(invite.id,nonce,secret)))throw fail('Sessão do convite inválida. Recarregue o link para continuar.',403);
 const digest=nonceHash(invite.id,nonce,secret);
 const row=(await c.query('SELECT * FROM registration_invite_challenges WHERE invite_id=$1 AND nonce_hash=$2'+(lock?' FOR UPDATE':''),[invite.id,digest])).rows[0];
 if(!row)throw fail('Sessão do convite expirada. Recarregue o link para continuar.',403);
 return {...row,nonce};
}

export function registrationInviteStaffRoutes(app,pool,config,permit){
 const authorize=permit?permit('createIFJ'):(req,res,next)=>req.auth&&allowed(req.auth.role,'createIFJ')?next():res.status(403).json({error:'Sua patente não permite gerar convites.'});
 app.get('/api/registration-invites',authorize,async(req,res)=>{
  const scope=isAdministrator(req.auth.role)?'':' WHERE i.created_by=$1';
  const rows=(await pool.query('SELECT i.id,i.account_kind,i.member_rank,i.created_at,i.expires_at,i.consumed_at,i.revoked_at,i.member_id,m.name AS member_name,m.idrkc FROM registration_invites i LEFT JOIN members m ON m.id=i.member_id'+scope+' ORDER BY i.created_at DESC,i.id DESC LIMIT 100',scope?[req.auth.staff_id]:[])).rows;
  res.json(rows);
 });
 app.post('/api/registration-invites',authorize,limited(60000,20,'Muitos convites criados. Aguarde um minuto.'),async(req,res)=>{
  if(!config.divisions.some(d=>/^\d{17,20}$/.test(String(d.guild))))throw fail('Configure a guilda com /criar antes de gerar convites.',409);
  const kind=req.body.account_kind??'membro';
  if(!['membro','aliado'].includes(kind))throw fail('Tipo de cadastro inválido.');
  const raw=token(),expires=new Date(Date.now()+INVITE_LIFETIME);
  const invite=await tx(pool,async c=>{
   const creator=(await c.query('SELECT role,active,discord_verified_at FROM staff WHERE id=$1 FOR SHARE',[req.auth.staff_id])).rows[0];
   if(!creator?.active||!allowed(creator.role,'createIFJ')||(!isAdministrator(creator.role)&&!creator.discord_verified_at))throw fail('Sua autorização mudou. Entre novamente e confirme seu Discord.',403);
   const rank=creator.role==='recrutador'?(kind==='aliado'?'Aliado':'Membro'):text(req.body.member_rank??(kind==='aliado'?'Aliado':'Membro'),'Patente',80);
   if(/[\u0000-\u001f\u007f]/.test(rank))throw fail('Patente inválida.');
   const row=(await c.query('INSERT INTO registration_invites(token_hash,created_by,account_kind,member_rank,expires_at) VALUES($1,$2,$3,$4,$5) RETURNING *',[hash(raw,config.secret),req.auth.staff_id,kind,rank,expires])).rows[0];
   await audit(c,req.auth.staff_id,'Convite de cadastro criado',{inviteId:row.id,account_kind:kind,member_rank:rank});
   return row;
  });
  res.status(201).json({...exposeInvite(invite),url:new URL('/cadastro/'+raw,config.origin).href});
 });
 app.delete('/api/registration-invites/:id',authorize,async(req,res)=>{
  if(!/^\d+$/.test(req.params.id))throw fail('Convite não encontrado.',404);
  await tx(pool,async c=>{
   const invite=(await c.query('SELECT * FROM registration_invites WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0];
   if(!invite||(!isAdministrator(req.auth.role)&&invite.created_by!==req.auth.staff_id))throw fail('Convite não encontrado.',404);
   if(invite.consumed_at)throw fail('O cadastro já foi concluído. Gerencie a identidade na lista de membros.',409);
   await c.query('UPDATE registration_invites SET revoked_at=now() WHERE id=$1',[invite.id]);
   await c.query('DELETE FROM registration_invite_challenges WHERE invite_id=$1',[invite.id]);
   await audit(c,req.auth.staff_id,'Convite de cadastro cancelado',{inviteId:invite.id});
  });
  res.json({ok:true});
 });
}

export function registrationInvitePublicRoutes(app,pool,config,bot){
 const challengeCookie={httpOnly:true,secure:config.production,sameSite:'strict',path:'/api/registration',maxAge:INVITE_LIFETIME};
 const sessionCookie={httpOnly:true,secure:config.production,sameSite:'strict',path:'/api/member',maxAge:8*3600000};
 // These endpoints are mounted before staff authentication. Origin and the browser
 // challenge are checked here as well so this module stays safe when reused.
 app.use('/api/registration',(req,res,next)=>{
  res.set('Cache-Control','no-store');
  if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.get('origin')!==config.origin)return res.status(403).json({error:'Origem não autorizada.'});
  next();
 });
 app.get('/api/registration/:token',limited(15*60000,60,'Muitas consultas de convite. Aguarde 15 minutos.'),async(req,res)=>{
  const invite=await getInvite(pool,req.params.token,config.secret);
  const previous=cookie(req,CHALLENGE),nonce=TOKEN.test(String(previous))?previous:token();
  await pool.query('INSERT INTO registration_invite_challenges(invite_id,nonce_hash) VALUES($1,$2) ON CONFLICT DO NOTHING',[invite.id,nonceHash(invite.id,nonce,config.secret)]);
  const row=(await pool.query('SELECT details,discord_profile,code_hash,code_expires_at FROM registration_invite_challenges WHERE invite_id=$1 AND nonce_hash=$2',[invite.id,nonceHash(invite.id,nonce,config.secret)])).rows[0];
  res.cookie(CHALLENGE,nonce,challengeCookie).json({invite:exposeInvite(invite),csrf:csrfFor(invite.id,nonce,config.secret),details:row.details,discord:row.discord_profile,verification:{code_sent:!!row.code_hash&&new Date(row.code_expires_at).getTime()>Date.now(),expires_at:row.code_expires_at}});
 });
 app.post('/api/registration/:token/draft',limited(15*60000,40,'Muitas alterações. Aguarde 15 minutos.'),async(req,res)=>{
  const result=await tx(pool,async c=>{
   const invite=await getInvite(c,req.params.token,config.secret,{lock:true});
   const challenge=await challengeFor(c,invite,req,config.secret,{lock:true});
   const details=cleanDetails(req.body,invite);
   await c.query('UPDATE registration_invite_challenges SET details=$1,discord_id=NULL,discord_profile=NULL,code_hash=NULL,attempts=0,code_expires_at=NULL WHERE invite_id=$2 AND nonce_hash=$3',[JSON.stringify(details),invite.id,challenge.nonce_hash]);
   return details;
  });
  res.json({ok:true,details:result});
 });
 app.post('/api/registration/:token/discord/search',limited(60000,12,'Muitas buscas. Aguarde um minuto.'),async(req,res)=>{
  const invite=await getInvite(pool,req.params.token,config.secret);
  const challenge=await challengeFor(pool,invite,req,config.secret);
  if(!challenge.details)throw fail('Preencha seus dados antes de procurar seu Discord.');
  const query=text(req.body.query,'Usuário do Discord',80,2).replace(/^@/,'');
  res.json({members:await profiles(bot,invite.bound_discord_id||query)});
 });
 app.post('/api/registration/:token/discord/start',limited(15*60000,10,'Muitas tentativas de confirmação. Aguarde 15 minutos.'),async(req,res)=>{
  const invite=await getInvite(pool,req.params.token,config.secret);
  await challengeFor(pool,invite,req,config.secret);
  const discordId=snowflake(req.body.discord_id),profile=await exactProfile(bot,discordId);
  if(invite.bound_discord_id&&invite.bound_discord_id!==discordId)throw fail('Este convite pertence ao participante aprovado no tryout.',403);
  if(!bot.sendMemberSignupCode)throw fail('O envio de códigos está indisponível. Aguarde o bot.',503);
  const code=String(randomInt(100000,1000000)),expires=new Date(Date.now()+CODE_LIFETIME);
  const challenge=await tx(pool,async c=>{
   const current=await getInvite(c,req.params.token,config.secret,{lock:true});
   await assertTryoutRegistration(c,current,discordId,config);
   const ch=await challengeFor(c,current,req,config.secret,{lock:true});
   if(!ch.details)throw fail('Preencha seus dados antes de confirmar seu Discord.');
   await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['registration-discord:'+discordId]);
   if(!current.tryout_id&&(await c.query('SELECT id FROM members WHERE discord_id=$1',[discordId])).rowCount)throw fail('Esse Discord já possui um HB-ID. Use o acesso de membros ou fale com a equipe.',409);
   if(ch.details.roblox_username&&(await c.query('SELECT id FROM members WHERE lower(roblox_username)=lower($1) AND discord_id<>$2',[ch.details.roblox_username,discordId])).rowCount)throw fail('Esse usuário Roblox já possui um HB-ID. Confira seus dados ou fale com a equipe.',409);
   const recent=(await c.query("SELECT 1 FROM registration_invite_challenges WHERE (invite_id=$1 OR discord_id=$2) AND code_sent_at>now()-interval '60 seconds' LIMIT 1",[current.id,discordId])).rowCount;
   if(recent)throw fail('Aguarde um minuto antes de solicitar outro código.',429);
   const digest=codeHash(current.id,ch.nonce,discordId,code,config.secret);
   await c.query('UPDATE registration_invite_challenges SET discord_id=$1,discord_profile=$2,code_hash=$3,attempts=0,code_expires_at=$4,code_sent_at=now() WHERE invite_id=$5 AND nonce_hash=$6',[discordId,JSON.stringify(profile),digest,expires,current.id,ch.nonce_hash]);
   return {...ch,code_hash:digest};
  });
  try{await bot.sendMemberSignupCode(discordId,code,challenge.details.name);}
  catch{
   await pool.query('UPDATE registration_invite_challenges SET code_hash=NULL,code_expires_at=NULL WHERE invite_id=$1 AND nonce_hash=$2 AND code_hash=$3',[invite.id,challenge.nonce_hash,challenge.code_hash]);
   throw fail('Não foi possível enviar o código. Ative as mensagens privadas do servidor e tente novamente em um minuto.');
  }
  res.json({ok:true,discord:profile,expires_at:expires,message:'Enviamos um código de seis números no seu Discord. Ele vale por 10 minutos.'});
 });
 app.post('/api/registration/:token/complete',limited(15*60000,30,'Muitas tentativas de cadastro. Aguarde 15 minutos.'),async(req,res)=>{
  const code=req.body.code;
  if(typeof code!=='string'||!/^\d{6}$/.test(code))throw fail('Informe o código de seis números enviado no seu Discord.');
  const password=text(req.body.password,'Senha',128,12);
  const initial=await getInvite(pool,req.params.token,config.secret);
  const initialChallenge=await challengeFor(pool,initial,req,config.secret);
  if(!initialChallenge.discord_id||!initialChallenge.code_hash)throw fail('Solicite o código de confirmação antes de concluir o cadastro.');
  const profile=await exactProfile(bot,initialChallenge.discord_id);
  const digest=await passwordHash(password);
  let result;
  try{result=await tx(pool,async c=>{
   const invite=await getInvite(c,req.params.token,config.secret,{lock:true});
   // Prevent a simultaneous staff permission change from authorizing creation.
   const creator=(await c.query('SELECT active AS creator_active,role AS creator_role,discord_verified_at AS creator_discord_verified_at FROM staff WHERE id=$1 FOR SHARE',[invite.created_by])).rows[0];
   if(!creator)throw fail('A equipe cancelou a autorização deste convite.',410);
   checkCreator({...invite,...creator});
   const challenge=await challengeFor(c,invite,req,config.secret,{lock:true});
   await assertTryoutRegistration(c,invite,challenge.discord_id,config);
   if(!challenge.details||!challenge.code_hash||challenge.discord_id!==profile.id||new Date(challenge.code_expires_at).getTime()<=Date.now()||challenge.attempts>=5)return {error:'Código expirado ou bloqueado. Solicite um novo código.',status:400};
   const expected=codeHash(invite.id,challenge.nonce,challenge.discord_id,code,config.secret);
   if(!equal(expected,challenge.code_hash)){
    await c.query('UPDATE registration_invite_challenges SET attempts=attempts+1 WHERE invite_id=$1 AND nonce_hash=$2',[invite.id,challenge.nonce_hash]);
    return {error:'Código incorreto. Confira a mensagem privada do bot.',status:400};
   }
   await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['registration-discord:'+challenge.discord_id]);
   const existing=(await c.query('SELECT * FROM members WHERE discord_id=$1 FOR UPDATE',[challenge.discord_id])).rows[0];
   if(existing&&!invite.tryout_id)throw fail('Esse Discord já possui um HB-ID. Entre no painel dos membros.',409);
   const b=memberData({...challenge.details,discord_id:challenge.discord_id,division:1,account_kind:invite.account_kind,member_rank:invite.member_rank});
   let member=existing||await createMemberRecord(c,b,invite.created_by);
   if(existing){
    member=(await c.query("UPDATE members SET name=$1,game_nick=$2,roblox_username=$3,account_kind='membro',allied_gang=NULL,member_rank='Membro',division=1,identity_version=identity_version+1,card_revoked_at=NULL,updated_at=now() WHERE id=$4 RETURNING *",[b.name,b.game_nick,b.roblox_username,existing.id])).rows[0];
    await c.query('DELETE FROM member_sessions WHERE account_id IN (SELECT id FROM member_accounts WHERE member_id=$1)',[member.id]);
   }
   await completeTryoutRegistration(c,invite,member,config);
   member=(await c.query('UPDATE members SET verified=TRUE,discord_username=$1,migration_required=FALSE,district_migrated_at=now(),updated_at=now() WHERE id=$2 RETURNING *',[profile.username,member.id])).rows[0];
   const account=(await c.query('INSERT INTO member_accounts(member_id,discord_id,password_hash) VALUES($1,$2,$3) ON CONFLICT(member_id) DO UPDATE SET discord_id=excluded.discord_id,password_hash=excluded.password_hash,active=TRUE RETURNING id',[member.id,member.discord_id,digest])).rows[0];
   const session=token(),csrf=token();
   await c.query('DELETE FROM member_sessions WHERE expires_at<=now()');
   await c.query('INSERT INTO member_sessions(token_hash,account_id,csrf,expires_at) VALUES($1,$2,$3,$4)',[hash(session,config.secret),account.id,csrf,new Date(Date.now()+8*3600000)]);
   await c.query('UPDATE registration_invites SET consumed_at=now(),member_id=$1 WHERE id=$2',[member.id,invite.id]);
   await c.query('DELETE FROM registration_invite_challenges WHERE invite_id=$1',[invite.id]);
   await enqueue(c,'sync-role',{discordId:member.discord_id});
   for(const district of config.divisions){
    const delivery=(await c.query('INSERT INTO idrkc_deliveries(member_id,discord_id,guild_id,identity_version) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id',[member.id,member.discord_id,district.guild,member.identity_version])).rows[0];
    if(delivery){const jobId=await enqueue(c,'idrkc-delivery',{deliveryId:delivery.id});await c.query('UPDATE idrkc_deliveries SET job_id=$1 WHERE id=$2',[jobId,delivery.id]);}
   }
   await audit(c,invite.created_by,'Cadastro por convite concluído',{inviteId:invite.id,memberId:member.id,idrkc:member.idrkc});
   return {member:exposeMember(member),session};
  });}catch(error){
   if(error.code==='23505')throw fail('O Discord ou usuário Roblox já possui um cadastro. Entre no painel ou fale com a equipe.',409);
   throw error;
  }
  if(result.error)return res.status(result.status).json({error:result.error});
  res.clearCookie(CHALLENGE,challengeCookie).cookie(SESSION,result.session,sessionCookie).status(201).json({member:result.member,redirect:'/membros',card_url:'/api/member/card.png'});
 });
 app.use('/api/registration',(_req,res)=>res.status(404).json({error:'Página de cadastro não encontrada.'}));
}

