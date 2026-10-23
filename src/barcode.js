import {Worker} from 'node:worker_threads';
import {renderHBCode} from './hbcode.js';
import {inspectCardImage} from './barcode-image.js';
export {MAX_CARD_IMAGE_BYTES,MAX_CARD_IMAGE_PIXELS,MAX_CARD_IMAGE_DIMENSION,inspectCardImage} from './barcode-image.js';

export async function renderCardBarcode(payload){
 // Keep the existing API used by issuance, Discord and the member portal.
 // Newly rendered credentials use HBCode; signed legacy Code128 remains readable.
 return renderHBCode(payload);
}
let runningDecoders=0;
const error=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
export async function decodeCardBarcode(buffer){
 inspectCardImage(buffer);
 // One raster decoder at a time keeps native/WASM allocations bounded on Render's
 // small instances. The caller can immediately reply and let a member retry.
 if(runningDecoders>=1)throw error('CARD_DECODER_BUSY','Há outra carteira sendo verificada. Aguarde alguns segundos e tente novamente.',503);
 runningDecoders++;
 let worker,timer;
 try{
  return await new Promise((resolve,reject)=>{
   let settled=false;
   const finish=(err,value)=>{if(settled)return;settled=true;clearTimeout(timer);err?reject(err):resolve(value);};
   worker=new Worker(new URL('./barcode-worker.js',import.meta.url),{workerData:buffer,resourceLimits:{maxOldGenerationSizeMb:128,maxYoungGenerationSizeMb:16},execArgv:[]});
   timer=setTimeout(()=>finish(error('CARD_DECODE_TIMEOUT','A leitura da carteira demorou demais. Envie o PNG original recebido pelo bot.')),8000);
   worker.once('message',result=>result.ok?finish(null,result.payload):finish(error(result.code||'CARD_BARCODE_UNREADABLE',result.message||'Não foi possível ler o código. Envie a carteira original.')));
   worker.once('error',()=>finish(error('CARD_BARCODE_UNREADABLE','Não foi possível ler a carteira. Envie o arquivo PNG original recebido pelo bot.')));
   worker.once('exit',code=>{if(!settled)finish(error('CARD_BARCODE_UNREADABLE','Não foi possível ler a carteira. Envie o arquivo PNG original recebido pelo bot.'));});
  });
 }finally{clearTimeout(timer);if(worker)await worker.terminate().catch(()=>{});runningDecoders--;}
}
