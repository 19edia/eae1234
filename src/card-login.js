import express from 'express';
import {randomInt,timingSafeEqual} from 'node:crypto';
import {rateLimit} from 'express-rate-limit';
import {decodeCardBarcode,inspectCardImage,MAX_CARD_IMAGE_BYTES} from './barcode.js';
import {buildCardPayload,parseCardPayload,verifyCardPayload} from './idrkc.js';
import {hash,passwordHash,text,token} from './security.js';
import {tx} from './db.js';
import {tryoutMemberAccess} from './tryouts.js';

const SESSION_COOKIE='rkc_card_login';
const MEMBER_COOKIE='ifj_member_session';
const DURATION=10*60000;
const TOKEN=/^[a-f0-9]{64}$/;
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const cookie=(req,name)=>(req.headers.cookie||'').split(';').map(part=>part.trim()).find(part=>part.startsWith(name+'='))?.slice(name.length+1);
const equal=(a,b)=>TOKEN.test(String(a))&&TOKEN.test(String(b))&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const csrfFor=(value,secret)=>hash('card-login-csrf:'+value,secret);
const sessionHash=(value,secret)=>hash('card-login-session:'+value,secret);
const proofHash=(value,secret)=>hash('card-login-proof:'+value,secret);
const codeHash=(nonce,memberId,discordId,code,secret)=>hash(`card-login-code:${nonce}:${memberId}:${discordId}:${code}`,secret);
const limited=(windowMs,limit,message)=>rateLimit({windowMs,limit,standardHeaders:'draft-8',legacyHeaders:false,message:{error:message}});
const safeMember=m=>({id:m.id,idrkc:m.idrkc,name:m.name,game_nick:m.game_nick,member_rank:m.member_rank,account_kind:m.account_kind,verified:m.verified,identity_version:m.identity_version});
function assertCurrent(member,challenge,secret){
 if(!member||member.card_revoked_at||!member.verified)throw fail('Esta carteira não está ativa. Peça uma versão atual à administração.',403);
 if(member.discord_id!==challenge.discord_id||member.identity_version!==challenge.identity_version||!equal(proofHash(buildCardPayload(member),secret),challenge.proof_hash))throw fail('O cadastro foi atualizado. Envie sua carteira atual novamente.',409);
}
async function requireServerMember(bot,discordId){
 if(!bot.ready?.()||!bot.searchRegistrationMembers||!bot.sendMemberSignupCode)throw fail('O bot está desconectado. Aguarde para confirmar seu acesso.',503);
 const profiles=await bot.searchRegistrationMembers(discordId);
 if(!Array.isArray(profiles)||!profiles.some(p=>p.id===discordId&&!p.bot))throw fail('Entre no servidor do distrito para acessar o painel com sua carteira.',403);
}
async function ensureBrowser(c,digest,{lock=false}={}){
 const row=(await c.query('SELECT * FROM card_login_sessions WHERE token_hash=$1'+(lock?' FOR UPDATE':''),[digest])).rows[0];
 if(!row||row.consumed_at||new Date(row.expires_at).getTime()<=Date.now())throw fail('A sessão de leitura expirou. Recarregue a página e envie sua carteira novamente.',403);
 return row;
}

