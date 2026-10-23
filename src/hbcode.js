import {createCanvas,loadImage} from '@napi-rs/canvas';
import {HBCODE,HBCODE_MARKERS,hbcodeSvg,decodeHBCodeBytes} from '../public/hbcode-codec.js';
export {HBCODE,encodeHBCode,decodeHBCodeBytes,hbcodeSvg} from '../public/hbcode-codec.js';

export async function renderHBCode(payload){
 const image=await loadImage(Buffer.from(hbcodeSvg(payload)));
 const canvas=createCanvas(HBCODE.width,HBCODE.height);canvas.getContext('2d').drawImage(image,0,0);
 return canvas.encode('png');
}
const isGold=(r,g,b)=>r>=110&&g>=80&&g>=b*1.3&&r>=g*.92;
const invalid=()=>Object.assign(new Error('O HBCode foi alterado ou está danificado. Envie a carteira original.'),{code:'CARD_HBCODE_INVALID'});
const complexity=()=>Object.assign(new Error('A imagem contém detalhes demais para uma leitura segura. Envie somente a carteira original.'),{code:'CARD_HBCODE_COMPLEXITY'});
const MAX_COMPONENTS=250000,MAX_FRAMES=256,MAX_SEARCH_STEPS=1000000,MAX_HYPOTHESES=4096;

