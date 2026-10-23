import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {Collection,PermissionFlagsBits as P} from 'discord.js';
import {createBot} from '../src/bot.js';
import {createMemberRecord} from '../src/member-store.js';
import {loadSbiConfig,saveSbiDistrict} from '../src/sbi.js';
import {rankRoles} from '../src/server-layout.js';
import {enqueue,initialize,tx} from '../src/db.js';
import {tryoutMemberAccess} from '../src/tryouts.js';

const guildId='822222222222222222',ownerId='1480009495915659494',botId='822222222222222223';
const config={origin:'http://localhost:3000',secret:'configure-verified-test'.repeat(4),production:false,sbi:true,botEnabled:false,divisions:[],sourceGuilds:[],tryouts:{enabled:true,evaluatorId:ownerId,passPercent:50,registrationHours:48}};
let db,pool,bot,admin,sequence=0;
const users=new Map(),mutations=[];
const roleIds=Object.fromEntries(rankRoles.map(([key],n)=>[key,String(832222222222222222n+BigInt(n))]));
const roles=new Collection(rankRoles.map(([key,emoji,name])=>[roleIds[key],{id:roleIds[key],name:`HB • ${emoji} ┃ ${name}`,editable:true,managed:false,permissions:{has:()=>false},edit:async function(data){Object.assign(this,data);}}]));
const me={id:botId,permissions:{has:()=>true},roles:{highest:{comparePositionTo:()=>1}}};
const guild={id:guildId,ownerId,name:'GUILDA HRISTE BOZE',roles:{fetch:async()=>roles,create:async()=>{throw Error('The configured roles already exist');}},members:{fetchMe:async()=>me,fetch:async value=>{
 const id=typeof value==='string'?value:value.user;
 if(id===ownerId)return {id,permissions:{has:()=>true}};
 const user=users.get(id);if(!user)throw Object.assign(Error('Unknown member'),{code:10007});return user;
}},channels:{fetch:async()=>{throw Error('/configurar cargos must not require channel work when IDs are unchanged');}}};

function discordUser(id,initial=[roleIds.member,roleIds.leader,roleIds.admin]){
 const cache=new Set(['unrelated-community-role',...initial]);
 const user={id,displayName:'Mesmo nick',user:{id,bot:false},guild:{id:guildId},joinedTimestamp:Date.now(),roles:{cache,add:async value=>{mutations.push(['add',id,value]);cache.add(value);},remove:async value=>{mutations.push(['remove',id,value]);cache.delete(value);}}};
 users.set(id,user);return user;
}
async function member(rank='Veterano',{verified=true,revoked=false,kind='membro'}={}){
 const discordId=String(842222222222222222n+BigInt(++sequence));
 const row=await tx(pool,c=>createMemberRecord(c,{name:'Mesmo nome',game_nick:'Mesmo nick',roblox_username:'ConfigPlayer'+sequence,discord_id:discordId,division:1,account_kind:kind,allied_gang:kind==='aliado'?'Guilda amiga':null,member_rank:rank},admin));
 const updated=(await pool.query('UPDATE members SET verified=$1,card_revoked_at=$2 WHERE id=$3 RETURNING *',[verified,revoked?new Date():null,row.id])).rows[0];
 discordUser(discordId);return updated;
}
async function attempt(m,status,{deadline=null,memberId=null,guild=guildId}={}){
 return (await pool.query("INSERT INTO tryout_sessions(guild_id,participant_id,evaluator_id,participant_nick,evaluator_nick,status,threshold,link_nonce,link_expires_at,registration_deadline,member_id) VALUES($1,$2,$3,'Mesmo nick','Avaliador',$4,50,$5,now()+interval '1 day',$6,$7) RETURNING *",[guild,m.discord_id,ownerId,status,'configuration-test-'+(++sequence),deadline,memberId])).rows[0];
}
async function configure({expectQueued=true}={}){
 const replies=[];
 await bot.handleInteraction({guildId,user:{id:ownerId},isChatInputCommand:()=>true,isButton:()=>false,isModalSubmit:()=>false,commandName:'configurar',options:{getSubcommand:()=> 'cargos'},deferReply:async()=>{},editReply:async value=>replies.push(value),reply:async value=>replies.push(value)});
 if(expectQueued)assert.match(replies.at(-1)?.content||'',/sincronização automática.*enfileirada/);
 return replies.at(-1);
}
async function drainRoles(){
 // Admission and lifecycle jobs are independently covered. Exercise the actual
 // bot worker, its transaction, identity lookup and role synchronizer here.
 await pool.query("UPDATE jobs SET status='sent' WHERE kind<>'sync-role'");
 for(let n=0;n<20;n++){
  const pending=(await pool.query("SELECT id FROM jobs WHERE kind='sync-role' AND status='pending' AND next_at<=now()")).rowCount;
  if(!pending)break;await bot.work();
 }
 const remaining=(await pool.query("SELECT id,error FROM jobs WHERE kind='sync-role' AND status='pending'")).rows;
 assert.deepEqual(remaining,[],'every role job completed without a retry or swallowed worker error');
}
function assertRoles(m,keys){assert.deepEqual([...users.get(m.discord_id).roles.cache].sort(),['unrelated-community-role',...keys.map(key=>roleIds[key])].sort(),m.member_rank+' / '+m.discord_id);}

