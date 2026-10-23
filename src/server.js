import {database,initialize} from './db.js';
import {createApp} from './app.js';
import {createBot} from './bot.js';
import {boot,reporter} from './preflight.js';
const log=reporter();
import {listenHttp} from './startup-http.js';
let running,stopping=false;const shutdown=new AbortController();
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,async()=>{if(stopping)return;stopping=true;shutdown.abort();setTimeout(()=>process.exit(0),10000).unref();if(running){running.server.close();try{await running.bot.stop();await running.pool.end();}finally{process.exit(0);}}});
try{
 running=await boot({makePool:database,initialize,makeBot:createBot,makeApp:createApp,log,
  listen:listenHttp,signal:shutdown.signal});
}catch{process.exit(stopping?0:1);}
