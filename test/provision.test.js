import {test} from 'node:test';import assert from 'node:assert/strict';
import {Collection,PermissionFlagsBits as P,ChannelType as T} from 'discord.js';
import {provisionGuild,configureGuildPermissions,createProvisionHandler,registerCreate} from '../src/provision.js';
import {setupConfig} from '../src/setup-server.js';
import {DISTRICT_NAME,DISTRICT_COLOR} from '../src/sbi.js';
import {rankRoles,categories,textChannels,voiceChannels} from '../src/server-layout.js';
const totalChannels=categories.length+textChannels.length+voiceChannels.length;
const divisions=[{id:1,name:'Primeira',guild:'11111111111111111'},{id:2,name:'Segunda',guild:'22222222222222222'}];
function fake(){let seq=0,creates=0,failAt=0;const roles=new Collection(),channels=new Collection();const me={id:'99999999999999999',permissions:{has:()=>true},roles:{highest:{comparePositionTo:()=>1}}};
 const g={id:divisions[0].guild,ownerId:'88888888888888888',members:{fetchMe:async()=>me,fetch:async()=>({permissions:{has:()=>false}})},roles:{fetch:async()=>roles,create:async data=>{const r={...data,id:String(70000000000000000n+BigInt(++seq)),editable:true,permissions:{has:()=>false},edit:async function(data){Object.assign(this,data)}};roles.set(r.id,r);return r;}},channels:{fetch:async()=>channels,create:async data=>{creates++;if(creates===failAt)throw Error('mock failure');const c={...data,id:String(60000000000000000n+BigInt(++seq)),edit:async function(data){Object.assign(this,data)}};channels.set(c.id,c);return c;}}};return {g,roles,channels,me,setFailure:n=>failAt=n};}
