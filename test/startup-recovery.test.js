import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {DefaultRestOptions,Events} from 'discord.js';
import {createStartupGate,listenHttp} from '../src/startup-http.js';
import {connectDiscord,gatewayRestOptions} from '../src/discord-connection.js';
import {boot,reporter,StartupError} from '../src/preflight.js';

const close=server=>new Promise(resolve=>server.close(resolve));
test('Render status port stays closed to application traffic until activation, including a Discord pause',async()=>{
 const gate=createStartupGate(),server=await listenHttp(gate.handler,0),url='http://127.0.0.1:'+server.address().port;
 try{
  assert.equal((await fetch(url+'/health')).status,503);
  gate.wait(Date.now()+312000,async()=>{});
  const health=await fetch(url+'/health');assert.equal(health.status,200);assert.equal((await health.json()).ready,false);assert.ok(Number(health.headers.get('retry-after'))>=311);
  assert.equal((await fetch(url+'/api/members')).status,503);
  gate.wait(Date.now()+1000,async()=>{throw Error('db down');});assert.equal((await fetch(url+'/health')).status,503);
  gate.activate((_req,res)=>res.end('application'));assert.equal(await (await fetch(url+'/api/members')).text(),'application');
 }finally{await close(server);}
});
test('Gateway adapter preserves retry-after and leaves interaction callback requests untouched',async()=>{
 const response=new Response('limited',{status:429,headers:{'retry-after':'312'}}),calls=[];
 const original=mock.method(DefaultRestOptions,'makeRequest',async(url,init)=>{calls.push({url,init});return response;});
 try{
  const rest=gatewayRestOptions(),init={method:'GET',signal:new AbortController().signal};
  const result=await rest.makeRequest('https://discord.com/api/v10/gateway/bot',init);assert.equal(result.status,429);assert.equal(result.headers.get('retry-after'),'312');assert.equal((await result.json()).code,429);
  const interaction=await rest.makeRequest('https://discord.com/api/v10/interactions/123/private-token/callback',init);assert.equal(interaction,response);assert.equal(calls[1].init,init);
 }finally{original.mock.restore();}
});
test('connection waits for actual ready, cleans listeners, and exposes a safe retry deadline',async()=>{
 const client=new EventEmitter();let ready=false;client.isReady=()=>ready;client.login=async()=>{ready=true;client.emit(Events.ClientReady);};
 await connectDiscord(client,'private-token',{timeoutMs:1000,log:()=>{}});assert.equal(client.listenerCount(Events.ClientReady),0);
 ready=false;client.login=async()=>{throw {route:'/gateway/bot',retryAfter:312000,message:'private-token'};};
 await assert.rejects(connectDiscord(client,'private-token',{timeoutMs:1000,log:()=>{}}),e=>e.code==='DISCORD_RATE_LIMITED'&&e.retryAfterMs===312000&&!e.message.includes('private-token'));assert.equal(client.listenerCount(Events.ClientReady),0);
 const abort=new AbortController();abort.abort();let attempts=0;client.login=async()=>attempts++;
 await assert.rejects(connectDiscord(client,'private-token',{signal:abort.signal,log:()=>{}}),e=>e.code==='ABORT_ERR');assert.equal(attempts,0);
});
test('startup honors the pause and creates a fresh bot before activating the application once',async()=>{
 const events=[];let bots=0,handler,retryAt=0;
 const pool={query:async()=>({rows:[]}),end:async()=>events.push('pool end')};
 const env={NODE_ENV:'production',BOT_ENABLED:'true',APP_ORIGIN:'https://ifj.example.org',DATABASE_URL:'postgresql://user:password@db.example.org:5432/postgres?sslmode=verify-full',SESSION_SECRET:'test-safe-secret'.repeat(4),DISCORD_TOKEN:'fake-test-token-which-is-not-real'};
 const options={env,makePool:()=>pool,initialize:async()=>{},checks:{system:async()=>{},database:async()=>{},sbi:async()=>{}},log:reporter(()=>{}),listen:async fn=>{handler=fn;events.push('listen');return {close:cb=>cb()};},makeApp:()=>{events.push('app');return (_req,res)=>res.end('ready');},makeBot:()=>{const instance=++bots;return {start:async()=>{events.push('start '+instance);if(instance===1){retryAt=Date.now()+45;throw Object.assign(new StartupError('pause'),{code:'DISCORD_RATE_LIMITED',retryAfterMs:45});}assert.ok(Date.now()>=retryAt);},stop:async()=>events.push('stop '+instance),validate:async()=>events.push('validate '+instance),activate:()=>events.push('activate '+instance)};}};
 const running=await boot(options);assert.deepEqual(events,['listen','start 1','stop 1','start 2','validate 2','app','activate 2']);let body;await handler({}, {end:value=>body=value});assert.equal(body,'ready');await running.bot.stop();
});
