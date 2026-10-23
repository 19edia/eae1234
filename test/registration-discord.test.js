import test from 'node:test';
import assert from 'node:assert/strict';
import {createRegistrationMemberSearch} from '../src/registration-discord.js';
const member=(id,bot=false)=>({user:{id,username:'kage.user',bot},displayName:'Kage',displayAvatarURL:()=>`https://cdn.discordapp.com/embed/avatars/0.png`});
const id='123456789012345678';
test('Discord registration searches configured guild, filters bots and returns real profiles',async()=>{
 const calls=[];
 const search=createRegistrationMemberSearch({isReady:()=>true,guilds:{fetch:async guild=>{calls.push(guild);return {members:{search:async options=>{assert.deepEqual(options,{query:'kage',limit:8});return new Map([[id,member(id)],['bot',member('223456789012345678',true)]]);}}};}}},{divisions:[{guild:'district'}],sourceGuilds:['old-server']});
 assert.deepEqual(await search('@kage'),[{id,username:'kage.user',display_name:'Kage',avatar_url:'https://cdn.discordapp.com/embed/avatars/0.png'}]);assert.deepEqual(calls,['district']);
});
test('Discord profile confirmation fetches current membership and handles members who left',async()=>{
 let gone=false;
 const search=createRegistrationMemberSearch({isReady:()=>true,guilds:{fetch:async()=>({members:{fetch:async options=>{assert.deepEqual(options,{user:id,force:true});if(gone)throw {code:10007};return member(id);}}})}},{divisions:[{guild:'district'}]});
 assert.equal((await search(id))[0].id,id);gone=true;assert.deepEqual(await search(id),[]);
});
test('Discord API errors are not reported as an absent member',async()=>{
 const search=createRegistrationMemberSearch({isReady:()=>true,guilds:{fetch:async()=>({members:{fetch:async()=>{throw {code:50001};}}})}},{divisions:[{guild:'district'}]});
 await assert.rejects(search(id),error=>error.code===50001);
});
test('Offline bot and unconfigured district never query a global user directory',async()=>{
 await assert.rejects(createRegistrationMemberSearch({isReady:()=>false},{divisions:[]})('kage'),{status:503});
 await assert.rejects(createRegistrationMemberSearch({isReady:()=>true},{divisions:[]})('kage'),{status:409});
});