test('provision creates private internal text/voice, public entry, and reuses its resources',async()=>{
 const f=fake();const a=await provisionGuild(f.g,divisions[0]);assert.match(a.env,/DIV_1_GUILD_ID=11111111111111111/);assert.equal(f.roles.size,rankRoles.length);assert.equal(f.channels.size,totalChannels);
 for(const ch of f.channels.values()){
  const everyone=ch.permissionOverwrites.find(x=>x.id===f.g.id);
  const publicEntry=ch.name.includes('PORTAL')||ch.name.includes('ARQUIVOS DA GUILDA')||['verification','tickets','welcome','rules','guide','news'].some(key=>ch.topic===`HB-D1:${key}`);
  assert.ok(publicEntry?everyone.allow.includes(P.ViewChannel):everyone.deny.includes(P.ViewChannel));
 }
 assert.equal([...f.channels.values()].filter(c=>c.type===T.GuildVoice).length,voiceChannels.length);
 assert.deepEqual(await provisionGuild(f.g,divisions[0]),a);assert.equal(f.channels.size,totalChannels);assert.equal(f.roles.size,rankRoles.length);
});
test('provision resumes a partial operation without duplicating roles or channels',async()=>{
 const f=fake();f.setFailure(5);await assert.rejects(provisionGuild(f.g,divisions[0]));assert.equal(f.channels.size,4);f.setFailure(0);await provisionGuild(f.g,divisions[0]);assert.equal(f.channels.size,totalChannels);assert.equal(f.roles.size,rankRoles.length);
});
test('/criar is an administrator-only global command available before any setup',async()=>{
 const registered=[];const client={application:{commands:{create:async data=>registered.push({scope:'global',data})}},guilds:{fetch:async id=>({commands:{create:async data=>registered.push({scope:id,data})}})}};
 await registerCreate(client,[]);assert.equal(registered.length,2);assert.equal(registered[0].scope,'global');assert.equal(registered[0].data.name,'criar');assert.equal(registered[0].data.default_member_permissions,String(P.Administrator));assert.deepEqual(registered[0].data.options,[]);
 const configure=registered[1];assert.equal(configure.scope,'global');assert.equal(configure.data.name,'configurar');assert.equal(configure.data.default_member_permissions,String(P.Administrator));assert.equal(configure.data.dm_permission,false);assert.deepEqual(configure.data.options.map(s=>s.name),['cargos','permissoes']);
 await registerCreate(client,[divisions[0]]);assert.deepEqual(registered.slice(2).map(x=>x.data.name),['criar','configurar','criar','configurar','deletar']);
});
test('SBI installer accepts one district without role or channel variables',()=>{
 assert.throws(()=>setupConfig({}),/DISCORD_TOKEN/);
 const config=setupConfig({DISCORD_TOKEN:'x'.repeat(40),NODE_ENV:'test',APP_ORIGIN:'http://localhost:3000',SESSION_SECRET:'x'.repeat(40),DATABASE_URL:'postgresql://user:password@localhost/db'});
 assert.deepEqual(config.divisions,[]);assert.equal(config.sbi,true);
});
test('/criar rejects a non-admin before touching the SBI database',async()=>{
 const f=fake(),handler=createProvisionHandler({guilds:{fetch:async()=>f.g}},[],{pool:{query:async()=>{throw Error('should not query');}}});
 const i={isChatInputCommand:()=>true,commandName:'criar',guildId:f.g.id,user:{id:'33333333333333333'},deferReply:async()=>{},editReply:async function(r){this.result=r;}};
 await handler(i);assert.match(i.result.content,/Somente o dono/);assert.equal(f.channels.size,0);
});
test('missing bot permissions blocks provisioning before creating resources',async()=>{const f=fake();f.me.permissions.has=()=>false;await assert.rejects(provisionGuild(f.g,divisions[0]),/Gerenciar canais/);assert.equal(f.roles.size,0);assert.equal(f.channels.size,0);});
test('legacy structure keeps role, category, voice and panel IDs while being decorated',async()=>{
 const f=fake();const role=await f.g.roles.create({name:'IFJ-D1 • Membro verificado'});const admin=await f.g.roles.create({name:'IFJ-D1 • Equipe'});
 const cat=await f.g.channels.create({name:'IFJ-D1 • ENTRADA',type:T.GuildCategory});
 const call=await f.g.channels.create({name:'IFJ-D1 • Call 1',type:T.GuildVoice});
 const verify=await f.g.channels.create({name:'verificacao',type:T.GuildText,topic:'IFJ-D1:verification'});
 const r=await provisionGuild(f.g,divisions[0]);assert.ok(r.env.includes(`MEMBER_ROLE_ID=${role.id}`));assert.ok(r.env.includes(`ADMIN_ROLE_ID=${admin.id}`));assert.ok(r.env.includes(`VERIFICATION_CHANNEL_ID=${verify.id}`));assert.match(f.channels.get(cat.id).name,/PORTAL/);assert.match(f.channels.get(call.id).name,/🔊/);assert.equal(f.channels.size,totalChannels);assert.equal(f.roles.size,rankRoles.length);assert.match(r.inventory,/Líder/);
 const wanted=[...f.channels.values()].find(c=>c.topic==='HB-D1:wanted');assert.ok(wanted.permissionOverwrites.find(x=>x.id===role.id).deny.includes(P.SendMessages));
 const leader=[...f.roles.values()].find(r=>r.name.endsWith('Líder'));assert.equal(leader.permissions.has(P.Administrator),false);assert.ok(!wanted.permissionOverwrites.some(x=>x.id===leader.id));
});
test('guild is yellow, stores all resources progressively, and preserves IDs after renamed resources',async()=>{
 const f=fake(),snapshots=[];
 const r=await provisionGuild(f.g,divisions[0],{persist:async d=>snapshots.push(structuredClone(d))});
 assert.equal(r.district.name,DISTRICT_NAME);assert.equal(r.district.id,1);
 assert.ok([...f.roles.values()].every(role=>role.color===DISTRICT_COLOR));assert.ok([...f.channels.values()].filter(c=>c.type===T.GuildCategory).every(c=>c.name.includes('🟡')));
 assert.equal(Object.keys(r.district.resources).length,totalChannels);assert.ok(snapshots.length>=49);assert.equal(snapshots[1].memberRole,r.district.memberRole);assert.equal(r.district.news,r.district.resources.news);assert.equal(r.district.allianceChannel,r.district.resources.alliances);
 for(const ch of f.channels.values())ch.name='renamed-'+ch.id;
 await provisionGuild(f.g,r.district);assert.equal(f.channels.size,totalChannels);assert.equal(f.roles.size,rankRoles.length);
});
test('partial creation persists recoverable state before a later Discord failure',async()=>{
 const f=fake(),snapshots=[];f.setFailure(5);
 await assert.rejects(provisionGuild(f.g,divisions[0],{persist:async d=>snapshots.push(structuredClone(d))}));
 const last=snapshots.at(-1);assert.equal(Object.keys(last.resources).length,4);assert.equal(Object.keys(last.rankRoles).length,rankRoles.length-2);
 f.setFailure(0);await provisionGuild(f.g,last);assert.equal(f.channels.size,totalChannels);assert.equal(f.roles.size,rankRoles.length);
});

test('tryout category starts bot-only while members can use Deepwoken training, builds and Depths',async()=>{
 const f=fake(),r=await provisionGuild(f.g,divisions[0]),d=r.district;
 const privateCategory=f.channels.get(d.resources['tryouts-category']);
 assert.equal(privateCategory.type,T.GuildCategory);
 assert.deepEqual(privateCategory.permissionOverwrites.map(x=>x.id),[f.g.id,f.me.id]);
 assert.ok(privateCategory.permissionOverwrites[0].deny.includes(P.ViewChannel));
 assert.ok(!privateCategory.permissionOverwrites.some(x=>x.id===d.adminRole||x.id===d.memberRole));
 for(const key of ['build-sharing','chime','depths-runs','layer-two','depths-rescue']){
  const ch=f.channels.get(d.resources[key]);assert.ok(ch.permissionOverwrites.find(x=>x.id===d.memberRole).allow.includes(P.ViewChannel),key);
 }
 assert.match(f.channels.get(d.verification).name,/solicitar-tryout/);
});

