/* One safe renderer shared by the publication preview and the member mural. */
(()=>{
 'use strict';
 const make=(tag,className,text)=>{const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;};
 const url=value=>{try{const parsed=new URL(String(value));return parsed.protocol==='https:'?parsed.href:null;}catch{return null;}};
 function link(text,href){const target=url(href);if(!target)return document.createTextNode(text);const a=make('a',null,text);a.href=target;a.target='_blank';a.rel='noopener noreferrer';return a;}
 function inline(text,depth=0){
  const fragment=document.createDocumentFragment();text=String(text??'');if(depth>4){fragment.append(text);return fragment;}
  const tokens=/(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\|\|[^|\n]+\|\||\*[^*\n]+\*|_[^_\n]+_|\[[^\]\n]+\]\(https:\/\/[^\s)]+\)|<https:\/\/[^>\s]+>)/g;let from=0;
  for(const match of text.matchAll(tokens)){
   fragment.append(text.slice(from,match.index));const value=match[0];let node;
   if(value.startsWith('[')){const [,label,href]=value.match(/^\[([^\]]+)\]\((.+)\)$/);node=link(label,href);}
   else if(value.startsWith('<'))node=link(value.slice(1,-1),value.slice(1,-1));
   else if(value.startsWith('`'))node=make('code',null,value.slice(1,-1));
   else if(value.startsWith('||')){node=make('button','discord-spoiler');node.type='button';node.setAttribute('aria-label','Mostrar texto oculto');node.setAttribute('aria-expanded','false');const content=make('span',null,value.slice(2,-2));node.append(content);node.onclick=()=>{const shown=node.classList.toggle('revealed');node.setAttribute('aria-expanded',String(shown));node.setAttribute('aria-label',shown?'Ocultar texto':'Mostrar texto oculto');};}
   else{const pair=value.startsWith('**')||value.startsWith('__')||value.startsWith('~~');node=make(value.startsWith('**')?'strong':value.startsWith('__')?'u':value.startsWith('~~')?'s':'em');node.append(inline(value.slice(pair?2:1,pair?-2:-1),depth+1));}
   fragment.append(node);from=match.index+value.length;
  }fragment.append(text.slice(from));return fragment;
 }
 function markdown(value){
  const block=make('div','discord-markdown');const lines=String(value??'').replace(/\r\n/g,'\n').split('\n');let code=null,list=null;
  for(const line of lines){
   if(line.startsWith('```')){list=null;if(code){block.append(make('pre',null,code.join('\n')));code=null;}else code=[];continue;}
   if(code){code.push(line);continue;}
   if(/^\s*[-*] /.test(line)){if(!list){list=make('ul');block.append(list);}const item=make('li');item.append(inline(line.replace(/^\s*[-*] /,'')));list.append(item);continue;}list=null;
   const heading=line.match(/^(#{1,3}) (.*)$/);const node=make(heading?'h'+(heading[1].length+2):line.startsWith('> ')?'blockquote':'div','discord-line');node.append(inline(heading?heading[2]:line.replace(/^> /,'')));if(!line)node.append(make('br'));block.append(node);
  }if(code)block.append(make('pre',null,code.join('\n')));return block;
 }
 function picture(href,className,alt){const safe=url(href);if(!safe)return null;const img=make('img',className);img.src=safe;img.alt=alt;img.loading='lazy';img.referrerPolicy='no-referrer';img.onerror=()=>{img.removeAttribute('src');img.classList.add('unavailable');img.alt='Imagem indisponível';};return img;}
 function render(payload,options={}){
  const message=make('div','discord-message');const author=make('div','discord-message-author');author.append(make('span','discord-bot-avatar','RK'),make('strong',null,'HRISTE BOZE'),make('span','discord-app-tag','APP'));message.append(author);
  if(payload?.content)message.append(markdown(payload.content));
  for(const data of (Array.isArray(payload?.embeds)?payload.embeds:[]).slice(0,10)){
   const card=make('article','discord-embed');const color=Number(data.color);if(Number.isInteger(color)&&color>=0&&color<=16777215)card.style.borderLeftColor='#'+color.toString(16).padStart(6,'0');
   const body=make('div','discord-embed-body');
   if(data.thumbnail?.url){const thumb=picture(data.thumbnail.url,'discord-thumbnail','Miniatura do comunicado');if(thumb){body.classList.add('has-thumbnail');body.append(thumb);}}
   if(data.author?.name){const by=make('div','discord-embed-author');const icon=picture(data.author.icon_url,'discord-small-icon','');if(icon)by.append(icon);by.append(data.author.url?link(data.author.name,data.author.url):document.createTextNode(data.author.name));body.append(by);}
   if(data.title){const title=make('h3','discord-embed-title');title.append(data.url?link(data.title,data.url):document.createTextNode(data.title));body.append(title);}
   if(data.description)body.append(markdown(data.description));
   if(Array.isArray(data.fields)&&data.fields.length){const fields=make('div','discord-fields');for(const dataField of data.fields.slice(0,25)){const field=make('div','discord-field'+(dataField.inline?' inline':''));const name=make('div','discord-field-name');name.append(inline(dataField.name));field.append(name,markdown(dataField.value));fields.append(field);}body.append(fields);}
   card.append(body);const media=picture(data.image?.url,'discord-embed-image','Imagem do comunicado');if(media)card.append(media);
   if(data.footer?.text||data.timestamp){const footer=make('div','discord-embed-footer');const icon=picture(data.footer?.icon_url,'discord-small-icon','');if(icon)footer.append(icon);if(data.footer?.text)footer.append(make('span',null,data.footer.text));if(data.timestamp&&!Number.isNaN(new Date(data.timestamp).valueOf())){if(data.footer?.text)footer.append(make('span',null,'•'));const time=make('time',null,new Date(data.timestamp).toLocaleString('pt-BR'));time.dateTime=data.timestamp;footer.append(time);}card.append(footer);}
   message.append(card);
  }
  if(options.messageUrl){const href=url(options.messageUrl);if(href&&new URL(href).hostname==='discord.com'){const a=link('Abrir publicação no Discord ↗',href);a.className='discord-open-link';message.append(a);}}
  return message;
 }
 window.EmbedRenderer=Object.freeze({render,markdown,safeURL:url});
})();
