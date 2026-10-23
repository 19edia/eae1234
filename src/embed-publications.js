import {createHash,randomUUID} from 'node:crypto';
import {allowed} from './security.js';
import {tx,audit,enqueue} from './db.js';
import {normalizeEmbedPayload,embedCharacterCount} from './embed-payload.js';

const fail=(message,status=400,code='EMBED_PUBLICATION')=>Object.assign(new Error(message),{status,code});
const validId=id=>/^\d{17,20}$/.test(id||'');
const requestId=value=>{
 if(value===undefined)return randomUUID();
 if(typeof value!=='string'||!/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(value))throw fail('Identificador da publicação inválido. Atualize a página e tente novamente.');
 return value.toLowerCase();
};
const publicationId=value=>{const id=Number(value);if(!Number.isSafeInteger(id)||id<1)throw fail('Publicação não encontrada.',404);return id;};
const select=`SELECT p.id,p.payload,p.guild_id,p.channel_id,p.message_id,p.job_id,p.created_at,p.published_at,
 COALESCE(j.status,CASE WHEN p.published_at IS NULL THEN 'failed' ELSE 'sent' END) AS status,
 j.error,COALESCE(j.attempts,0) AS attempts,j.next_at
 FROM embed_publications p LEFT JOIN jobs j ON j.id=p.job_id`;
const expose=row=>({...row,message_url:row.message_id?`https://discord.com/channels/${row.guild_id}/${row.channel_id}/${row.message_id}`:null});
async function getPublication(pool,id){const row=(await pool.query(`${select} WHERE p.id=$1`,[id])).rows[0];return row?expose(row):null;}
function destination(config){
 const district=config.divisions[0],channel=district?.news||district?.newsChannel;
 if(!validId(district?.guild)||!validId(channel))throw fail('Configure o distrito com /criar para publicar no canal de avisos.',409);
 return {guild:district.guild,channel};
}

/** Mount after the existing staff authentication and CSRF middleware. */
export function embedPublicationRoutes(app,pool,config){
 const permit=(req,res,next)=>req.auth&&allowed(req.auth.role,'admin')?next():res.status(403).json({error:'Somente administradores e sub líderes podem publicar embeds.'});
 app.get('/api/embed-publications',permit,async(_req,res)=>res.json((await pool.query(`${select} ORDER BY p.id DESC LIMIT 200`)).rows.map(expose)));
 app.post('/api/embed-publications/preview',permit,async(req,res)=>{
  const payload=normalizeEmbedPayload(req.body?.payload);res.json({payload,characters:embedCharacterCount(payload)});
 });
 app.post('/api/embed-publications',permit,async(req,res)=>{
  const payload=normalizeEmbedPayload(req.body?.payload),serialized=JSON.stringify(payload),payloadHash=createHash('sha256').update(serialized).digest('hex');
  const id=requestId(req.body?.request_id),target=destination(config),actor=req.auth.staff_id;
  const publication=await tx(pool,async c=>{
   const inserted=(await c.query('INSERT INTO embed_publications(request_id,payload,payload_hash,guild_id,channel_id,created_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(request_id) DO NOTHING RETURNING id',[id,serialized,payloadHash,target.guild,target.channel,actor])).rows[0];
   if(!inserted){
    const old=(await c.query('SELECT id,created_by,payload_hash FROM embed_publications WHERE request_id=$1',[id])).rows[0];
    if(!old||old.created_by!==actor||old.payload_hash!==payloadHash)throw fail('Este identificador já foi usado em outra publicação. Atualize a página antes de publicar outro conteúdo.',409);
    return getPublication(c,old.id);
   }
   const jobId=await enqueue(c,'embed-publication',{publicationId:inserted.id});
   await c.query('UPDATE embed_publications SET job_id=$1 WHERE id=$2',[jobId,inserted.id]);
   await audit(c,actor,'Embed oficial enfileirado',{publicationId:inserted.id,jobId});
   return getPublication(c,inserted.id);
  });
  res.status(202).json(publication);
 });
 app.post('/api/embed-publications/:id/retry',permit,async(req,res)=>{
  const id=publicationId(req.params.id);
  await tx(pool,async c=>{
   const row=(await c.query('SELECT * FROM embed_publications WHERE id=$1',[id])).rows[0];if(!row)throw fail('Publicação não encontrada.',404);
   const job=row.job_id?(await c.query('SELECT * FROM jobs WHERE id=$1 FOR UPDATE',[row.job_id])).rows[0]:null;
   if(row.published_at||!job||job.status!=='failed')throw fail('Somente publicações com falha podem ser reenviadas.',409);
   const target=destination(config);if(row.guild_id!==target.guild||row.channel_id!==target.channel)throw fail('O canal de avisos mudou. Crie uma nova publicação no distrito atual.',409);
   await c.query("UPDATE jobs SET status='pending',attempts=0,error=NULL,next_at=now() WHERE id=$1",[job.id]);
   await audit(c,req.auth.staff_id,'Reenvio de embed oficial solicitado',{publicationId:id,jobId:job.id});
  });
  res.status(202).json(await getPublication(pool,id));
 });
}

export async function listMemberEmbedPublications(pool){
 const {rows}=await pool.query(`${select} WHERE p.published_at IS NOT NULL AND (j.status='sent' OR j.id IS NULL) ORDER BY p.published_at DESC,p.id DESC LIMIT 100`);
 return rows.map(row=>({id:row.id,payload:row.payload,message_url:expose(row).message_url,published_at:row.published_at,created_at:row.created_at}));
}

export function createEmbedPublications(_pool,config,client){
 async function execute(job,c){
  if(job.kind!=='embed-publication')throw fail('Operação de embed desconhecida.',400,'EMBED_JOB_INVALID');
  const id=publicationId(job.payload.publicationId),row=(await c.query('SELECT * FROM embed_publications WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!row||Number(row.job_id)!==Number(job.id))throw fail('Publicação removida ou operação inválida.',409,'EMBED_JOB_INVALID');
  if(row.published_at&&row.message_id){await c.query('UPDATE jobs SET message_id=$1 WHERE id=$2',[row.message_id,job.id]);return;}
  const target=destination(config);
  if(row.guild_id!==target.guild||row.channel_id!==target.channel)throw fail('O canal de avisos mudou. Crie uma nova publicação no distrito atual.',409,'EMBED_DESTINATION_CHANGED');
  const channel=await client.channels.fetch(row.channel_id);
  if(!channel||channel.guildId!==row.guild_id||typeof channel.send!=='function'||channel.isTextBased&&!channel.isTextBased())throw fail('Canal de avisos indisponível.',409,'EMBED_CHANNEL_INVALID');
  const payload=normalizeEmbedPayload(row.payload);
  const sent=await channel.send({...payload,nonce:String(job.id),enforceNonce:true});
  await c.query('UPDATE embed_publications SET message_id=$1,published_at=now() WHERE id=$2',[sent.id,row.id]);
  await c.query('UPDATE jobs SET message_id=$1 WHERE id=$2',[sent.id,job.id]);
 }
 return {execute};
}
