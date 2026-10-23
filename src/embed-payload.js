// Discord limits: https://discord.com/developers/docs/resources/message#embed-object-embed-limits
import {isIP} from 'node:net';

const invalid=message=>Object.assign(new Error(message),{status:400,code:'INVALID_EMBED'});
const own=(object,key)=>Object.hasOwn(object,key);
const record=(value,label)=>{
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw invalid(`${label}: informe um objeto JSON.`);
 return value;
};
function keys(object,allowed,label){
 const extra=Object.keys(object).find(key=>!allowed.includes(key));
 if(extra)throw invalid(`${label}: o campo “${extra}” não é permitido.`);
}
function string(value,label,max){
 if(typeof value!=='string'||!value.trim()||value.length>max)throw invalid(`${label}: use de 1 a ${max} caracteres.`);
 return value;
}
function publicUrl(value,label){
 string(value,label,2048);
 let url;try{url=new URL(value);}catch{throw invalid(`${label}: informe uma URL HTTPS válida.`);}
 const host=url.hostname.toLowerCase();
 // Images are displayed by the member's browser; never permit local-network URLs.
 if(url.protocol!=='https:'||url.username||url.password||isIP(host.replace(/^\[|\]$/g,''))||!host.includes('.')||host.endsWith('.')||/(^|\.)(localhost|local|internal|test|invalid)$/.test(host))throw invalid(`${label}: use uma URL HTTPS pública, sem usuário ou senha.`);
 return url.href;
}
function media(value,label){
 const source=record(value,label);keys(source,['url'],label);
 return {url:publicUrl(source.url,`${label} · URL`)};
}
function color(value,label){
 if(typeof value==='string'&&/^(?:#|0x)[\da-f]{6}$/i.test(value))value=parseInt(value.replace(/^(?:#|0x)/i,''),16);
 if(!Number.isInteger(value)||value<0||value>0xffffff)throw invalid(`${label}: use um número entre 0 e 16777215 ou uma cor #RRGGBB.`);
 return value;
}
function normalizeEmbed(value,index){
 const label=`Embed ${index+1}`,source=record(value,label),out={};
 keys(source,['type','title','description','url','timestamp','color','footer','image','thumbnail','author','fields'],label);
 if(own(source,'type')&&source.type!=='rich')throw invalid(`${label}: apenas embeds do tipo rich são aceitos.`);
 for(const [key,max]of [['title',256],['description',4096]])if(own(source,key))out[key]=string(source[key],`${label} · ${key}`,max);
 if(own(source,'url'))out.url=publicUrl(source.url,`${label} · URL`);
 if(own(source,'color'))out.color=color(source.color,`${label} · Cor`);
 if(own(source,'timestamp')){
  if(typeof source.timestamp!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(source.timestamp)||!Number.isFinite(Date.parse(source.timestamp)))throw invalid(`${label} · timestamp: use uma data ISO 8601 válida.`);
  out.timestamp=new Date(source.timestamp).toISOString();
 }
 for(const key of ['thumbnail','image'])if(own(source,key))out[key]=media(source[key],`${label} · ${key}`);
 if(own(source,'author')){
  const author=record(source.author,`${label} · author`);keys(author,['name','url','icon_url'],`${label} · author`);
  out.author={name:string(author.name,`${label} · Autor`,256)};
  if(own(author,'url'))out.author.url=publicUrl(author.url,`${label} · Link do autor`);
  if(own(author,'icon_url'))out.author.icon_url=publicUrl(author.icon_url,`${label} · Ícone do autor`);
 }
 if(own(source,'footer')){
  const footer=record(source.footer,`${label} · footer`);keys(footer,['text','icon_url'],`${label} · footer`);
  out.footer={text:string(footer.text,`${label} · Rodapé`,2048)};
  if(own(footer,'icon_url'))out.footer.icon_url=publicUrl(footer.icon_url,`${label} · Ícone do rodapé`);
 }
 if(own(source,'fields')){
  if(!Array.isArray(source.fields)||source.fields.length>25)throw invalid(`${label}: use no máximo 25 campos.`);
  if(source.fields.length)out.fields=source.fields.map((value,n)=>{
   const labelField=`${label} · Campo ${n+1}`,field=record(value,labelField);keys(field,['name','value','inline'],labelField);
   const item={name:string(field.name,`${labelField} · Nome`,256),value:string(field.value,`${labelField} · Valor`,1024)};
   if(own(field,'inline')){if(typeof field.inline!=='boolean')throw invalid(`${labelField}: inline deve ser true ou false.`);item.inline=field.inline;}
   return item;
  });
 }
 if(!['title','description','image','thumbnail','author','footer','fields'].some(key=>out[key]))throw invalid(`${label}: inclua um título, texto, campo ou imagem.`);
 return out;
}

export function embedCharacterCount(payload){
 return (payload.embeds||[]).reduce((sum,embed)=>sum+(embed.title?.length||0)+(embed.description?.length||0)+(embed.author?.name?.length||0)+(embed.footer?.text?.length||0)+(embed.fields||[]).reduce((total,field)=>total+field.name.length+field.value.length,0),0);
}

/** Accept a single API embed or a message {content, embeds}; always disable pings. */
export function normalizeEmbedPayload(input){
 let source=input;
 try{
  const serialized=typeof input==='string'?input:JSON.stringify(input);
  if(typeof serialized!=='string'||Buffer.byteLength(serialized,'utf8')>98304)throw invalid('O JSON deve ter no máximo 96 KB.');
  if(typeof source==='string')source=JSON.parse(source);
 }catch(error){if(error.code==='INVALID_EMBED')throw error;throw invalid('JSON inválido. Confira as aspas, vírgulas e chaves.');}
 record(source,'Mensagem');
 const envelope=own(source,'embeds')||own(source,'content');
 const out={};
 if(envelope){
  keys(source,['content','embeds','allowed_mentions','allowedMentions'],'Mensagem');
  if(own(source,'content')&&source.content!=='')out.content=string(source.content,'Mensagem · Conteúdo',2000);
  if(own(source,'embeds')&&(!Array.isArray(source.embeds)||source.embeds.length>10))throw invalid('A mensagem pode ter no máximo 10 embeds.');
  out.embeds=(source.embeds||[]).map(normalizeEmbed);
 }else out.embeds=[normalizeEmbed(source,0)];
 if(!out.content&&!out.embeds.length)throw invalid('Inclua pelo menos um embed ou uma mensagem.');
 if(embedCharacterCount(out)>6000)throw invalid('O texto de todos os embeds juntos deve ter no máximo 6000 caracteres.');
 const urls=out.embeds.map(embed=>embed.url).filter(Boolean);
 if(new Set(urls).size!==urls.length)throw invalid('Use URLs de título diferentes: o Discord oculta embeds que repetem a mesma URL.');
 out.allowedMentions={parse:[]};
 return out;
}
