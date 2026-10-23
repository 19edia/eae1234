(()=>{
 'use strict';
 const $=id=>document.getElementById(id),rawToken=location.pathname.match(/^\/cadastro\/([a-f0-9]{64})\/?$/)?.[1];
 const state={csrf:null,invite:null,details:null,discord:null,selected:null,codeExpires:0,resendAt:0,busy:false,step:'details',success:null,redirectAt:0,redirectRemaining:15,paused:false,downloading:false};
 const steps=['details','discord','verify'];
 let clockTimer;
 function message(value,kind='error',target='flow-message'){const box=$(target);box.textContent=value||'';box.dataset.kind=kind;box.hidden=!value;}
 function unavailable(error){$('loading').hidden=true;$('registration-flow').hidden=true;$('registration-success').hidden=true;$('unavailable').hidden=false;$('unavailable-message').textContent=error.message||'Não foi possível abrir seu convite.';$('reload-invite').hidden=[404,410].includes(error.status);$('unavailable-title').focus();}
 function syncButtons(){
  document.querySelectorAll('#registration-flow button').forEach(button=>{button.disabled=state.busy;});
  const remaining=Math.max(0,Math.ceil((state.resendAt-Date.now())/1000));
  $('send-code').disabled=state.busy||!state.selected||!$('discord-consent').checked||remaining>0;
  if(!state.busy)$('send-code').textContent=remaining?`Novo código disponível em ${remaining}s`:'Este é meu perfil. Enviar código →';
  $('resend-code').disabled=state.busy||!state.discord||remaining>0;$('resend-code').textContent=remaining?`Reenviar em ${remaining}s`:'Reenviar código';
  $('complete-registration').disabled=state.busy||state.codeExpires<=Date.now();
  $('registration-main').setAttribute('aria-busy',String(state.busy));
 }
 async function api(path='',data){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
  try{
   const response=await fetch(`/api/registration/${rawToken}${path}`,{credentials:'same-origin',headers:{Accept:'application/json',...(data===undefined?{}:{'Content-Type':'application/json','X-Registration-CSRF':state.csrf})},method:data===undefined?'GET':'POST',...(data===undefined?{}:{body:JSON.stringify(data)}),signal:controller.signal});
   const body=await response.json().catch(()=>({error:'O servidor respondeu de forma inesperada. Tente novamente.'}));
   if(!response.ok)throw Object.assign(new Error(body.error||'Não foi possível concluir. Tente novamente.'),{status:response.status});
   return body;
  }catch(error){if(error.name==='AbortError')throw Object.assign(new Error('A resposta demorou mais que o esperado. Confira sua conexão e tente novamente.'),{network:true});if(error instanceof TypeError)error.network=true;throw error;}
  finally{clearTimeout(timer);}
 }
 async function run(button,loading,action){
  if(state.busy)return;state.busy=true;message('');const label=button?.textContent;if(button)button.textContent=loading;syncButtons();
  try{await action();}catch(error){if(error.status===410)unavailable(error);else message(error.network?'Não foi possível confirmar a resposta do servidor. Confira sua conexão e tente novamente.':error.message);}
  finally{state.busy=false;if(button)button.textContent=label;syncButtons();}
 }
 function showStep(step,{focus=true}={}){
  state.step=step;for(const name of steps)$(`step-${name}`).hidden=name!==step;
  document.querySelectorAll('#stepper li').forEach((item,index)=>{item.classList.toggle('done',index<steps.indexOf(step));if(item.dataset.step===step)item.setAttribute('aria-current','step');else item.removeAttribute('aria-current');});
  $('details-restart-help').hidden=!state.codeExpires;
  message('');syncButtons();if(focus){$(`${step}-title`).focus({preventScroll:true});if(window.innerWidth<=800)$('registration-flow').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});}
 }
 function safeAvatar(value){try{const url=new URL(value);return url.protocol==='https:'&&['cdn.discordapp.com','media.discordapp.net'].includes(url.hostname)&&!url.username&&!url.password?url.href:null;}catch{return null;}}
 function profileNode(profile){
  const fragment=document.createDocumentFragment(),avatarUrl=safeAvatar(profile.avatar_url),avatar=document.createElement(avatarUrl?'img':'span');avatar.className='profile-avatar';
  if(avatarUrl){avatar.src=avatarUrl;avatar.alt='';avatar.referrerPolicy='no-referrer';avatar.addEventListener('error',()=>{const fallback=document.createElement('span');fallback.className='profile-avatar';fallback.textContent=(profile.display_name||profile.username||'?').slice(0,2).toUpperCase();avatar.replaceWith(fallback);},{once:true});}
  else{avatar.textContent=(profile.display_name||profile.username||'?').slice(0,2).toUpperCase();avatar.setAttribute('aria-hidden','true');}
  const copy=document.createElement('span');copy.className='profile-copy';const title=document.createElement('strong'),username=document.createElement('small');title.textContent=profile.display_name||profile.username;username.textContent=`@${profile.username}`;copy.append(title,username);fragment.append(avatar,copy);return fragment;
 }
 function selectProfile(profile){state.selected=profile;$('discord-consent').checked=false;$('selected-profile').replaceChildren(profileNode(profile));$('discord-confirm-form').hidden=false;document.querySelectorAll('.profile-option').forEach(button=>{const selected=button.dataset.profile===profile.id;button.setAttribute('aria-pressed',String(selected));button.querySelector('.profile-choice').textContent=selected?'✓':'↗';});syncButtons();}
 function renderResults(profiles){
  const list=$('discord-results');list.replaceChildren();
  for(const profile of profiles){const button=document.createElement('button');button.type='button';button.className='profile-option';button.dataset.profile=profile.id;button.setAttribute('aria-pressed',String(state.selected?.id===profile.id));button.setAttribute('aria-label',`Escolher ${profile.display_name||profile.username}, @${profile.username}`);button.append(profileNode(profile));const arrow=document.createElement('span');arrow.className='profile-choice';arrow.setAttribute('aria-hidden','true');arrow.textContent=state.selected?.id===profile.id?'✓':'↗';button.append(arrow);button.addEventListener('click',()=>selectProfile(profile));list.append(button);}
  $('search-state').textContent=profiles.length?`${profiles.length} ${profiles.length===1?'perfil encontrado. Escolha seu perfil.':'perfis encontrados. Escolha seu perfil.'}`:'Nenhum perfil encontrado. Confira o nome e se você já está no servidor da guilda.';
 }
 function updateCodeClock(){
  if(!state.codeExpires){syncButtons();return;}
  const seconds=Math.max(0,Math.ceil((state.codeExpires-Date.now())/1000));
  $('code-expiry').textContent=seconds?`Código válido por ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}.`:'O código expirou. Solicite outro para continuar.';syncButtons();
 }
 function verification(profile,expires){state.discord=profile;state.selected=profile;state.codeExpires=Date.parse(expires)||0;$('verification-profile').replaceChildren(profileNode(profile));$('registration-code').value='';showStep('verify');updateCodeClock();}
 async function sendCode(){const result=await api('/discord/start',{discord_id:state.selected.id});state.resendAt=Date.now()+60000;verification(result.discord,result.expires_at);message(result.message||'Código enviado no privado do seu Discord.','info');}
 function updateStrength(){
  const value=$('registration-password').value;let score=0;
  if(value.length>=12)score=1;if(value.length>=16)score=2;if(value.length>=20||value.length>=12&&/[a-z]/i.test(value)&&/\d/.test(value)&&/[^\w\s]/.test(value))score=3;if(value.length>=24||value.length>=16&&/[A-Z]/.test(value)&&/[a-z]/.test(value)&&/\d/.test(value)&&/[^\w\s]/.test(value))score=4;
  $('password-strength').dataset.strength=String(score);$('password-help').textContent=!value?'Uma frase longa com palavras e números ajuda a proteger sua conta.':value.length<12?`Use pelo menos 12 caracteres. Faltam ${12-value.length}.`:score<3?'Bom começo. Adicione mais palavras ou combine letras, números e símbolos.':'Boa combinação. Guarde sua senha em um lugar seguro.';
  $('registration-password-confirm').setCustomValidity('');
 }
 function success(result){
  state.success=result;state.redirectRemaining=15;state.redirectAt=Date.now()+15000;state.paused=false;
  $('registration-flow').hidden=true;$('unavailable').hidden=true;$('loading').hidden=true;$('registration-success').hidden=false;
  $('success-greeting').textContent=`${result.member.name}, sua conta está pronta. Sua identidade agora faz parte da HRISTE BOZE.`;
  $('issued-idrkc').textContent=String(result.member.idrkc).replace(/(.{4})(?=.)/g,'$1 ');$('issued-name').textContent=result.member.name;$('issued-rank').textContent=result.member.member_rank;
  $('registration-password').value='';$('registration-password-confirm').value='';$('registration-code').value='';$('success-title').focus({preventScroll:true});$('registration-success').scrollIntoView({behavior:'auto',block:'start'});updateRedirect();
 }
 function updateRedirect(){
  if(!state.success||state.paused||state.downloading)return;
  state.redirectRemaining=Math.max(0,Math.ceil((state.redirectAt-Date.now())/1000));$('redirect-seconds').textContent=String(state.redirectRemaining);
  if(state.redirectRemaining===0){clearInterval(clockTimer);location.assign('/membros');}
 }
 function renderRedirectNote(){
  $('redirect-text').replaceChildren();
  if(state.paused)$('redirect-text').textContent='Fique à vontade. Entre no painel quando quiser.';
  else if(state.downloading)$('redirect-text').textContent='Preparando sua carteira. O redirecionamento está pausado.';
  else{const number=document.createElement('strong');number.id='redirect-seconds';number.textContent=String(state.redirectRemaining);$('redirect-text').append('Você irá para seu painel em ',number,' segundos.');}
  $('pause-redirect').textContent=state.paused?'Retomar ida ao painel':'Pausar e ficar aqui';$('pause-redirect').setAttribute('aria-pressed',String(state.paused));$('pause-redirect').disabled=state.downloading;
 }
 async function load(){
  $('loading').hidden=false;$('unavailable').hidden=true;$('registration-flow').hidden=true;
  if(!rawToken){unavailable({status:404,message:'Este link de convite está incompleto ou não é válido. Abra o endereço enviado pela equipe.'});return;}
  try{
   const result=await api();state.csrf=result.csrf;state.invite=result.invite;state.details=result.details;state.discord=result.discord;state.selected=result.discord;
   $('invited-rank').textContent=result.invite.member_rank;const allied=result.invite.account_kind==='aliado';$('invited-kind').textContent=allied?'ALIADO DA GUILDA':'MEMBRO DA GUILDA';
   $('invited-expiry').textContent=`Válido até ${new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(result.invite.expires_at))}`;
   $('allied-gang-field').hidden=!allied;$('registration-alliance').required=allied;$('ally-help').hidden=!allied;
   for(const id of ['game','roblox']){$(`registration-${id}`).required=!allied;$(`${id}-required`).textContent=allied?'(opcional)':'*';}
   if(result.details){for(const [id,key]of [['name','name'],['game','game_nick'],['roblox','roblox_username'],['alliance','allied_gang']])$(`registration-${id}`).value=result.details[key]||'';}
   $('loading').hidden=true;$('registration-flow').hidden=false;
   if(result.verification?.code_sent&&result.discord){state.resendAt=Math.max(0,Date.parse(result.verification.expires_at)-9*60000);verification(result.discord,result.verification.expires_at);}
   else{if(result.discord)selectProfile(result.discord);showStep(result.details?'discord':'details',{focus:false});}
   clearInterval(clockTimer);clockTimer=setInterval(()=>{updateCodeClock();updateRedirect();},1000);
  }catch(error){unavailable(error);}
 }
 $('details-form').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;if(!form.reportValidity())return;run($('save-details'),'Salvando seus dados…',async()=>{
  const result=await api('/draft',{name:$('registration-name').value.trim(),game_nick:$('registration-game').value.trim(),roblox_username:$('registration-roblox').value.trim(),...(state.invite.account_kind==='aliado'?{allied_gang:$('registration-alliance').value.trim()}:{})});
  state.details=result.details;state.discord=null;state.selected=null;state.codeExpires=0;$('discord-confirm-form').hidden=true;$('discord-results').replaceChildren();$('discord-consent').checked=false;$('search-state').textContent='Procure seu perfil no servidor para continuar.';showStep('discord');
 });});
 $('discord-search-form').addEventListener('submit',event=>{event.preventDefault();if(!event.currentTarget.reportValidity())return;run($('discord-search'),'Buscando…',async()=>{const result=await api('/discord/search',{query:$('discord-query').value.trim()});renderResults(Array.isArray(result.members)?result.members:[]);});});
 $('discord-consent').addEventListener('change',syncButtons);
 $('discord-confirm-form').addEventListener('submit',event=>{event.preventDefault();if(!event.currentTarget.reportValidity()||!state.selected)return;run($('send-code'),'Enviando código…',sendCode);});
 $('resend-code').addEventListener('click',()=>{if(!state.discord||Date.now()<state.resendAt)return;state.selected=state.discord;run($('resend-code'),'Enviando…',sendCode);});
 $('back-details').addEventListener('click',()=>showStep('details'));$('back-discord').addEventListener('click',()=>{if(state.discord)selectProfile(state.discord);showStep('discord');});
 $('registration-code').addEventListener('input',event=>{event.target.value=event.target.value.replace(/\D/g,'').slice(0,6);});
 $('registration-password').addEventListener('input',updateStrength);$('registration-password-confirm').addEventListener('input',()=>$('registration-password-confirm').setCustomValidity(''));
 $('toggle-password').addEventListener('click',()=>{const visible=$('registration-password').type==='password';for(const id of ['registration-password','registration-password-confirm'])$(id).type=visible?'text':'password';$('toggle-password').textContent=visible?'Ocultar senhas':'Mostrar senhas';$('toggle-password').setAttribute('aria-pressed',String(visible));});
 $('complete-form').addEventListener('submit',event=>{
  event.preventDefault();const form=event.currentTarget;if($('registration-password-confirm').value!==$('registration-password').value)$('registration-password-confirm').setCustomValidity('As senhas precisam ser iguais.');if(!form.reportValidity())return;
  run($('complete-registration'),'Criando sua conta e carteira…',async()=>{
   try{success(await api('/complete',{code:$('registration-code').value,password:$('registration-password').value}));}
   catch(error){
    if(error.network){try{const response=await fetch('/api/member/me',{credentials:'same-origin',headers:{Accept:'application/json'},signal:AbortSignal.timeout(10000)});if(response.ok){const me=await response.json();if(me.member?.discord_id===state.discord.id&&me.member?.idrkc){success({member:me.member,redirect:'/membros',card_url:'/api/member/card.png'});return;}}}catch{} }
    throw error;
   }
  });
 });
 $('pause-redirect').addEventListener('click',()=>{if(state.downloading)return;if(!state.paused)state.redirectRemaining=Math.max(1,Math.ceil((state.redirectAt-Date.now())/1000));state.paused=!state.paused;if(!state.paused)state.redirectAt=Date.now()+Math.max(5,state.redirectRemaining)*1000;renderRedirectNote();});
 $('download-new-card').addEventListener('click',async()=>{
  if(!state.success||state.downloading)return;
  if(!state.paused)state.redirectRemaining=Math.max(1,Math.ceil((state.redirectAt-Date.now())/1000));state.downloading=true;renderRedirectNote();message('',undefined,'success-message');const button=$('download-new-card'),label=button.textContent;button.disabled=true;button.textContent='Preparando sua carteira…';
  try{const response=await fetch('/api/member/card.png',{credentials:'same-origin',signal:AbortSignal.timeout(30000)});if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error||'Não foi possível baixar sua carteira. Você também pode baixá-la no painel.');}const blob=await response.blob();if(!blob.type.startsWith('image/png'))throw new Error('A carteira ainda não está disponível. Tente novamente no seu painel.');const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`HRISTE-BOZE-HB-ID-${state.success.member.idrkc}.png`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);message('Sua carteira está pronta. Confira os downloads do navegador.','info','success-message');}
  catch(error){message(error.name==='TimeoutError'?'O download demorou mais que o esperado. Tente novamente ou acesse Minha carteira no painel.':error.message,'error','success-message');}
  finally{state.downloading=false;if(!state.paused){state.redirectRemaining=Math.max(10,state.redirectRemaining);state.redirectAt=Date.now()+state.redirectRemaining*1000;}button.disabled=false;button.textContent=label;renderRedirectNote();}
 });
 $('reload-invite').addEventListener('click',load);window.addEventListener('pagehide',()=>clearInterval(clockTimer));load();
})();
