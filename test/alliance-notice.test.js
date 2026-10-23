import {test} from 'node:test';
import assert from 'node:assert/strict';
import {allianceMessage,publishAlliance} from '../src/alliance-notice.js';
import {validateEnvironment} from '../src/config-rules.js';
import {readConfig} from '../src/config.js';
const invite='https://discord.gg/2xQgZQ3ZMV';
test('a new guild has no inherited alliance and accepts an explicit partner',()=>{
 const env={NODE_ENV:'test',BOT_ENABLED:'false',APP_ORIGIN:'http://localhost:3000',DATABASE_URL:'postgresql://test:password@localhost:5432/test',SESSION_SECRET:'test-secret'.repeat(5),HYDRA_INVITE_URL:'https://discord.gg/a9tUzVxdQ'};
 assert.equal(readConfig({...env,HYDRA_INVITE_URL:undefined}).hydraInvite,'');
 assert.equal(readConfig({...env,ALLIANCE_INVITE_URL:'https://discord.gg/customGuild'}).hydraInvite,'https://discord.gg/customGuild');
});
test('guild diplomacy includes an optional invite, yellow brand and no mentions',()=>{
 for(const id of [1,2]){const m=allianceMessage({id},invite),e=m.embeds[0].toJSON();assert.match(e.title,/HRISTE BOZE.*Alianças/);assert.ok(e.description.includes(invite));assert.doesNotMatch(e.description,/RYUKETSU|HYDRA/);assert.deepEqual(m.allowedMentions,{parse:[]});}
 assert.match(allianceMessage({id:1},'').embeds[0].toJSON().description,/Nenhum convite/);
});
test('publishes in correct channels, updates same messages, recovers deletion and rejects wrong guild',async()=>{
 const ids=['1551393214714482748','1551393565471674441'],stored=new Map(),sent=[],edited=[];let wrong=false,deleted=false;
 const pool={query:async(s,a)=>{if(s.startsWith('SELECT'))return {rows:stored.has(a[0])?[{message_id:stored.get(a[0])}]:[]};stored.set(a[0],a[1]);return {rows:[]};}};
 const client={user:{id:'bot'},channels:{fetch:async id=>({guildId:wrong?'wrong':String(ids.indexOf(id)+1),isTextBased:()=>true,send:async m=>{sent.push([id,m]);return {id:'message-'+sent.length};},messages:{fetch:async arg=>{if(typeof arg==='object')return new Map();if(deleted)throw Object.assign(new Error(),{code:10008});return {id:'message-'+(ids.indexOf(id)+1),author:{id:'bot'},embeds:[{title:'ROKUHARA × HYDRA NO KAI'}],edit:async m=>edited.push([id,m])};}}})}};
 for(let n=1;n<=2;n++){const d={id:n,guild:String(n),allianceChannel:ids[n-1]};await publishAlliance(pool,client,d,invite);await publishAlliance(pool,client,d,invite);}
 assert.equal(sent.length,2);assert.equal(edited.length,2);assert.deepEqual(sent.map(x=>x[0]),ids);
 deleted=true;await publishAlliance(pool,client,{id:1,guild:'1',allianceChannel:ids[0]},invite);assert.equal(sent.length,3);
 wrong=true;await assert.rejects(publishAlliance(pool,client,{id:1,guild:'1',allianceChannel:ids[0]},invite),/Canal de alianças inválido/);
});
test('SBI keeps legacy channels optional and validates an explicit ally invite',()=>{
 const checks=validateEnvironment({BOT_ENABLED:'false',HYDRA_INVITE_URL:'https://evil.example/convite',DIV_1_ALLIANCE_CHANNEL_ID:'invalid'});assert.ok(checks.some(x=>x.key==='HYDRA_INVITE_URL'&&!x.ok));assert.ok(checks.some(x=>x.key==='DIV_1_ALLIANCE_CHANNEL_ID'&&!x.ok));
 const optional=validateEnvironment({BOT_ENABLED:'false'});assert.ok(optional.some(x=>x.key==='HYDRA_INVITE_URL'&&x.ok));
});
