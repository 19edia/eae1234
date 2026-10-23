import {readConfig} from './config.js';
import {StartupError} from './preflight.js';
// Kept for existing Render Start Commands. SBI uses the ordinary application
// and database, so /criar remains available without a second installer process.
export function setupConfig(env){
 if(!env.DISCORD_TOKEN||env.DISCORD_TOKEN.length<30||/\s/.test(env.DISCORD_TOKEN))throw new StartupError('Configure DISCORD_TOKEN real para usar /criar.');
 return readConfig(env);
}
export async function runSetup(){
 console.log('[SBI] O comando configurar agora inicia o painel e o banco. Execute /criar no servidor do distrito; os IDs serão salvos automaticamente.');
 return import('./server.js');
}