before(async()=>{
 db=new PGlite();
 for(const file of ['schema.sql','district-schema.sql','sbi-schema.sql','member-portal-schema.sql','idrkc-schema.sql','verified-services-schema.sql','embed-publications-schema.sql','registration-invites-schema.sql','card-login-schema.sql','tryouts-schema.sql'])await db.exec(await readFile(new URL('../src/'+file,import.meta.url),'utf8'));
 let tail=Promise.resolve();
 pool={query:async(sql,args)=>{
  if(typeof sql==='object'){await db.exec(sql.text);return {rows:[],rowCount:0};}
  if(sql.includes('pg_try_advisory_lock'))return {rows:[{locked:true}],rowCount:1};
  if(sql.includes('pg_advisory_unlock')||sql.includes('pg_advisory_xact_lock'))return {rows:[],rowCount:1};
  const result=await db.query(sql,args);return {...result,rowCount:result.affectedRows||result.rows.length};
 },connect:async()=>{const previous=tail;let release;tail=new Promise(resolve=>{release=resolve;});await previous;return {...pool,release};}};
 admin=(await pool.query("INSERT INTO staff(username,password_hash,role) VALUES('configure-admin','test-password-hash','admin') RETURNING id")).rows[0].id;
 await loadSbiConfig(pool,config);
 await saveSbiDistrict(pool,config,{id:1,guild:guildId,memberRole:roleIds.member,adminRole:roleIds.admin,rankRoles:Object.fromEntries(Object.entries(roleIds).filter(([key])=>!['member','admin'].includes(key))),resources:{}},{complete:true});
 bot=createBot(pool,config);bot.client.isReady=()=>true;bot.client.guilds.fetch=async id=>{assert.equal(id,guildId);return guild;};
});
after(async()=>{await bot?.stop();await db?.close();});

test('/configurar cargos really grants panel-verified identities and every configured rank without a portal account or tryout snapshot',async()=>{
 const cases=[['Membro',[]],['Juramentado',[]],['Líder',['leader','admin']],['Sub líder',['subleader','admin']],['High member',['high','admin']],['Moderador',['moderator','admin']],['Examinador',['recruiter']],['Guilda aliada',['ally']],['Veterano',['veteran']],['Iniciado',['rookie']],['PvP',['pvp']],['PvE',['pve']],['Artífice de builds',['builder']],['Explorador',['navigator']]];
 const records=[];for(const [rank,expected] of cases)records.push({m:await member(rank),expected});
 const reply=await configure();assert.match(reply.content,new RegExp(`para ${records.length} cadastro`));
 await drainRoles();
 for(const {m,expected} of records){
  assertRoles(m,['member',...expected]);
  const stored=(await pool.query('SELECT * FROM members WHERE id=$1',[m.id])).rows[0];
  assert.equal(stored.verified,true);assert.equal(stored.member_rank,m.member_rank);assert.equal(stored.idrkc,m.idrkc);assert.equal(stored.discord_id,m.discord_id);
 }
 assert.equal((await pool.query('SELECT id FROM member_accounts')).rowCount,0);
 assert.equal((await pool.query('SELECT member_id FROM tryout_legacy_members')).rowCount,0);
 // Granting Discord roles does not silently authorize portal/card access.
 assert.equal(await tryoutMemberAccess(pool,config,records[0].m),false);
});

