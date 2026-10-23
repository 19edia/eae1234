/* Avatars come only from the confirmed Discord account. Names remain the site's. */
(()=>{
 'use strict';
 const active=new WeakMap();
 function initials(name){return String(name||'RK').trim().split(/\s+/).slice(0,2).map(part=>Array.from(part)[0]||'').join('').toLocaleUpperCase('pt-BR')||'RK';}
 function avatarURL(value,discordId){
  try{
   const url=new URL(value),id=String(discordId||'');
   if(!/^[0-9]{17,20}$/.test(id)||url.protocol!=='https:'||url.username||url.password||url.port||!['cdn.discordapp.com','media.discordapp.net'].includes(url.hostname))return null;
   const path=url.pathname;
   if(!new RegExp('^/avatars/'+id+'/[a-zA-Z0-9_]+\\.(png|jpe?g|webp|gif)$').test(path)&&!/^\/embed\/avatars\/[0-5]\.png$/.test(path)&&!new RegExp('^/guilds/[0-9]{17,20}/users/'+id+'/avatars/[a-zA-Z0-9_]+\\.(png|jpe?g|webp|gif)$').test(path))return null;
   return url.href;
  }catch{return null;}
 }
 function render(node,{profile=null,name='',discordId=''}={}){
  if(!node)return;
  const previous=active.get(node);if(previous?.image){previous.image.onload=null;previous.image.onerror=null;previous.image.removeAttribute('src');}
  const state={image:null};active.set(node,state);node.classList.add('discord-avatar');node.replaceChildren(document.createTextNode(initials(name)));node.removeAttribute('title');
  if(!profile||String(profile.id)!==String(discordId))return;
  const url=avatarURL(profile.avatar_url,discordId);if(!url)return;
  const image=document.createElement('img');state.image=image;image.alt='';image.decoding='async';image.referrerPolicy='no-referrer';
  image.onload=()=>{if(active.get(node)!==state)return;node.replaceChildren(image);node.title='Foto do perfil no Discord';};
  image.onerror=()=>{if(active.get(node)!==state)return;image.onload=null;image.onerror=null;image.removeAttribute('src');node.replaceChildren(document.createTextNode(initials(name)));node.removeAttribute('title');};
  image.src=url;
 }
 async function request(path,controller){
  const timer=setTimeout(()=>controller.abort(),12000);
  try{const response=await fetch(path,{credentials:'same-origin',cache:'no-store',signal:controller.signal});if(!response.ok)throw new Error('Perfil indisponível.');return await response.json();}
  finally{clearTimeout(timer);}
 }
 window.DiscordProfileAvatar=Object.freeze({render,initials,request,avatarURL});
})();
