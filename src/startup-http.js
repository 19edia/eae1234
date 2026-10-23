import {createServer} from 'node:http';
export function createStartupGate(){
 let app=null,check=null,retryAt=0;
 return {handler:async(req,res)=>{if(app)return app(req,res);let ok=false;if(check&&req.url?.split('?')[0]==='/health')try{await check();ok=true;}catch{}res.writeHead(ok?200:503,{'Content-Type':'application/json','Cache-Control':'no-store','Retry-After':String(Math.max(5,Math.ceil((retryAt-Date.now())/1000)))});res.end(JSON.stringify({ok,ready:false,status:check?'waiting_discord':'starting',message:'O distrito está iniciando. Aguarde as verificações.'}));},activate:value=>{app=value;},wait:(at,health)=>{retryAt=at;check=health;},resume:()=>{retryAt=0;}};
}
export function listenHttp(handler,port){return new Promise((resolve,reject)=>{const server=createServer(handler);server.once('error',reject);server.listen(port,'0.0.0.0',()=>{server.off('error',reject);resolve(server);});});}
