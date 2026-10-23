import {allowed,text} from './security.js';
import {tx,audit} from './db.js';
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const idValue=value=>{const id=Number(value);if(!Number.isSafeInteger(id)||id<1)throw fail('Aviso não encontrado.',404);return id;};
function noticeData(body,old={}){
 const b={...old,...body};
 if(typeof b.pinned!=='boolean'||typeof b.published!=='boolean')throw fail('Informe se o aviso está fixado e publicado.');
 return {title:text(b.title,'Título',140),content:text(b.content,'Conteúdo',6000),pinned:b.pinned,published:b.published};
}
export function officialNoticeRoutes(app,pool,_config){
 const permit=(req,res,next)=>req.auth&&allowed(req.auth.role,'admin')?next():res.status(403).json({error:'Somente a administração pode gerenciar os avisos oficiais.'});
 app.get('/api/official-notices',permit,async(_req,res)=>res.json((await pool.query('SELECT * FROM official_notices ORDER BY pinned DESC,created_at DESC,id DESC LIMIT 300')).rows));
 app.post('/api/official-notices',permit,async(req,res)=>{
  const b=noticeData({pinned:false,published:false,...req.body});
  const result=await tx(pool,async c=>{const row=(await c.query('INSERT INTO official_notices(title,content,pinned,published,created_by,published_at) VALUES($1,$2,$3,$4,$5,CASE WHEN $4 THEN now() ELSE NULL END) RETURNING *',[b.title,b.content,b.pinned,b.published,req.auth.staff_id])).rows[0];await audit(c,req.auth.staff_id,b.published?'Aviso oficial publicado':'Rascunho de aviso criado',{noticeId:row.id});return row;});
  res.status(201).json(result);
 });
 app.patch('/api/official-notices/:id',permit,async(req,res)=>{
  const id=idValue(req.params.id);
  const result=await tx(pool,async c=>{const old=(await c.query('SELECT * FROM official_notices WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!old)throw fail('Aviso não encontrado.',404);const b=noticeData(req.body,old);const row=(await c.query('UPDATE official_notices SET title=$1,content=$2,pinned=$3,published=$4,published_at=CASE WHEN $4 AND NOT published THEN now() ELSE published_at END,updated_at=now() WHERE id=$5 RETURNING *',[b.title,b.content,b.pinned,b.published,id])).rows[0];await audit(c,req.auth.staff_id,'Aviso oficial atualizado',{noticeId:id,published:b.published});return row;});
  res.json(result);
 });
 app.delete('/api/official-notices/:id',permit,async(req,res)=>{const id=idValue(req.params.id);await tx(pool,async c=>{const r=await c.query('DELETE FROM official_notices WHERE id=$1 RETURNING id',[id]);if(!r.rowCount)throw fail('Aviso não encontrado.',404);await audit(c,req.auth.staff_id,'Aviso oficial excluído',{noticeId:id});});res.json({ok:true});});
}
