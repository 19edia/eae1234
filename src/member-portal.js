import {randomInt,timingSafeEqual} from 'node:crypto';
import {tryoutMemberAccess} from './tryouts.js';
import {accountDiscordProfile} from './account-profile.js';
import {rateLimit} from 'express-rate-limit';
import {hash,passwordHash,passwordMatches,text,token} from './security.js';
import {tx} from './db.js';
import {listMemberEmbedPublications} from './embed-publications.js';

const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const SESSION='ifj_member_session',CHALLENGE='ifj_member_signup';
const cookie=(req,name)=>(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='))?.slice(name.length+1);
const validToken=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const identityValue=value=>{const code=typeof value==='string'?value.trim().replace(/[ -]/g,''):'';if(!/^\d{15,16}$/.test(code))throw fail('Informe seu HB-ID de 16 números.');return code;};
const exposeMember=m=>({id:m.id,idrkc:m.idrkc,name:m.name,game_nick:m.game_nick,roblox_username:m.roblox_username,discord_id:m.discord_id,member_rank:m.member_rank,account_kind:m.account_kind,verified:m.verified,identity_version:m.identity_version,migration_required:m.migration_required,district_migrated_at:m.district_migrated_at,created_at:m.created_at});

export function memberPortalRoutes(app,pool,config,bot){
 const options={httpOnly:true,secure:config.production,sameSite:'strict',path:'/api/member'};
 const limited=(windowMs,limit,message)=>rateLimit({windowMs,limit,standardHeaders:'draft-8',legacyHeaders:false,message:{error:message}});
 let dummyHash;
 const createSession=async(c,accountId)=>{const value=token(),csrf=token();await c.query('DELETE FROM member_sessions WHERE expires_at<=now()');await c.query('INSERT INTO member_sessions(token_hash,account_id,csrf,expires_at) VALUES($1,$2,$3,$4)',[hash(value,config.secret),accountId,csrf,new Date(Date.now()+8*3600000)]);return value;};
 const authenticated=async(req,res,next)=>{
  const value=cookie(req,SESSION);
  if(validToken(value)){
   const result=await pool.query('SELECT s.csrf,s.token_hash,a.id AS account_id,m.* FROM member_sessions s JOIN member_accounts a ON a.id=s.account_id JOIN members m ON m.id=a.member_id AND m.discord_id=a.discord_id WHERE s.token_hash=$1 AND s.expires_at>now() AND a.active=TRUE',[hash(value,config.secret)]);
   if(result.rows[0]){if(!await tryoutMemberAccess(pool,config,result.rows[0]))return res.status(403).json({error:'Acesso suspenso. Conclua o cadastro obrigatório pelo link do tryout aprovado ou solicite um novo tryout.'});req.memberAuth=result.rows[0];return next();}
  }
  return res.status(401).json({error:'Entre na sua conta de membro.'});
 };
 const csrf=(req,res,next)=>req.get('x-csrf-token')===req.memberAuth.csrf?next():res.status(403).json({error:'Sessão inválida. Recarregue a página.'});
 app.post('/api/member/register/start',limited(15*60000,12,'Muitas tentativas de cadastro. Aguarde 15 minutos.'),async(req,res)=>{
  const codeId=identityValue(req.body.idrkc??req.body.ifj),password=text(req.body.password,'Senha',128,12);
  if(!bot.ready()||!bot.sendMemberSignupCode)throw fail('O bot está desconectado. Aguarde para receber o código no Discord.',503);
  const passwordDigest=await passwordHash(password),nonce=token(),code=String(randomInt(100000,1000000)),nonceHash=hash(nonce,config.secret);
  const member=await tx(pool,async c=>{
   const m=(await c.query('SELECT * FROM members WHERE idrkc=$1 OR ifj=$1 FOR UPDATE',[codeId])).rows[0];
   if(!m)throw fail('HB-ID não encontrado. Peça seu cadastro à equipe.',404);
   if(!await tryoutMemberAccess(c,config,m))throw fail('Conclua o cadastro obrigatório pelo link do tryout aprovado. O cadastro por HB-ID não substitui essa etapa.',403);
   if((await c.query('SELECT id FROM member_accounts WHERE member_id=$1 AND discord_id=$2',[m.id,m.discord_id])).rows.length)throw fail('Você já possui uma conta. Use a opção Entrar.',409);
   const prior=(await c.query('SELECT created_at FROM member_signup_challenges WHERE member_id=$1',[m.id])).rows[0];
   if(prior&&Date.now()-new Date(prior.created_at).getTime()<60000)throw fail('Aguarde um minuto antes de pedir outro código.',429);
   await c.query('INSERT INTO member_signup_challenges(member_id,discord_id,token_hash,code_hash,password_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(member_id) DO UPDATE SET discord_id=$2,token_hash=$3,code_hash=$4,password_hash=$5,expires_at=$6,attempts=0,created_at=now()',[m.id,m.discord_id,nonceHash,hash(`${m.id}:${m.discord_id}:${nonce}:${code}`,config.secret),passwordDigest,new Date(Date.now()+10*60000)]);
   return m;
  });
  try{await bot.sendMemberSignupCode(member.discord_id,code,member.name);}catch{
   await pool.query('DELETE FROM member_signup_challenges WHERE token_hash=$1',[nonceHash]);
   throw fail('Não foi possível enviar o código. Permita mensagens privadas do bot e confira com a equipe o Discord vinculado ao seu HB-ID.');
  }
  res.cookie(CHALLENGE,nonce,{...options,maxAge:10*60000}).json({ok:true,message:'Enviamos um código de seis números ao Discord vinculado ao HB-ID. Ele vale por 10 minutos.'});
 });
 app.post('/api/member/register/confirm',limited(15*60000,30,'Muitas tentativas. Aguarde 15 minutos.'),async(req,res)=>{
  const nonce=cookie(req,CHALLENGE);
  if(!validToken(nonce)||typeof req.body.code!=='string'||!/^\d{6}$/.test(req.body.code))throw fail('Informe o código de seis números enviado pelo bot.');
  const result=await tx(pool,async c=>{
   // Lock the member before the challenge, in the same order as registration.
   const m=(await c.query('SELECT m.* FROM members m JOIN member_signup_challenges ch ON ch.member_id=m.id WHERE ch.token_hash=$1 FOR UPDATE OF m',[hash(nonce,config.secret)])).rows[0];
   if(!m)return {error:'Código expirado ou inválido. Comece o cadastro novamente.',status:400};
   if(!await tryoutMemberAccess(c,config,m))throw fail('Conclua o cadastro obrigatório pelo link do tryout aprovado. O cadastro por HB-ID não substitui essa etapa.',403);
   const challenge=(await c.query('SELECT * FROM member_signup_challenges WHERE member_id=$1 FOR UPDATE',[m.id])).rows[0];
   if(!challenge||challenge.token_hash!==hash(nonce,config.secret)||challenge.discord_id!==m.discord_id||new Date(challenge.expires_at).getTime()<=Date.now()||challenge.attempts>=5)return {error:'Código expirado ou bloqueado. Solicite outro código.',status:400};
   const expected=hash(`${m.id}:${m.discord_id}:${nonce}:${req.body.code}`,config.secret);
   if(!timingSafeEqual(Buffer.from(expected),Buffer.from(challenge.code_hash))){await c.query('UPDATE member_signup_challenges SET attempts=attempts+1 WHERE member_id=$1',[m.id]);return {error:'Código incorreto. Confira a mensagem privada do bot.',status:400};}
   if((await c.query('SELECT id FROM member_accounts WHERE member_id=$1 AND discord_id=$2',[m.id,m.discord_id])).rows.length)return {error:'Essa conta já foi cadastrada. Entre com sua senha.',status:409};
   // A Discord change invalidates an old account; only the new owner can replace it.
   await c.query('DELETE FROM member_accounts WHERE member_id=$1',[m.id]);
   const account=(await c.query('INSERT INTO member_accounts(member_id,discord_id,password_hash) VALUES($1,$2,$3) RETURNING id',[m.id,m.discord_id,challenge.password_hash])).rows[0];
   await c.query('DELETE FROM member_signup_challenges WHERE member_id=$1',[m.id]);
   return {value:await createSession(c,account.id)};
  });
  if(result.error)return res.status(result.status).json({error:result.error});
  res.clearCookie(CHALLENGE,options).cookie(SESSION,result.value,{...options,maxAge:8*3600000}).status(201).json({ok:true});
 });
 app.post('/api/member/login',limited(15*60000,15,'Muitas tentativas de acesso. Aguarde 15 minutos.'),async(req,res)=>{
  const codeId=identityValue(req.body.idrkc??req.body.ifj),password=text(req.body.password,'Senha',128);
  const account=(await pool.query('SELECT a.id,a.password_hash,m.id AS member_id FROM member_accounts a JOIN members m ON m.id=a.member_id AND m.discord_id=a.discord_id WHERE (m.idrkc=$1 OR m.ifj=$1) AND a.active=TRUE',[codeId])).rows[0];
  dummyHash ||= await passwordHash(token());
  const valid=await passwordMatches(password,account?.password_hash||dummyHash);
  if(!account||!valid)throw fail('HB-ID ou senha inválidos.',401);
  const identity=(await pool.query('SELECT * FROM members WHERE id=$1',[account.member_id])).rows[0];
  if(!await tryoutMemberAccess(pool,config,identity))throw fail('Acesso suspenso. Conclua o cadastro obrigatório do tryout ou solicite uma nova tentativa.',403);
  const value=await tx(pool,c=>createSession(c,account.id));
  res.cookie(SESSION,value,{...options,maxAge:8*3600000}).json({ok:true});
 });
 app.get('/api/member/me',authenticated,(req,res)=>res.json({member:exposeMember(req.memberAuth),csrf:req.memberAuth.csrf}));
 app.get('/api/member/discord-profile',authenticated,async(req,res)=>res.json({linked:true,profile:await accountDiscordProfile(bot,req.memberAuth.discord_id)}));
 app.post('/api/member/logout',authenticated,csrf,async(req,res)=>{await pool.query('DELETE FROM member_sessions WHERE token_hash=$1',[req.memberAuth.token_hash]);res.clearCookie(SESSION,options).json({ok:true});});
 app.get('/api/member/notices',authenticated,async(_req,res)=>res.json((await pool.query('SELECT id,title,content,pinned,published_at,updated_at FROM official_notices WHERE published=TRUE ORDER BY pinned DESC,published_at DESC,id DESC LIMIT 100')).rows));
 app.get('/api/member/embeds',authenticated,async(_req,res)=>res.json(await listMemberEmbedPublications(pool)));
 app.get('/api/member/services',authenticated,async(req,res)=>{
  const id=req.memberAuth.discord_id;
  const reports=(await pool.query('SELECT id,subject,status,resolution,created_at FROM reports WHERE reporter_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100',[id])).rows;
  const tickets=(await pool.query('SELECT t.id,t.status,t.created_at,t.guild_id,t.channel_id,j.status AS notification_status FROM tickets t LEFT JOIN jobs j ON j.id=t.notification_job_id WHERE t.user_id=$1 ORDER BY t.created_at DESC,t.id DESC LIMIT 100',[id])).rows.map(t=>({id:t.id,status:t.status,created_at:t.created_at,notification_status:t.notification_status,channel_url:t.status==='aberto'&&/^\d{17,20}$/.test(t.guild_id)&&/^\d{17,20}$/.test(t.channel_id)?`https://discord.com/channels/${t.guild_id}/${t.channel_id}`:null}));
  res.json({reports,tickets});
 });
 app.get('/api/member/migration',authenticated,async(req,res)=>res.json({request:(await pool.query('SELECT id,shigaku_name,status,reason,created_at,decided_at FROM district_migration_requests WHERE member_id=$1 AND discord_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1',[req.memberAuth.id,req.memberAuth.discord_id])).rows[0]||null}));
 app.get('/api/member/card.png',authenticated,limited(60000,8,'Aguarde um minuto antes de baixar mais carteiras.'),async(req,res)=>{
  if(!req.memberAuth.verified||req.memberAuth.card_revoked_at)throw fail('Verifique seu HB-ID no Discord para acessar sua carteira.',403);
  const buffer=await (await import('./cards.js')).renderCard(req.memberAuth,config.divisions[0]?.name||'GUILDA HRISTE BOZE');
  res.set('Content-Type','image/png').set('Content-Disposition',`attachment; filename="HRISTE-BOZE-${req.memberAuth.idrkc}-v${req.memberAuth.identity_version}.png"`).send(buffer);
 });
 // Do not let a member endpoint fall through to the staff authentication flow.
 app.use('/api/member',(_req,res)=>res.status(404).json({error:'Página de membro não encontrada.'}));
}