test('/criar replaces deleted resource IDs in persisted state and remains idempotent',async()=>{
 const f=fake(),first=await provisionGuild(f.g,divisions[0]),d=first.district;
 const deletedChannel=d.verification,deletedRole=d.memberRole;
 f.channels.delete(deletedChannel);f.roles.delete(deletedRole);
 const snapshots=[],repaired=await provisionGuild(f.g,d,{persist:async value=>snapshots.push(structuredClone(value))});
 assert.notEqual(repaired.district.verification,deletedChannel);
 assert.notEqual(repaired.district.memberRole,deletedRole);
 assert.equal(repaired.district.resources.verification,repaired.district.verification);
 assert.equal(snapshots.at(-1).verification,repaired.district.verification);
 await provisionGuild(f.g,repaired.district);
 assert.equal(f.channels.size,totalChannels);assert.equal(f.roles.size,rankRoles.length);
});

test('each supported game has its category, discussion, groups, guides and voice',async()=>{
 const f=fake(),{district:d}=await provisionGuild(f.g,divisions[0]);
 for(const game of ['westbound','deepwoken','klase']){
  const category=f.channels.get(d.resources[game]);assert.ok(category.name.includes(game.toUpperCase()));
  for(const suffix of ['general','groups','guides'])assert.equal(f.channels.get(d.resources[`${game}-${suffix}`]).parent,category.id);
  assert.equal(f.channels.get(d.resources[`voice-${game}`]).parent,category.id);
 }
 assert.equal(f.channels.get(d.resources.chime).parent,d.resources.deepwoken);
 assert.equal(f.channels.get(d.resources['boss-runs']).parent,d.resources.deepwoken);
 assert.equal(f.channels.get(d.resources['voice-depths']).parent,d.resources.depths);
 assert.ok(!f.channels.get(d.resources.training).name.includes('CHIME'));
});

test('roles-only repair preserves channels, replaces deleted IDs and is repeatable',async()=>{
 const f=fake(),{district:d}=await provisionGuild(f.g,divisions[0]);
 const serialize=channels=>JSON.stringify([...channels.values()],(_,value)=>typeof value==='bigint'?String(value):value),channelsBefore=serialize(f.channels);
 const previous=d.rankRoles.recruiter;f.roles.delete(previous);
 const snapshots=[],r=await provisionGuild(f.g,d,{rolesOnly:true,persist:async s=>snapshots.push(structuredClone(s))});
 assert.notEqual(r.district.rankRoles.recruiter,previous);assert.equal(snapshots.at(-1).rankRoles.recruiter,r.district.rankRoles.recruiter);
 assert.equal(serialize(f.channels),channelsBefore);assert.equal(f.roles.size,rankRoles.length);
 const again=await provisionGuild(f.g,r.district,{rolesOnly:true});assert.equal(again.district.rankRoles.recruiter,r.district.rankRoles.recruiter);assert.equal(f.roles.size,rankRoles.length);
});

test('permission repair targets saved layout only and preserves individual tryouts and unrelated channels',async()=>{
 const f=fake(),{district:d}=await provisionGuild(f.g,divisions[0]);
 const privatePermissions=[{id:f.g.id,deny:[P.ViewChannel]},{id:'55555555555555555',allow:[P.ViewChannel]}];
 const personal=await f.g.channels.create({name:'tryout-personal',type:T.GuildText,parent:d.resources['tryouts-category'],permissionOverwrites:privatePermissions});
 const unrelated=await f.g.channels.create({name:'unrelated',type:T.GuildText,permissionOverwrites:[]});
 f.channels.get(d.resources.general).permissionOverwrites=[];
 const repaired=await configureGuildPermissions(f.g,d);
 assert.equal(repaired.count,totalChannels);assert.deepEqual(repaired.missing,[]);
 assert.deepEqual(personal.permissionOverwrites,privatePermissions);assert.deepEqual(unrelated.permissionOverwrites,[]);
 assert.ok(f.channels.get(d.resources.general).permissionOverwrites.find(x=>x.id===d.memberRole).allow.includes(P.ViewChannel));
 assert.deepEqual(f.channels.get(d.resources['tryouts-category']).permissionOverwrites.map(x=>x.id),[f.g.id,f.me.id]);
 assert.equal(f.channels.size,totalChannels+2);
});

test('/configurar denies non-administrators before accessing the database',async()=>{
 const f=fake(),handler=createProvisionHandler({guilds:{fetch:async()=>f.g}},[],{pool:{query:async()=>{throw Error('should not query');}}});
 const i={isChatInputCommand:()=>true,commandName:'configurar',guildId:f.g.id,user:{id:'33333333333333333'},deferReply:async()=>{},editReply:async function(r){this.result=r;}};
 await handler(i);assert.match(i.result.content,/Somente o dono/);assert.equal(f.roles.size,0);assert.equal(f.channels.size,0);
});
