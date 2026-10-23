'use strict';
const $=id=>document.getElementById(id);
const date=value=>value?new Date(value).toLocaleDateString('pt-BR',{day:'2-digit',month:'long',year:'numeric'}):'—';
const el=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
let session=null,signup=false,busy=false,notices=[],embeds=[],services={reports:[],tickets:[]},migration=null,loadEpoch=0,newsFilter='all';
let previewController=null,previewUrl=null,previewEpoch=0;
let memberProfileController=null,memberProfileEpoch=0;
function clearMemberAvatars(name=''){
 memberProfileEpoch++;memberProfileController?.abort();memberProfileController=null;
 for(const id of ['member-avatar','welcome-avatar','identity-avatar'])DiscordProfileAvatar.render($(id),{name});
}
async function loadMemberAvatar(){
 const member=session?.member;if(!member)return;
 clearMemberAvatars(member.name);const epoch=memberProfileEpoch,owner=String(member.discord_id),controller=new AbortController();memberProfileController=controller;
 try{
  const result=await DiscordProfileAvatar.request('/api/member/discord-profile',controller);
  if(epoch!==memberProfileEpoch||String(session?.member.discord_id)!==owner)return;
  for(const id of ['member-avatar','welcome-avatar','identity-avatar'])DiscordProfileAvatar.render($(id),{profile:result.linked?result.profile:null,name:session.member.name,discordId:owner});
 }catch{ /* A missing Discord photo must not stop access to the member panel. */ }
 finally{if(epoch===memberProfileEpoch)memberProfileController=null;}
}
let cardAuthMode=false,cardLoginBusy=false,cardLoginEpoch=0,cardLoginController=null,cardLoginCsrf=null,cardLoginFile=null,cardLoginUrl=null;
const CARD_LOGIN_MAX_BYTES=8*1024*1024;
function clearCardFile(){
 if(cardLoginUrl){URL.revokeObjectURL(cardLoginUrl);cardLoginUrl=null;}
 cardLoginFile=null;$('card-login-file').value='';$('card-login-selected').hidden=true;
 const image=$('card-login-preview');image.onload=null;image.onerror=null;image.hidden=false;image.removeAttribute('src');
 $('card-login-file-name').textContent='';$('card-login-file-details').textContent='';$('card-login-submit').disabled=true;
}
function cardLoginControls(occupied){
 cardLoginBusy=occupied;
 for(const id of ['card-login-file','card-login-remove','card-login-confirm'])$(id).disabled=occupied;
 $('card-login-submit').disabled=occupied||!cardLoginFile;
 $('card-login-form').setAttribute('aria-busy',String(occupied));
 $('card-login-code-form').setAttribute('aria-busy',String(occupied));
 $('card-login-submit').replaceChildren(document.createTextNode(occupied?'Conferindo sua carteira…':'Ler minha carteira'),el('span',null,'↗'));
}
function clearCardLogin(){
 cardLoginEpoch++;cardLoginController?.abort();cardLoginController=null;cardLoginCsrf=null;
 clearCardFile();cardLoginControls(false);$('card-login-code').value='';$('card-login-password').value='';$('card-login-password-again').value='';
 $('card-login-password').required=false;$('card-login-password-again').required=false;$('card-login-password-row').hidden=true;
 $('card-login-code-form').hidden=true;$('card-login-form').hidden=!cardAuthMode;
}
async function cardLoginFetch(path,controller,{method='GET',body,type}={}){
 const response=await fetch('/api/member/card-login'+path,{method,credentials:'same-origin',signal:controller.signal,headers:{...(type?{'Content-Type':type}:{}),...(cardLoginCsrf?{'X-Card-Login-CSRF':cardLoginCsrf}:{})},...(body!==undefined?{body}:{})});
 let result;try{result=await response.json();}catch{}
 if(!response.ok)throw Object.assign(new Error(result?.error||(response.status===413?'A imagem precisa ter no máximo 8 MB.':response.status===429?'Aguarde um momento antes de tentar novamente.':response.status===503?'A guilda está iniciando. Tente novamente em instantes.':'Não foi possível conferir a carteira. Use a imagem original e tente novamente.')),{status:response.status,requiresPassword:result?.requires_password===true});
 if(!result)throw new Error('A resposta não pôde ser lida. Tente novamente.');
 return result;
}
async function cardLoginWork(work){
 if(cardLoginBusy||busy)return;
 const epoch=cardLoginEpoch,controller=new AbortController();cardLoginController=controller;cardLoginControls(true);$('access-message').textContent='';
 const timer=setTimeout(()=>controller.abort(),30000);
 try{await work(controller,epoch);}
 catch(error){if(epoch===cardLoginEpoch){
  if(error.requiresPassword){$('card-login-password-row').hidden=false;$('card-login-password').required=true;$('card-login-password-again').required=true;}
  $('access-message').textContent=error.name==='AbortError'?'A leitura demorou. Tente novamente com a imagem original da carteira.':error.message;
 }}
 finally{clearTimeout(timer);if(epoch===cardLoginEpoch){cardLoginController=null;cardLoginControls(false);}}
}
function selectCardFile(){
 $('access-message').textContent='';const file=$('card-login-file').files?.[0];
 if(!file){clearCardFile();return;}
 const formats={'image/png':'image/png','image/jpeg':'image/jpeg','image/webp':'image/webp'};
 const extension=file.name.split('.').pop().toLowerCase(),fallback={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp'};
 const type=formats[file.type]||(!file.type&&fallback[extension]);
 if(!type||!file.size||file.size>CARD_LOGIN_MAX_BYTES){
  clearCardFile();$('access-message').textContent=!type?'Escolha a carteira em PNG, JPG ou WebP.':!file.size?'Esse arquivo está vazio. Escolha o PNG original da carteira.':'A carteira precisa ter no máximo 8 MB.';return;
 }
 if(cardLoginUrl)URL.revokeObjectURL(cardLoginUrl);
 cardLoginFile={file,type};cardLoginUrl=URL.createObjectURL(file);
 const image=$('card-login-preview');image.hidden=false;image.onerror=()=>{image.hidden=true;};image.src=cardLoginUrl;
 $('card-login-file-name').textContent=file.name;
 $('card-login-file-details').textContent=(file.size<1024*1024?Math.max(1,Math.round(file.size/1024))+' KB':(file.size/(1024*1024)).toLocaleString('pt-BR',{maximumFractionDigits:1})+' MB')+' · Pronta para leitura';
 $('card-login-selected').hidden=false;$('card-login-submit').disabled=false;
}
function clearIdentityPreview(){
 previewEpoch++;previewController?.abort();previewController=null;
 if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null;}
 const img=$('identity-preview');img.onload=null;img.onerror=null;img.hidden=true;img.removeAttribute('src');$('identity-preview-placeholder').hidden=false;
}
async function renderIdentityPreview(){
 clearIdentityPreview();const placeholder=$('identity-preview-placeholder').querySelector('p');
 if(!session?.member.verified){placeholder.textContent='CONCLUA SEU TRYOUT E CADASTRO NO DISCORD.';return;}
 placeholder.textContent='CARREGANDO SUA CARTEIRA…';
 const epoch=previewEpoch,owner=session.member.discord_id,controller=new AbortController();previewController=controller;
 const timer=setTimeout(()=>controller.abort(),20000);
 try{
  const response=await fetch('/api/member/card.png',{credentials:'same-origin',signal:controller.signal});
  if(!response.ok)throw new Error('preview');
  const blob=await response.blob();if(epoch!==previewEpoch||session?.member.discord_id!==owner)return;
  previewUrl=URL.createObjectURL(blob);const img=$('identity-preview');
  img.onload=()=>{if(epoch!==previewEpoch)return;img.hidden=false;$('identity-preview-placeholder').hidden=true;};
  img.onerror=()=>{if(epoch!==previewEpoch)return;clearIdentityPreview();placeholder.textContent='PRÉVIA INDISPONÍVEL. USE O BOTÃO PARA BAIXAR.';};
  img.src=previewUrl;
 }catch{if(epoch===previewEpoch)placeholder.textContent='PRÉVIA INDISPONÍVEL. USE O BOTÃO PARA BAIXAR.';}
 finally{clearTimeout(timer);if(epoch===previewEpoch)previewController=null;}
}
window.addEventListener('pagehide',()=>{clearIdentityPreview();clearCardLogin();clearMemberAvatars();});
window.addEventListener('pageshow',event=>{if(event.persisted&&session){loadMemberAvatar();if(document.querySelector('.workspace').dataset.activeView==='identity')renderIdentityPreview();}});
async function api(path,method='GET',body,blob=false){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
 try{
  const res=await fetch('/api/member'+path,{method,credentials:'same-origin',signal:controller.signal,headers:{...(body?{'Content-Type':'application/json'}:{}),...(session?{'X-CSRF-Token':session.csrf}:{})},...(body?{body:JSON.stringify(body)}:{})});
  if(!res.ok){let error;try{error=await res.json();}catch{}throw Object.assign(new Error(error?.error||(res.status===503?'A guilda está iniciando. Aguarde um momento.':'Não foi possível concluir. Tente novamente.')),{status:res.status});}
  return blob?res.blob():res.json();
 }catch(e){if(e.name==='AbortError')throw new Error('A resposta demorou. Aguarde um momento e tente novamente.');throw e;}finally{clearTimeout(timer);}
}
function authMode(value){
 cardAuthMode=value==='card';signup=value===true;clearCardLogin();
 $('access-message').textContent='';$('credentials-form').hidden=cardAuthMode;$('code-form').hidden=true;$('password-again-row').hidden=!signup;$('password-again').required=signup;$('signup-help').hidden=!signup;$('password').minLength=signup?12:1;$('password').autocomplete=signup?'new-password':'current-password';$('credentials-submit').textContent=signup?'Receber código no Discord ↗':'Entrar na guilda ↗';$('access-title').textContent=cardAuthMode?'SUA CARTEIRA.\nSEU ACESSO.':signup?'O SEU PRÓXIMO\nCAPÍTULO.':'BOM TER\nVOCÊ AQUI.';$('access-description').textContent=cardAuthMode?'Apresente a sua carteira HB-ID para continuar.':signup?'Crie sua senha e confirme sua identidade pelo Discord.':'Entre com seu HB-ID para acompanhar a guilda.';
 for(const [id,active] of [['login-tab',!signup&&!cardAuthMode],['signup-tab',signup],['card-login-tab',cardAuthMode]]){$(id).classList.toggle('selected',active);$(id).setAttribute('aria-pressed',String(active));}
}
function showAccess(){clearIdentityPreview();clearCardLogin();clearMemberAvatars();session=null;loadEpoch++;$('member-name').textContent='MEMBRO';$('member-sidebar-name').textContent='Membro';$('identity-name').textContent='';$('member-rank').textContent='Membro';$('boot').hidden=true;$('portal').hidden=true;$('access').hidden=false;}
function detailRow(label,value){const row=el('div');row.append(el('dt',null,label),el('dd',null,value||'Não informado'));return row;}
function showView(view){
 const labels={news:'Mural da guilda',identity:'Minha carteira',services:'Meus atendimentos',migration:'Minha imigração'};if(!labels[view])return;
 document.querySelector('.workspace').dataset.activeView=view;
 if(view==='identity')renderIdentityPreview();else clearIdentityPreview();
 for(const name of Object.keys(labels))$('view-'+name).hidden=name!==view;
 document.querySelectorAll('[data-view]').forEach(button=>{const active=button.dataset.view===view;button.classList.toggle('active',active);if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});$('view-label').textContent=labels[view];
}
function renderProfile(){
 $('member-rank').textContent=session.member.member_rank||'Membro';
 $('member-sidebar-name').textContent=session.member.name;
 loadMemberAvatar();
 if(document.querySelector('.workspace').dataset.activeView==='identity')renderIdentityPreview();else clearIdentityPreview();
 const m=session.member;$('member-name').textContent=m.name;$('verification-badge').textContent=m.verified?'Identidade verificada':'Verificação pendente';$('migration-banner').hidden=!m.migration_required;$('identity-name').textContent=m.name;$('identity-idrkc').textContent=m.idrkc||'Em emissão';$('identity-rank').textContent=m.member_rank;$('identity-details').replaceChildren(detailRow('Nome no jogo',m.game_nick),detailRow('Patente',m.member_rank),detailRow('Discord ID',m.discord_id),detailRow('Carteira',`Versão ${m.identity_version}`),detailRow('Registro criado',date(m.created_at)));$('download-card').disabled=!m.verified;
 $('card-help').textContent=m.migration_required&&m.verified?'A carteira usa seus dados atuais. O nome no jogo será atualizado após a aprovação da imigração.':m.verified?'Guarde o PNG original. O bot confere seu HBCode ao abrir um ticket ou enviar uma denúncia.':'Conclua o tryout e o cadastro obrigatório pelo link enviado no Discord.';
}
function emptyState(title,description,icon='▤'){const box=el('div','empty-state');box.append(el('span','empty-icon',icon),el('strong',null,title),el('p',null,description));return box;}
function renderNotices(){
 const list=$('news-list'),query=$('notice-search').value.trim().toLocaleLowerCase('pt-BR');
 const all=[...notices.map(n=>({...n,kind:'notice'})),...embeds.map(n=>({...n,kind:'embed',pinned:false}))].sort((a,b)=>Number(b.pinned)-Number(a.pinned)||new Date(b.published_at||b.created_at)-new Date(a.published_at||a.created_at));
 $('news-total').textContent=String(all.length).padStart(2,'0');
 const rows=all.filter(n=>(newsFilter==='all'||newsFilter==='pinned'&&n.pinned||newsFilter===n.kind)&&JSON.stringify(n.kind==='embed'?n.payload:{title:n.title,content:n.content}).toLocaleLowerCase('pt-BR').includes(query));
 list.replaceChildren();if(!rows.length){list.append(emptyState(query?'Nenhum comunicado encontrado':newsFilter==='pinned'?'Nenhum aviso fixado':newsFilter==='embed'?'As publicações do bot chegam aqui.':'As novidades começam por aqui.',query?'Tente buscar por outra palavra.':'Os comunicados da administração aparecerão neste espaço.'));return;}
 for(const n of rows){
  const card=el('article','notice-card'+(n.pinned?' pinned':'')+(n.kind==='embed'?' embed-notice':'')),meta=el('div','notice-meta');const publishedAt=n.published_at||n.created_at;const time=el('time',null,date(publishedAt));if(publishedAt)time.dateTime=publishedAt;
  meta.append(el('span','notice-tag',n.pinned?'◆ FIXADO · COMUNICADO OFICIAL':n.kind==='embed'?'DISCORD + MURAL · PUBLICAÇÃO OFICIAL':'COMUNICADO OFICIAL'),time);card.append(meta);
  if(n.kind==='embed')card.append(EmbedRenderer.render(n.payload,{messageUrl:n.message_url}));
  else card.append(el('h3',null,n.title),el('p','notice-content',n.content),el('p','notice-author','ADMINISTRAÇÃO · HRISTE BOZE'));
  list.append(card);
 }
}
function renderServices(){
 const rows=[...(services.reports||[]).map(r=>({...r,type:'report'})),...(services.tickets||[]).map(t=>({...t,type:'ticket'}))].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));const list=$('services-list');list.replaceChildren();$('service-count').textContent=`${rows.length} ${rows.length===1?'solicitação':'solicitações'}`;
 if(!rows.length){list.append(emptyState('Seu atendimento começa no Discord.','Após enviar sua carteira ao bot e concluir o pedido, você poderá acompanhar a solicitação por aqui.','◇'));return;}
 const statusText={pendente:'Em análise',resolvida:'Concluída',resolvido:'Concluído',aberto:'Atendimento aberto',fechando:'Finalizando'};
 for(const item of rows){
  const card=el('article','service-card'),meta=el('div','service-meta'),closed=['resolvida','resolvido'].includes(item.status),text=item.notification_status==='failed'?'Entrega pendente de revisão':item.notification_status==='pending'?'Encaminhando à equipe':statusText[item.status]||item.status,status=el('span','badge '+(closed?'good':'warn'),text);meta.append(el('span',null,`${item.type==='report'?'DENÚNCIA':'ATENDIMENTO'} #${item.id}`),status);card.append(meta,el('h4',null,item.type==='report'?`Nick informado: ${item.subject}`:'Conversa com a administração'),el('p',null,`Solicitação registrada em ${date(item.created_at)}.`));
  if(item.resolution){const resolution=el('div','service-resolution');resolution.append(el('strong',null,'RESPOSTA DA ADMINISTRAÇÃO'),el('p',null,item.resolution));card.append(resolution);}
  else card.append(el('p',null,closed?'O atendimento foi encerrado. O registro continua disponível aqui.':item.notification_status==='failed'?'O pedido foi registrado. A administração precisa revisar a entrega pelo bot.':'Sua solicitação foi encaminhada à equipe. Você pode acompanhar as próximas etapas por aqui e pelo Discord.'));
  if(item.type==='ticket'&&item.channel_url){const href=EmbedRenderer.safeURL(item.channel_url);if(href&&new URL(href).hostname==='discord.com'){const link=el('a',null,'Abrir meu atendimento no Discord ↗');link.href=href;link.target='_blank';link.rel='noopener noreferrer';card.append(link);}}
  list.append(card);
 }
}
function renderMigration(){
 const r=migration,m=session.member;let status,title,description;
 if(r?.status==='pendente'){status='Em análise';title='Sua solicitação está com a equipe.';description='A administração vai conferir sua identidade e seu nome no jogo. Acompanhe a decisão por aqui.';}
 else if(r?.status==='aprovada'){status='Imigração aprovada';title='Bem-vindo ao nova guilda.';description='Sua identidade foi atualizada. A nova carteira será enviada pelo bot no seu privado e também está disponível em Minha carteira.';}
 else if(r?.status==='recusada'){status='Solicitação recusada';title='A equipe analisou sua solicitação.';description=r.reason||'Procure a administração para entender a decisão e os próximos passos.';}
 else if(!m.migration_required){status='Cadastro na guilda';title='Sua identidade está na nova guilda.';description='Você já possui um cadastro do GUILDA HRISTE BOZE. Os próximos comunicados estarão no mural.';}
 else{status='Ainda não solicitada';title='Seu próximo capítulo espera por você.';description='Faça sua solicitação no aviso de imigração do Discord. Tenha seu HB-ID e seu nome no jogo em mãos.';}
 $('migration-status').textContent=status;$('migration-title').textContent=title;$('migration-description').textContent=description;const details=$('migration-details');details.replaceChildren();if(r){details.append(detailRow('Nome solicitado',r.shigaku_name),detailRow('Solicitação enviada',date(r.created_at)));if(r.decided_at)details.append(detailRow('Análise concluída',date(r.decided_at)));}
}
async function loadPortal(){
 const epoch=++loadEpoch;$('refresh').disabled=true;
 try{
  const me=await api('/me');if(epoch!==loadEpoch)return;session=me;clearCardLogin();$('boot').hidden=true;$('access').hidden=true;$('portal').hidden=false;renderProfile();
  const results=await Promise.allSettled([api('/notices'),api('/migration'),api('/embeds'),api('/services')]);if(epoch!==loadEpoch)return;const errors=[];
  results.forEach((result,index)=>{if(result.status==='rejected'){if(result.reason.status===401)throw result.reason;errors.push(result.reason.message);return;}if(index===0)notices=result.value;if(index===1)migration=result.value.request;if(index===2)embeds=result.value;if(index===3)services=result.value;});
  renderNotices();renderMigration();renderServices();$('portal-message').textContent=errors.length?'Parte dos dados não pôde ser atualizada. '+errors[0]:'';
 }catch(e){if(epoch!==loadEpoch)return;if(e.status===401)showAccess();else if(session)$('portal-message').textContent=e.message;else{showAccess();$('access-message').textContent=e.message;}}
 finally{if(epoch===loadEpoch||!session)$('refresh').disabled=false;}
}
async function formWork(form,work){if(busy||cardLoginBusy)return;busy=true;const buttons=[...form.querySelectorAll('button'),$('login-tab'),$('signup-tab'),$('card-login-tab')];buttons.forEach(b=>b.disabled=true);$('access-message').textContent='';try{await work();}catch(e){$('access-message').textContent=e.message;}finally{buttons.forEach(b=>b.disabled=false);busy=false;}}
$('login-tab').onclick=()=>authMode(false);$('signup-tab').onclick=()=>authMode(true);$('restart-signup').onclick=()=>authMode(true);$('card-login-tab').onclick=()=>authMode('card');
$('card-login-file').onchange=selectCardFile;$('card-login-remove').onclick=clearCardFile;$('card-login-restart').onclick=()=>authMode('card');
$('card-login-form').onsubmit=event=>{event.preventDefault();cardLoginWork(async(controller,epoch)=>{
 if(!cardLoginFile)throw new Error('Selecione a imagem da sua carteira primeiro.');
 const selected=cardLoginFile;
 const handshake=await cardLoginFetch('/session',controller);if(epoch!==cardLoginEpoch)return;
 if(!handshake.csrf)throw new Error('Não foi possível iniciar a leitura. Reabra a aba Com carteira e tente novamente.');
 cardLoginCsrf=handshake.csrf;
 const result=await cardLoginFetch('/start',controller,{method:'POST',body:selected.file,type:selected.type});if(epoch!==cardLoginEpoch)return;
 clearCardFile();
 if(result.authenticated){clearCardLogin();$('password').value='';$('password-again').value='';await loadPortal();return;}
 if(result.requires_code){
  $('card-login-form').hidden=true;$('card-login-code-form').hidden=false;
  $('card-login-password-row').hidden=!result.requires_password;$('card-login-password').required=Boolean(result.requires_password);$('card-login-password-again').required=Boolean(result.requires_password);
  $('card-login-code-description').textContent=result.message||'Confira o código enviado no seu privado do Discord para concluir o acesso.';
  $('card-login-code').focus();return;
 }
 throw new Error('Não foi possível concluir o acesso. Tente ler sua carteira novamente.');
});};
$('card-login-code-form').onsubmit=event=>{event.preventDefault();cardLoginWork(async(controller,epoch)=>{
 const body={code:$('card-login-code').value.trim()};if($('card-login-password').required){body.password=$('card-login-password').value;if(body.password!==$('card-login-password-again').value)throw new Error('As senhas precisam ser iguais.');}
 const result=await cardLoginFetch('/confirm',controller,{method:'POST',body:JSON.stringify(body),type:'application/json'});if(epoch!==cardLoginEpoch)return;
 if(!result.ok&&!result.authenticated)throw new Error('Não foi possível confirmar o acesso. Confira o código e tente novamente.');
 clearCardLogin();$('password').value='';$('password-again').value='';await loadPortal();
});};
$('credentials-form').onsubmit=e=>{e.preventDefault();formWork(e.currentTarget,async()=>{const idrkc=$('idrkc').value.trim(),password=$('password').value;if(signup&&password!==$('password-again').value)throw new Error('As senhas precisam ser iguais.');if(signup){const response=await api('/register/start','POST',{idrkc,password});$('credentials-form').hidden=true;$('code-form').hidden=false;$('access-message').textContent=response.message;$('code').focus();}else{await api('/login','POST',{idrkc,password});$('password').value='';await loadPortal();}});};
$('code-form').onsubmit=e=>{e.preventDefault();formWork(e.currentTarget,async()=>{await api('/register/confirm','POST',{code:$('code').value.trim()});$('password').value='';$('password-again').value='';$('code').value='';await loadPortal();});};
document.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>showView(button.dataset.view));
document.querySelectorAll('[data-news-filter]').forEach(button=>button.onclick=()=>{newsFilter=button.dataset.newsFilter;document.querySelectorAll('[data-news-filter]').forEach(item=>{const selected=item===button;item.classList.toggle('active',selected);item.setAttribute('aria-pressed',String(selected));});renderNotices();});
$('banner-migration').onclick=()=>showView('migration');$('quick-card').onclick=$('service-card').onclick=()=>showView('identity');$('quick-services').onclick=()=>showView('services');$('notice-search').oninput=renderNotices;$('refresh').onclick=loadPortal;
$('logout').onclick=async()=>{if(busy)return;busy=true;$('logout').disabled=true;try{await api('/logout','POST',{});showAccess();authMode(false);notices=[];embeds=[];services={reports:[],tickets:[]};migration=null;$('news-list').replaceChildren();$('services-list').replaceChildren();showView('news');}catch(e){if(e.status===401)showAccess();else $('portal-message').textContent=e.message;}finally{busy=false;$('logout').disabled=false;}};
$('download-card').onclick=async()=>{const button=$('download-card');button.disabled=true;$('portal-message').textContent='';try{const blob=await api('/card.png','GET',undefined,true);const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`HRISTE-BOZE-HB-ID-${session.member.idrkc}.png`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}catch(e){if(e.status===401)showAccess();else $('portal-message').textContent=e.message;}finally{button.disabled=!session?.member.verified;}};
loadPortal();
