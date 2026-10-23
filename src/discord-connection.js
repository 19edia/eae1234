import {Events,DefaultRestOptions} from 'discord.js';
import {StartupError} from './preflight.js';
export const gatewayRestOptions=()=>({timeout:15000,retries:0,rejectOnRateLimit:['/gateway/bot'],makeRequest:async(url,init)=>{
 if(!/\/gateway\/bot(?:\?|$)/.test(String(url)))return DefaultRestOptions.makeRequest(url,init);
 const controller=new AbortController(),abort=()=>controller.abort();init.signal?.addEventListener('abort',abort,{once:true});
 let timer;const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Object.assign(Error('Consulta inicial ao Discord expirou.'),{code:'DISCORD_GATEWAY_TIMEOUT'}));},15000);});
 try{return await Promise.race([timeout,(async()=>{
  const res=await DefaultRestOptions.makeRequest(url,{...init,signal:controller.signal});
  const bytes=await res.arrayBuffer();if(bytes.byteLength>1024*1024)throw Error('Gateway response too large');
  let body;try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{body={message:'Discord Gateway HTTP error',code:res.status};}
  const headers={'content-type':'application/json'},retry=res.headers.get('retry-after');if(retry&&/^\d+(\.\d+)?$/.test(retry))headers['retry-after']=retry;
  return new Response(JSON.stringify(body),{status:res.status,headers});
 })()]);}finally{clearTimeout(timer);init.signal?.removeEventListener('abort',abort);}
}});
export function connectDiscord(client,token,{timeoutMs=90000,signal,log=console.info}={}){
 if(client.isReady())return Promise.resolve();
 return new Promise((resolve,reject)=>{
  let settled=false;const started=Date.now();
  const finish=error=>{if(settled)return;settled=true;clearTimeout(deadline);clearInterval(progress);clearInterval(poll);client.off(Events.ClientReady,ready);signal?.removeEventListener('abort',cancel);error?reject(error):resolve();};
  const ready=()=>{if(client.isReady())finish();};
  const cancel=()=>finish(Object.assign(new StartupError('Inicialização cancelada.'),{code:'ABORT_ERR'}));
  const deadline=setTimeout(()=>finish(new StartupError('Discord não ficou pronto em 90 segundos. Confira a conexão Gateway e as permissões do bot; o prazo não confirma token inválido.')),timeoutMs);
  const progress=setInterval(()=>log(`[DISCORD][CONEXÃO] Aguardando Gateway: ${Math.floor((Date.now()-started)/1000)} s.`),15000),poll=setInterval(ready,250);
  client.on(Events.ClientReady,ready);signal?.addEventListener('abort',cancel,{once:true});
  if(signal?.aborted){cancel();return;}
  log('[DISCORD][CONEXÃO] Iniciando conexão Gateway.');
  Promise.resolve().then(()=>client.login(token)).then(ready,error=>{
   if(error?.route==='/gateway/bot'&&Number(error.retryAfter)>0){const failure=new StartupError('A API do Discord pediu uma pausa antes de conectar.');failure.code='DISCORD_RATE_LIMITED';failure.retryAfterMs=Math.ceil(error.retryAfter);finish(failure);return;}
   const code=String(error.code??error.status??error.name);
   const label=error.message==='Used disallowed intents'||code==='4014'?'Ative Server Members Intent no Discord Developer Portal → Bot.':['TokenInvalid','401','4004'].includes(code)?'O Discord recusou o token do bot. Confira DISCORD_TOKEN no Render.':'Falha de conexão com o Discord. Confira rede, token e intents; detalhes privados foram omitidos.';
   finish(new StartupError(label));
  });
 });
}
