import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createMemberCards} from '../src/member-card.js';

const guild='111111111111111111',discord='222222222222222222';
function fixture(session){
 const member={id:1,discord_id:discord,verified:true,card_revoked_at:null,idrkc:'1042000000000042',identity_version:1};
 const pool={async query(sql){if(sql.startsWith('SELECT * FROM members'))return {rows:[member],rowCount:1};if(sql.startsWith('SELECT * FROM tryout_sessions'))return {rows:session?[session]:[],rowCount:session?1:0};return {rows:[],rowCount:0};},async connect(){return {...this,release(){}};}};
 let rendered=0,sent=0,reply;
 const cards=createMemberCards(pool,{tryouts:{enabled:true},divisions:[{guild}]},{},{render:async()=>{rendered++;return Buffer.from('png');}});
 const interaction={isChatInputCommand:()=>true,commandName:'ver-sua-carteira',guildId:guild,id:'333333333333333333',user:{id:discord,send:async()=>{sent++;}},deferReply:async()=>{},editReply:async value=>{reply=value.content;}};
 return {cards,interaction,result:()=>({rendered,sent,reply})};
}
test('verified manual identity cannot receive wallet without completed mandatory tryout signup',async()=>{
 for(const session of [null,{status:'passed',registration_deadline:new Date(Date.now()+3600000)},{status:'failed'},{status:'expired'}]){
  const f=fixture(session);await f.cards.interact(f.interaction);assert.equal(f.result().rendered,0);assert.equal(f.result().sent,0);assert.match(f.result().reply,/cadastro obrigatório/);
 }
});
test('completed tryout bound to the member allows wallet delivery',async()=>{
 const f=fixture({status:'registered',member_id:1});await f.cards.interact(f.interaction);assert.equal(f.result().rendered,1);assert.equal(f.result().sent,1);assert.match(f.result().reply,/enviada/);
});