export function cardLoginRoutes(app,pool,config,bot,{decode=decodeCardBarcode}={}){
 const browserCookie={httpOnly:true,secure:config.production,sameSite:'strict',path:'/api/member/card-login',maxAge:DURATION};
 const memberCookie={httpOnly:true,secure:config.production,sameSite:'strict',path:'/api/member',maxAge:8*3600000};
 const authorize=async(req,res,next)=>{
  if(req.get('origin')!==config.origin)return res.status(403).json({error:'Origem não autorizada.'});
  const nonce=cookie(req,SESSION_COOKIE);
  if(!TOKEN.test(String(nonce))||!equal(req.get('x-card-login-csrf'),csrfFor(nonce,config.secret)))return res.status(403).json({error:'Sessão de leitura inválida. Recarregue a página.'});
  req.cardLogin={nonce,digest:sessionHash(nonce,config.secret)};
  await ensureBrowser(pool,req.cardLogin.digest);
  next();
 };
 app.use('/api/member/card-login',(_req,res,next)=>{res.set('Cache-Control','no-store');next();});
 app.get('/api/member/card-login/session',limited(15*60000,30,'Muitas sessões de leitura. Aguarde 15 minutos.'),async(req,res)=>{
  const previous=cookie(req,SESSION_COOKIE);
  let nonce=TOKEN.test(String(previous))?previous:null;
  if(nonce){const row=(await pool.query('SELECT expires_at,consumed_at FROM card_login_sessions WHERE token_hash=$1',[sessionHash(nonce,config.secret)])).rows[0];if(!row||row.consumed_at||new Date(row.expires_at).getTime()<=Date.now())nonce=null;}
  if(!nonce){
   nonce=token();
   await pool.query('DELETE FROM card_login_sessions WHERE expires_at<=now()');
   await pool.query('INSERT INTO card_login_sessions(token_hash,expires_at) VALUES($1,$2)',[sessionHash(nonce,config.secret),new Date(Date.now()+DURATION)]);
  }
  res.cookie(SESSION_COOKIE,nonce,browserCookie).json({csrf:csrfFor(nonce,config.secret)});
 });
 const uploadType=(req,res,next)=>{
  const type=(req.get('content-type')||'').split(';')[0].trim().toLowerCase();
  if(!['image/png','image/jpeg','image/webp'].includes(type))return res.status(415).json({error:'Envie o arquivo PNG, JPEG ou WebP da sua carteira.'});
  req.cardLogin.mime=type;
  next();
 };
 const raw=express.raw({type:['image/png','image/jpeg','image/webp'],limit:MAX_CARD_IMAGE_BYTES,inflate:false});
 const parseUpload=(req,res,next)=>raw(req,res,error=>{
  if(!error)return next();
  if(error.status===413)return res.status(413).json({error:'A imagem da carteira deve ter no máximo 8 MB.'});
  return next(fail('Não foi possível ler o arquivo da carteira.',error.status===415?415:400));
 });
 const decodeUpload=async req=>{
  const image=inspectCardImage(req.body);
  if('image/'+image.type!==req.cardLogin.mime)throw fail('O tipo do arquivo não corresponde à imagem enviada.',415);
  const payload=await decode(req.body);
  const parsed=parseCardPayload(payload);
  const owner=(await pool.query('SELECT discord_id FROM members WHERE idrkc=$1',[parsed.idrkc])).rows[0];
  if(!owner)throw fail('Esta carteira não pertence a um cadastro ativo do distrito.',403);
  const member=await verifyCardPayload(pool,payload,{discordId:owner.discord_id,requireVerified:true});
  return {payload,member};
 };
 app.post('/api/member/card-login/start',
  limited(15*60000,12,'Muitas leituras de carteira. Aguarde 15 minutos.'),
  authorize,uploadType,
  async(req,res,next)=>{
   const row=(await pool.query("UPDATE card_login_sessions SET last_upload_at=now() WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>now() AND (last_upload_at IS NULL OR last_upload_at<=now()-interval '3 seconds') RETURNING token_hash",[req.cardLogin.digest])).rows[0];
   if(!row)return res.status(429).json({error:'Aguarde três segundos antes de enviar outra carteira.'});
   next();
  },
  parseUpload,async(req,res)=>{
   const {payload,member}=await decodeUpload(req);
   await requireServerMember(bot,member.discord_id);
   const code=String(randomInt(100000,1000000)),expires=new Date(Date.now()+DURATION);
   const sent=await tx(pool,async c=>{
    // All writes lock the identity before the browser/challenge, including confirmation.
    const owner=(await c.query('SELECT * FROM members WHERE id=$1 FOR UPDATE',[member.id])).rows[0];
    if(!owner)throw fail('Este cadastro não está mais disponível.',403);
    await verifyCardPayload(c,payload,{discordId:owner.discord_id,requireVerified:true});
   if(!await tryoutMemberAccess(c,config,owner))throw fail('Conclua o cadastro obrigatório pelo link do tryout aprovado antes de acessar com sua carteira.',403);
    await ensureBrowser(c,req.cardLogin.digest,{lock:true});
    const account=(await c.query('SELECT id,discord_id,active FROM member_accounts WHERE member_id=$1 FOR UPDATE',[owner.id])).rows[0];
    if(account&&!account.active)throw fail('Seu acesso ao painel está suspenso. Fale com a administração.',403);
    const recent=(await c.query("SELECT 1 FROM card_login_challenges WHERE member_id=$1 AND sent_at>now()-interval '60 seconds' LIMIT 1",[owner.id])).rowCount;
    if(recent)throw fail('Aguarde um minuto antes de solicitar outro código.',429);
    const digest=codeHash(req.cardLogin.nonce,owner.id,owner.discord_id,code,config.secret);
    await c.query('INSERT INTO card_login_challenges(token_hash,member_id,discord_id,identity_version,proof_hash,code_hash,attempts,sent_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,0,now(),$7) ON CONFLICT(token_hash) DO UPDATE SET member_id=$2,discord_id=$3,identity_version=$4,proof_hash=$5,code_hash=$6,attempts=0,sent_at=now(),expires_at=$7',[req.cardLogin.digest,owner.id,owner.discord_id,owner.identity_version,proofHash(payload,config.secret),digest,expires]);
    // A renewed code must not outlive its still-valid, locked browser session.
    await c.query('UPDATE card_login_sessions SET expires_at=$1 WHERE token_hash=$2',[expires,req.cardLogin.digest]);
    return {discordId:owner.discord_id,name:owner.name,requiresPassword:!account||account.discord_id!==owner.discord_id,digest};
   });
   try{await bot.sendMemberSignupCode(sent.discordId,code,sent.name);}
   catch{
    await pool.query('UPDATE card_login_challenges SET code_hash=NULL WHERE token_hash=$1 AND code_hash=$2',[req.cardLogin.digest,sent.digest]);
    throw fail('Não foi possível enviar o código. Ative as mensagens privadas do servidor e tente novamente em um minuto.');
   }
   res.cookie(SESSION_COOKIE,req.cardLogin.nonce,{...browserCookie,maxAge:Math.max(0,expires.getTime()-Date.now())}).json({ok:true,requires_code:true,requires_password:sent.requiresPassword,expires_at:expires,message:'Carteira conferida. Enviamos um código de seis números ao Discord do titular. Ele vale por 10 minutos.'});
  });
 app.post('/api/member/card-login/confirm',limited(15*60000,30,'Muitas tentativas de confirmação. Aguarde 15 minutos.'),authorize,async(req,res)=>{
  const code=req.body?.code;
  if(typeof code!=='string'||!/^\d{6}$/.test(code))throw fail('Informe o código de seis números enviado no Discord.');
  const initial=(await pool.query('SELECT * FROM card_login_challenges WHERE token_hash=$1',[req.cardLogin.digest])).rows[0];
  if(!initial?.code_hash||initial.attempts>=5||new Date(initial.expires_at).getTime()<=Date.now())throw fail('Código expirado ou bloqueado. Envie sua carteira novamente.');
  await requireServerMember(bot,initial.discord_id);
  const suppliedPassword=req.body.password==null?null:text(req.body.password,'Senha',128,12);
  const passwordDigest=suppliedPassword?await passwordHash(suppliedPassword):null;
  const result=await tx(pool,async c=>{
   const member=(await c.query('SELECT * FROM members WHERE id=$1 FOR UPDATE',[initial.member_id])).rows[0];
   await ensureBrowser(c,req.cardLogin.digest,{lock:true});
   const challenge=(await c.query('SELECT * FROM card_login_challenges WHERE token_hash=$1 FOR UPDATE',[req.cardLogin.digest])).rows[0];
   if(!challenge?.code_hash||challenge.member_id!==initial.member_id||challenge.attempts>=5||new Date(challenge.expires_at).getTime()<=Date.now())return {error:'Código expirado ou bloqueado. Envie sua carteira novamente.',status:400};
   assertCurrent(member,challenge,config.secret);
   if(!await tryoutMemberAccess(c,config,member))throw fail('Conclua o cadastro obrigatório pelo link do tryout aprovado antes de acessar com sua carteira.',403);
   const expected=codeHash(req.cardLogin.nonce,member.id,member.discord_id,code,config.secret);
   if(!equal(expected,challenge.code_hash)){
    await c.query('UPDATE card_login_challenges SET attempts=attempts+1 WHERE token_hash=$1',[req.cardLogin.digest]);
    return {error:'Código incorreto. Confira a mensagem privada do bot.',status:400};
   }
   let account=(await c.query('SELECT id,discord_id,active FROM member_accounts WHERE member_id=$1 FOR UPDATE',[member.id])).rows[0];
   if(account&&!account.active)throw fail('Seu acesso ao painel está suspenso. Fale com a administração.',403);
   if(!account||account.discord_id!==member.discord_id){
    if(!passwordDigest)return {error:'Crie uma senha de pelo menos 12 caracteres para concluir seu primeiro acesso.',requires_password:true,status:400};
    // A changed Discord may replace a previous account only after proving the new owner.
    if(account)await c.query('DELETE FROM member_accounts WHERE id=$1',[account.id]);
    account=(await c.query('INSERT INTO member_accounts(member_id,discord_id,password_hash) VALUES($1,$2,$3) RETURNING id',[member.id,member.discord_id,passwordDigest])).rows[0];
   }
   const value=token(),csrf=token();
   await c.query('DELETE FROM member_sessions WHERE expires_at<=now()');
   await c.query('INSERT INTO member_sessions(token_hash,account_id,csrf,expires_at) VALUES($1,$2,$3,$4)',[hash(value,config.secret),account.id,csrf,new Date(Date.now()+8*3600000)]);
   await c.query('UPDATE card_login_sessions SET consumed_at=now() WHERE token_hash=$1',[req.cardLogin.digest]);
   await c.query('DELETE FROM card_login_challenges WHERE token_hash=$1',[req.cardLogin.digest]);
   return {value,member:safeMember(member)};
  });
  if(result.error)return res.status(result.status).json({error:result.error,...(result.requires_password?{requires_password:true}:{})});
  res.clearCookie(SESSION_COOKIE,browserCookie).cookie(MEMBER_COOKIE,result.value,memberCookie).json({ok:true,member:result.member,redirect:'/membros'});
 });
 app.use('/api/member/card-login',(_req,res)=>res.status(404).json({error:'Página de leitura da carteira não encontrada.'}));
}
