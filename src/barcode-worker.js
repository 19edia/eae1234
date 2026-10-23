import {parentPort,workerData} from 'node:worker_threads';
import {readFile} from 'node:fs/promises';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {prepareZXingModule,readBarcodes} from 'zxing-wasm/reader';
import {inspectCardImage,MAX_CARD_IMAGE_DIMENSION,MAX_CARD_IMAGE_PIXELS} from './barcode-image.js';
import {decodeHBCodeImage} from './hbcode.js';

// ZXing can merge identical Code128 symbols stacked in the bar direction into
// one bounding quadrilateral. A blank band between two bar fields still means
// two credentials; count physical regions, not only distinct decoded strings.
function hasSeparatedLegacyRegions(raster,result){
 const p=result.position;if(!p?.topLeft||!p?.topRight||!p?.bottomLeft||!p?.bottomRight)return false;
 const height=Math.hypot(p.bottomLeft.x-p.topLeft.x,p.bottomLeft.y-p.topLeft.y);
 const width=Math.hypot(p.topRight.x-p.topLeft.x,p.topRight.y-p.topLeft.y);
 const rows=Math.min(1024,Math.ceil(height)),cols=Math.min(768,Math.ceil(width));
 if(rows<5||cols<40)return false;
 let firstBand=false,band=0,gap=0,separated=false;
 const minGap=Math.max(2,Math.ceil(rows*.01));
 for(let y=0;y<=rows;y++){
  const t=y/rows,lx=p.topLeft.x+(p.bottomLeft.x-p.topLeft.x)*t,ly=p.topLeft.y+(p.bottomLeft.y-p.topLeft.y)*t;
  const rx=p.topRight.x+(p.bottomRight.x-p.topRight.x)*t,ry=p.topRight.y+(p.bottomRight.y-p.topRight.y)*t;
  let ink=0,transitions=0,previous;
  for(let x=0;x<cols;x++){
   const u=(x+.5)/cols,px=Math.round(lx+(rx-lx)*u),py=Math.round(ly+(ry-ly)*u);
   if(px<0||py<0||px>=raster.width||py>=raster.height)continue;
   const offset=4*(py*raster.width+px),dark=(raster.data[offset]+raster.data[offset+1]+raster.data[offset+2])<384;
   const value=result.isInverted?!dark:dark;
   if(value)ink++;if(previous!==undefined&&value!==previous)transitions++;previous=value;
  }
  const active=transitions>=20&&ink>cols*.1&&ink<cols*.9;
  if(active){
   if(gap>=minGap&&firstBand)separated=true;
   gap=0;band++;
   if(band>=3){if(separated)return true;firstBand=true;}
  }else{band=0;if(firstBand)gap++;}
 }
 return false;
}

try{
 const buffer=Buffer.from(workerData);inspectCardImage(buffer);
 const img=await loadImage(buffer);
 if(!img.width||!img.height||img.width>MAX_CARD_IMAGE_DIMENSION||img.height>MAX_CARD_IMAGE_DIMENSION||img.width*img.height>MAX_CARD_IMAGE_PIXELS)throw Object.assign(new Error('Dimensões da carteira fora do limite.'),{code:'CARD_IMAGE_DIMENSIONS'});
 const canvas=createCanvas(img.width,img.height),ctx=canvas.getContext('2d');
 ctx.fillStyle='#fff';ctx.fillRect(0,0,img.width,img.height);ctx.drawImage(img,0,0);
 const raster=ctx.getImageData(0,0,img.width,img.height);
 const hbcodes=decodeHBCodeImage(raster);
 if(hbcodes.length>1)throw Object.assign(new Error('Envie somente uma carteira por imagem.'),{code:'CARD_MULTIPLE_BARCODES'});
 // The exact matching wasm lives in the installed package. This never reaches a CDN.
 const wasm=await readFile(new URL('../node_modules/zxing-wasm/dist/reader/zxing_reader.wasm',import.meta.url));
 prepareZXingModule({overrides:{wasmBinary:wasm.buffer.slice(wasm.byteOffset,wasm.byteOffset+wasm.byteLength)}});
 const options={formats:['Code128'],tryHarder:true,tryRotate:true,tryInvert:true,tryDownscale:true,maxNumberOfSymbols:3};
 let legacyRaster=raster,results=await readBarcodes(legacyRaster,options);
 // Discord/mobile previews can shrink bars below two pixels. One bounded, smooth
 // enlargement recovers the edges while the original is still preferred.
 if(!hbcodes.length&&!results.some(result=>result.isValid)&&img.width*img.height<=2_500_000&&img.width<=3000&&img.height<=3000){
  const enlarged=createCanvas(img.width*2,img.height*2),e=enlarged.getContext('2d');
  e.imageSmoothingEnabled=true;e.imageSmoothingQuality='high';e.drawImage(canvas,0,0,enlarged.width,enlarged.height);
  legacyRaster=e.getImageData(0,0,enlarged.width,enlarged.height);
  results=await readBarcodes(legacyRaster,{...options,tryDownscale:false});
 }
 const valid=results.filter(result=>result.isValid&&result.format==='Code128');
 if(valid.some(result=>hasSeparatedLegacyRegions(legacyRaster,result)))throw Object.assign(new Error('Envie somente uma carteira por imagem.'),{code:'CARD_MULTIPLE_BARCODES'});
 const count=hbcodes.length+valid.length;
 if(count!==1)throw Object.assign(new Error(count>1?'Envie somente uma carteira por imagem.':'Não consegui ler o HBCode. Envie a carteira completa, de preferência o PNG original.'),{code:count>1?'CARD_MULTIPLE_BARCODES':'CARD_BARCODE_UNREADABLE'});
 const payload=hbcodes[0]??valid[0].text;
 if(!/^7201\d{56}$/.test(payload))throw Object.assign(new Error('O código não pertence a uma carteira HB-ID.'),{code:'CARD_BARCODE_INVALID'});
 parentPort.postMessage({ok:true,payload});
}catch(err){const known=typeof err.code==='string'&&err.code.startsWith('CARD_');parentPort.postMessage({ok:false,code:known?err.code:'CARD_IMAGE_INVALID',message:known?err.message:'A imagem não pôde ser aberta. Envie a carteira como PNG, JPEG ou WebP.'});}
