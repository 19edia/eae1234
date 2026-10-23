import {AttachmentBuilder} from 'discord.js';
import {renderCard} from './cards.js';
import {RokuharaEmbed} from './embed-theme.js';
import {DISTRICT_NAME} from './brand.js';
import {enqueue,tx} from './db.js';

export function createIdrkcDelivery(pool,config,client,{render=renderCard}={}){
 async function schedule(discordId){
  if(!config.divisions.length)return;
  await tx(pool,async c=>{
   await c.query("SELECT pg_advisory_xact_lock(hashtext('idrkc-delivery-schedule'))");
   for(const d of config.divisions){
    const inserted=(await c.query("INSERT INTO idrkc_deliveries(member_id,discord_id,guild_id,identity_version) SELECT id,discord_id,$1,identity_version FROM members WHERE verified=TRUE AND card_revoked_at IS NULL AND ($2::text IS NULL OR discord_id=$2) ON CONFLICT DO NOTHING RETURNING id",[d.guild,discordId||null])).rows;
    for(const row of inserted){const job=await enqueue(c,'idrkc-delivery',{deliveryId:row.id});await c.query('UPDATE idrkc_deliveries SET job_id=$1 WHERE id=$2',[job,row.id]);}
    if(discordId){
     const absent=(await c.query("UPDATE idrkc_deliveries SET status='pending' WHERE discord_id=$1 AND guild_id=$2 AND status='absent' RETURNING job_id",[discordId,d.guild])).rows;
     for(const row of absent)await c.query("UPDATE jobs SET status='pending',attempts=0,error=NULL,next_at=now() WHERE id=$1",[row.job_id]);
    }
   }
  });
 }
 async function execute(job,c){
  const delivery=(await c.query('SELECT * FROM idrkc_deliveries WHERE id=$1 FOR UPDATE',[job.payload.deliveryId])).rows[0];
  if(!delivery||delivery.status==='sent'||delivery.status==='superseded')return;
  const m=(await c.query('SELECT * FROM members WHERE id=$1 FOR SHARE',[delivery.member_id])).rows[0];
  if(!m||m.discord_id!==delivery.discord_id||m.identity_version!==delivery.identity_version||!m.verified||m.card_revoked_at){await c.query("UPDATE idrkc_deliveries SET status='superseded' WHERE id=$1",[delivery.id]);return;}
  if(!config.divisions.some(d=>d.guild===delivery.guild_id)){await c.query("UPDATE idrkc_deliveries SET status='superseded' WHERE id=$1",[delivery.id]);return;}
  const guild=await client.guilds.fetch(delivery.guild_id);
  const member=await guild.members.fetch({user:m.discord_id,force:true}).catch(e=>{if(Number(e.code)===10007)return null;throw e;});
  if(!member||member.user?.bot){await c.query("UPDATE idrkc_deliveries SET status='absent' WHERE id=$1",[delivery.id]);return;}
  const file=`HB-ID-${m.idrkc}-v${m.identity_version}.png`,png=await render(m,DISTRICT_NAME);
  const user=member.user||await client.users.fetch(m.discord_id);
  const sent=await user.send({embeds:[new RokuharaEmbed().setTitle('Sua nova identidade • HB-ID').setDescription('Sua carteira do HRISTE BOZE chegou! Seu registro de membro da guilda está pronto.\n\nGuarde esta imagem: envie sua própria carteira nos formulários de denúncia e atendimento. O bot confere o HBCode e o vínculo com seu Discord.\n\nUse /ver-sua-carteira sempre que precisar da versão atual.').setImage(`attachment://${file}`)],files:[new AttachmentBuilder(png,{name:file})],allowedMentions:{parse:[]},nonce:`idrkc-${delivery.id}`,enforceNonce:true});
  await c.query("UPDATE idrkc_deliveries SET status='sent',message_id=$1,delivered_at=now() WHERE id=$2",[sent.id,delivery.id]);
  await c.query('UPDATE jobs SET message_id=$1 WHERE id=$2',[sent.id,job.id]);
 }
 return {schedule,execute};
}