// Locate isolated, connected gold frames. Data cells, glyphs, and ornamentation
// have different extents/fill ratios and cannot by themselves form four locators.
function locateFrames(data,width,height){
 const mask=new Uint8Array(width*height);
 for(let i=0,p=0;i<mask.length;i++,p+=4)mask[i]=isGold(data[p],data[p+1],data[p+2])?1:0;
 // The frontier is capped at 1 MiB instead of allocating another full raster.
 // Budget exhaustion rejects the entire image, never a partial symbol list.
 const frames=[],stack=new Int32Array(Math.max(8,Math.min(width*height,262144)));
 let components=0;
 for(let pos=0;pos<mask.length;pos++){
  if(!mask[pos])continue;
  if(++components>MAX_COMPONENTS)throw complexity();
  let n=1,area=0,xmin=width,xmax=0,ymin=height,ymax=0;stack[0]=pos;mask[pos]=0;
  while(n){
   const p=stack[--n],x=p%width,y=Math.floor(p/width);area++;
   xmin=Math.min(xmin,x);xmax=Math.max(xmax,x);ymin=Math.min(ymin,y);ymax=Math.max(ymax,y);
   if(n+4>stack.length)throw complexity();
   if(x&&mask[p-1]){mask[p-1]=0;stack[n++]=p-1;}
   if(x+1<width&&mask[p+1]){mask[p+1]=0;stack[n++]=p+1;}
   if(y&&mask[p-width]){mask[p-width]=0;stack[n++]=p-width;}
   if(y+1<height&&mask[p+width]){mask[p+width]=0;stack[n++]=p+width;}
  }
  const w=xmax-xmin+1,h=ymax-ymin+1,fill=area/(w*h);
  if(w>=10&&h>=10&&w<=600&&h<=600&&w/h>.15&&w/h<6.5&&fill>.13&&fill<.48){
   // Bounding-box centres remain symmetric when antialiasing gives opposite
   // frame edges different pixel weights, notably at 80% export size.
   frames.push({x:(xmin+xmax+1)/2,y:(ymin+ymax+1)/2,w,h});
   if(frames.length>MAX_FRAMES)throw complexity();
  }
 }
 return frames;
}
function goldAt(data,width,height,x,y){
 x=Math.floor(x);y=Math.floor(y);if(x<0||y<0||x>=width||y>=height)return false;
 const i=(y*width+x)*4;return isGold(data[i],data[i+1],data[i+2]);
}
const similar=(a,b)=>Math.abs(Math.log(a.w/b.w))<.35&&Math.abs(Math.log(a.h/b.h))<.35;
export function decodeHBCodeImage({data,width,height}){
 if(!data||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>16000000||data.length!==width*height*4)throw Object.assign(new Error('Imagem de HBCode inválida.'),{code:'CARD_IMAGE_INVALID'});
 const frames=locateFrames(data,width,height),regions=new Set(),payloads=[],invalidRegions=[],successfulFrames=new Set();
 let hypotheses=0,searchSteps=0;
 const close=(x,y,tol,exclude)=>{
  let found=-1,best=Infinity;
  for(let i=0;i<frames.length;i++){
   if(++searchSteps>MAX_SEARCH_STEPS)throw complexity();
   const f=frames[i],dx=Math.abs(f.x-x),dy=Math.abs(f.y-y);
   if(!exclude.includes(i)&&dx<=tol&&dy<=tol&&dx+dy<best){found=i;best=dx+dy;}
  }
  return found;
 };
 for(let ai=0;ai<frames.length;ai++)for(let bi=0;bi<frames.length;bi++){
  if(++searchSteps>MAX_SEARCH_STEPS)throw complexity();
  if(ai===bi)continue;const a=frames[ai],b=frames[bi];if(!similar(a,b))continue;
  const vx=b.x-a.x,vy=b.y-a.y,d=Math.hypot(vx,vy),ex=Math.abs(vx/d)*a.w+Math.abs(vy/d)*a.h;
  if(d/ex<1.18||d/ex>1.95)continue;
  for(let ci=0;ci<frames.length;ci++){
   if(++searchSteps>MAX_SEARCH_STEPS)throw complexity();
   if(ci===ai||ci===bi)continue;const c=frames[ci];if(!similar(a,c))continue;
   const ux=c.x-a.x,uy=c.y-a.y,length=Math.hypot(ux,uy),horizontalExtent=Math.abs(ux/length)*a.w+Math.abs(uy/length)*a.h;
   if(length<d*3||length/horizontalExtent<15||length/horizontalExtent>45||Math.abs((ux*vx+uy*vy)/(length*d))>.18)continue;
   const di=close(b.x+ux,b.y+uy,Math.max(2,d*.12),[ai,bi,ci]);if(di<0)continue;
   if(++hypotheses>MAX_HYPOTHESES)throw complexity();
   const indices=[ai,bi,ci,di],key=[...indices].sort((x,y)=>x-y).join(',');if(regions.has(key))continue;
   const project=(x,y)=>[a.x+(x-24)*ux/902+(y-24)*vx/40,a.y+(x-24)*uy/902+(y-24)*vy/40];
   const sample=(x,y)=>{const [px,py]=project(x,y);return goldAt(data,width,height,px,py);};
   let score=0,lowest=1;
   for(const marker of HBCODE_MARKERS){let matches=0;
    marker.bits.forEach((row,y)=>[...row].forEach((bit,x)=>{if(sample(marker.x-6+x*2,marker.y-6+y*2)===(bit==='1'))matches++;}));
    score+=matches;lowest=Math.min(lowest,matches/49);
   }
   if(score/196<.86||lowest<.73)continue;
   regions.add(key);
   let decoded;
   try{
    const copies=[];
    for(const left of [HBCODE.left,HBCODE.right]){
     const bytes=new Uint8Array(37);
     for(let i=0;i<296;i++){
      const x=left+(i%37)*9,y=HBCODE.top+Math.floor(i/37)*8;
      let gold=0;for(const [dx,dy]of [[0,0],[-.8,0],[.8,0],[0,-.8],[0,.8]])if(sample(x+dx,y+dy))gold++;
      if(gold>=3)bytes[i>>>3]|=1<<(7-(i&7));
     }
     copies.push(decodeHBCodeBytes(bytes));
    }
    if(copies[0]!==copies[1])throw invalid();decoded=copies[0];
   }catch(error){
    if(error.code!=='CARD_HBCODE_INVALID')throw error;
    invalidRegions.push(indices);continue;
   }
   if(indices.some(index=>successfulFrames.has(index)))throw invalid();
   indices.forEach(index=>successfulFrames.add(index));payloads.push(decoded);
  }
 }
 // Vertically aligned cards can form a spurious quadrilateral using two
 // locators from each card. Ignore that failure only if every locator belongs
 // to an independently validated symbol. Any damaged/unresolved symbol fails.
 if(invalidRegions.some(indices=>indices.some(index=>!successfulFrames.has(index))))throw invalid();
 return payloads;
}