test('the real command preserves rejection, revocation and mandatory-registration gates while restoring eligible registered members',async()=>{
 const denied=[await member('Líder',{verified:false}),await member('Líder',{revoked:true})];
 for(const status of ['pending','failed','expired','cancelled']){const m=await member('Líder');await attempt(m,status);denied.push(m);}
 const overdue=await member('Líder');await attempt(overdue,'passed',{deadline:new Date(Date.now()-60000)});denied.push(overdue);
 const provisional=await member('Líder');await attempt(provisional,'passed',{deadline:new Date(Date.now()+3600000)});
 const registered=await member('Explorador');await attempt(registered,'registered',{memberId:registered.id,deadline:new Date(Date.now()-60000)});
 const mismatched=await member('Líder');await attempt(mismatched,'registered',{memberId:registered.id});denied.push(mismatched);
 const revokedPassed=await member('Líder',{revoked:true});await attempt(revokedPassed,'passed',{deadline:new Date(Date.now()+3600000)});denied.push(revokedPassed);
 const previousGuild=await member('Veterano');await attempt(previousGuild,'failed',{guild:'855555555555555555'});
 await configure();await drainRoles();
 for(const m of denied)assertRoles(m,[]);
 assertRoles(provisional,['member']);assertRoles(registered,['member','navigator']);assertRoles(previousGuild,['member','veteran']);
});

test('repeating /configurar does not duplicate pending jobs or Discord mutations; rank changes and Discord changes use the stored identity',async()=>{
 const m=await member('Líder');await configure();
 const pending=async()=>(await pool.query("SELECT payload->>'discordId' AS id,count(*)::int AS count FROM jobs WHERE kind='sync-role' AND status='pending' GROUP BY payload->>'discordId' ORDER BY id")).rows;
 const once=await pending();await configure();assert.deepEqual(await pending(),once);assert.ok(once.every(row=>row.count===1));
 await drainRoles();assertRoles(m,['member','leader','admin']);
 const count=mutations.length;await configure();await drainRoles();assert.equal(mutations.length,count,'unchanged role assignments do not call Discord again');
 await pool.query("UPDATE members SET member_rank='PvE' WHERE id=$1",[m.id]);
 await configure();await drainRoles();assertRoles(m,['member','pve']);
 const oldDiscord=m.discord_id,newDiscord=String(842222222222222222n+BigInt(++sequence));discordUser(newDiscord,[]);
 await pool.query('UPDATE members SET discord_id=$1 WHERE id=$2',[newDiscord,m.id]);
 await enqueue(pool,'sync-role',{discordId:oldDiscord});await configure();await drainRoles();
 assertRoles(m,[]);assertRoles({...m,discord_id:newDiscord},['member','pve']);
});

test('startup and a Discord rejoin restore verified panel ranks; later verification removal still revokes managed roles',async()=>{
 const m=await member('Veterano');
 const user=discordUser(m.discord_id,[]);
 await initialize(pool,{BOT_ENABLED:'true'});await initialize(pool,{BOT_ENABLED:'true'});
 assert.equal((await pool.query("SELECT id FROM jobs WHERE kind='sync-role' AND status='pending' AND payload->>'discordId'=$1",[m.discord_id])).rowCount,1);
 await drainRoles();assertRoles(m,['member','veteran']);
 user.roles.cache.delete(roleIds.member);user.roles.cache.delete(roleIds.veteran);
 await bot.handleMemberJoin(user);await drainRoles();assertRoles(m,['member','veteran']);
 await pool.query('UPDATE members SET verified=FALSE WHERE id=$1',[m.id]);await configure();await drainRoles();assertRoles(m,[]);
 assert.equal((await pool.query('SELECT member_id FROM tryout_legacy_members WHERE member_id=$1',[m.id])).rowCount,0);
});

test('/configurar rejects a newly mapped rank with dangerous permissions before enqueuing any grant',async()=>{
 for(const key of ['pvp','pve','builder','navigator']){
  const role=roles.get(roleIds[key]),permissions=role.permissions;
  role.permissions={has:bit=>bit===P.ManageRoles};
  try{
   const before=(await pool.query("SELECT id FROM jobs WHERE kind='sync-role' AND status='pending'")).rowCount;
   const reply=await configure({expectQueued:false});assert.match(reply.content,/permissões incompatíveis/);
   assert.equal((await pool.query("SELECT id FROM jobs WHERE kind='sync-role' AND status='pending'")).rowCount,before);
  }finally{role.permissions=permissions;}
 }
});
