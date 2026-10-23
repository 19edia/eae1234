'use strict';

const EMBED_EXAMPLE = {
 embeds: [{
  color: 16742462,
  author: { name: 'ADMINISTRAÇÃO • HRISTE BOZE' },
  title: 'O próximo capítulo começa com a gente.',
  description: '**Bem-vindos aa guilda.**\nAcompanhe aqui as novidades, os encontros e os comunicados oficiais.',
  fields: [
   { name: 'Identidade', value: 'Sua nova carteira **HB-ID**.', inline: true },
   { name: 'Atendimento', value: 'Envie sua carteira ao bot.', inline: true }
  ],
  footer: { text: 'União · Respeito · Lealdade' }
 }]
};

async function loadEmbeds() {
 const rows = await api('/embed-publications');
 const epoch = viewEpoch;
 const sent = rows.filter(row => row.status === 'sent').length;
 const pending = rows.filter(row => row.status === 'pending').length;
 const failed = rows.filter(row => row.status === 'failed').length;

 $('view').innerHTML = `
  <section class="studio-masthead" aria-labelledby="studio-title">
   <div class="studio-masthead-copy">
    <p class="studio-overline"><span>COMUNICAÇÃO OFICIAL</span><span>HB / STUDIO</span></p>
    <h2 id="studio-title">A voz<br><span>da guilda.</span></h2>
    <p class="studio-intro">Uma publicação. A mesma mensagem em todos os lugares onde a nossa história acontece.</p>
   </div>
   <div class="studio-destinations" aria-label="Destinos da publicação">
    <span class="studio-destination-caption">SEU COMUNICADO CHEGA A</span>
    <div class="studio-destination"><span class="studio-destination-icon" aria-hidden="true">#</span><div><strong>Avisos do Discord</strong><span>O canal oficial do servidor</span></div><span class="studio-arrow" aria-hidden="true">↗</span></div>
    <div class="studio-destination"><span class="studio-destination-icon studio-destination-portal" aria-hidden="true">▦</span><div><strong>Mural dos membros</strong><span>O mesmo conteúdo no painel</span></div><span class="studio-arrow" aria-hidden="true">↗</span></div>
   </div>
  </section>
  <div class="embed-studio">
   <section class="studio-editor" aria-labelledby="studio-editor-title">
    <header class="studio-heading"><div class="studio-step"><span class="studio-step-number">01</span><div><span class="studio-panel-kicker">COMPOR</span><h3 id="studio-editor-title">Sua mensagem.</h3></div></div><button id="embed-example" class="studio-example" type="button">Usar modelo <span aria-hidden="true">↗</span></button></header>
    <form id="embed-form">
     <div class="studio-code-toolbar"><label for="embed-json"><span class="studio-file-mark" aria-hidden="true">{ }</span> comunicado.json</label><button id="embed-format" class="studio-format" type="button" title="Organizar a indentação do JSON">Formatar</button></div>
     <div class="studio-code-surface"><pre id="embed-line-numbers" class="studio-line-numbers" aria-hidden="true">1</pre><textarea id="embed-json" name="payload" spellcheck="false" autocapitalize="off" autocomplete="off" maxlength="28000" required placeholder='{
  "embeds": [{
    "title": "O próximo capítulo.",
    "description": "Começa com a gente.",
    "color": 16742462
  }]
}' aria-describedby="embed-help embed-code-count"></textarea></div>
     <div class="studio-code-status"><span>JSON <span class="studio-status-separator">/</span> UTF-8</span><span id="embed-code-count">0 / 28.000 caracteres</span></div>
     <p id="embed-help" class="studio-helper">Cole um embed ou um objeto com <code>content</code> e <code>embeds</code>. Use imagens HTTPS públicas. Menções não enviam notificações.</p>
     <div class="studio-actions"><button id="embed-validate" class="ghost" type="button">Validar JSON</button><button id="embed-publish" type="submit">Publicar comunicado <span aria-hidden="true">↗</span></button></div>
     <p id="embed-feedback" class="studio-feedback" role="status" aria-live="polite"></p>
     <p class="studio-delivery-note">O mural é liberado quando a entrega no Discord é confirmada.</p>
    </form>
   </section>
   <section class="studio-preview" aria-labelledby="studio-preview-title">
    <header class="studio-heading"><div class="studio-step"><span class="studio-step-number">02</span><div><span class="studio-panel-kicker">CONFERIR</span><h3 id="studio-preview-title">Antes de ir ao ar.</h3></div></div><span id="embed-preview-label" class="studio-preview-state">PRÉVIA DO EMBED</span></header>
    <div class="studio-preview-channel"><span aria-hidden="true">#</span><strong>avisos</strong><span class="studio-preview-channel-divider" aria-hidden="true"></span><span>Comunicação oficial</span></div>
    <div id="embed-preview" class="studio-preview-inner"></div>
    <footer class="studio-preview-footer"><span class="studio-preview-footer-mark" aria-hidden="true">↳</span><p>Uma só identidade, dois destinos.<br><strong>O mural dos membros recebe este mesmo embed.</strong></p></footer>
   </section>
  </div>
  <section class="publication-history" aria-labelledby="publication-history-title">
   <header class="history-heading"><div><p class="studio-overline">ARQUIVO DA GUILDA</p><h2 id="publication-history-title">O que já foi dito.</h2></div><div class="publication-totals"><span><strong>${sent}</strong> ${sent === 1 ? 'publicada' : 'publicadas'}</span>${pending ? `<span class="publication-total-pending"><strong>${pending}</strong> na fila</span>` : ''}${failed ? `<span class="publication-total-failed"><strong>${failed}</strong> com falha</span>` : ''}</div></header>
   <div id="publication-list" class="publication-list"></div>
  </section>`;

 const input = $('embed-json');
 const preview = $('embed-preview');
 const feedback = $('embed-feedback');
 const label = $('embed-preview-label');
 const publish = $('embed-publish');
 const validate = $('embed-validate');
 const example = $('embed-example');
 const format = $('embed-format');
 const count = $('embed-code-count');
 const lines = $('embed-line-numbers');
 const form = $('embed-form');
 let requestId = crypto.randomUUID();
 let running = false;
 let timer;

 const active = () => input.isConnected && epoch === viewEpoch && current === 'embeds' && !linkingDiscord;
 const requireActive = () => { if (!active()) throw Object.assign(new Error('Tela substituída.'), { stale: true }); };
 const setPreviewLabel = (text, state = '') => { label.textContent = text; label.dataset.state = state; };

 function showEmpty(incomplete = false) {
  preview.replaceChildren();
  const empty = document.createElement('div');
  empty.className = 'studio-empty-preview';
  const symbol = document.createElement('span');
  symbol.className = 'studio-empty-symbol';
  symbol.setAttribute('aria-hidden', 'true');
  symbol.textContent = '{ }';
  const title = document.createElement('strong');
  title.textContent = incomplete ? 'A ideia está tomando forma.' : 'Toda história começa aqui.';
  const text = document.createElement('p');
  text.textContent = incomplete ? 'Complete o JSON para visualizar a sua publicação.' : 'Cole seu JSON ou use o modelo para dar voz ao próximo capítulo da guilda.';
  const caption = document.createElement('span');
  caption.className = 'studio-empty-caption';
  caption.textContent = 'SUA PRÉVIA APARECE NESTE ESPAÇO';
  empty.append(symbol, title, text, caption);
  preview.append(empty);
 }

 function updateCodeMeta() {
  const lineCount = input.value.split('\n').length;
  lines.textContent = Array.from({ length: lineCount }, (_, index) => index + 1).join('\n');
  lines.scrollTop = input.scrollTop;
  count.textContent = `${input.value.length.toLocaleString('pt-BR')} / 28.000 caracteres`;
 }

 function localPreview() {
  if (!active()) return;
  feedback.textContent = '';
  delete feedback.dataset.error;
  setPreviewLabel('PRÉVIA LOCAL');
  if (!input.value.trim()) { showEmpty(); return; }
  try {
   const value = JSON.parse(input.value);
   const payload = Array.isArray(value?.embeds) || value?.content ? value : { embeds: [value] };
   preview.replaceChildren(EmbedRenderer.render(payload));
  } catch { showEmpty(true); }
 }

 function inputChanged() {
  requestId = crypto.randomUUID();
  clearTimeout(timer);
  updateCodeMeta();
  setPreviewLabel('PRÉVIA LOCAL');
  timer = setTimeout(localPreview, 180);
 }

 input.oninput = inputChanged;
 input.onscroll = () => { lines.scrollTop = input.scrollTop; };
 input.onkeydown = event => {
  if (event.key === 'Tab' && !event.shiftKey && !input.readOnly) {
   event.preventDefault();
   if (input.value.length - (input.selectionEnd - input.selectionStart) + 2 > input.maxLength) return;
   input.setRangeText('  ', input.selectionStart, input.selectionEnd, 'end');
   inputChanged();
  }
 };
 example.onclick = () => {
  input.value = JSON.stringify(EMBED_EXAMPLE, null, 2);
  inputChanged();
  clearTimeout(timer);
  localPreview();
  input.focus();
  input.setSelectionRange(0, 0);
  input.scrollTop = lines.scrollTop = 0;
 };
 format.onclick = () => {
  clearTimeout(timer);
  try {
   const formatted = JSON.stringify(JSON.parse(input.value), null, 2);
   if (formatted.length > input.maxLength) throw new Error('O JSON formatado ultrapassa 28.000 caracteres. Use a versão compacta.');
   input.value = formatted;
   inputChanged();
   clearTimeout(timer);
   localPreview();
   feedback.textContent = 'Indentação organizada. Valide o JSON antes de publicar.';
   input.focus();
   input.setSelectionRange(0, 0);
   input.scrollTop = lines.scrollTop = 0;
  } catch (error) {
   feedback.dataset.error = 'true';
   feedback.textContent = error instanceof SyntaxError ? 'Complete ou corrija o JSON antes de formatar.' : error.message;
  }
 };

 async function validatePayload() {
  const result = await api('/embed-publications/preview', 'POST', { payload: input.value });
  requireActive();
  preview.replaceChildren(EmbedRenderer.render(result.payload));
  setPreviewLabel('JSON VALIDADO', 'valid');
  return result;
 }

 async function work(fn) {
  if (running || !active()) return;
  clearTimeout(timer);
  running = true;
  publish.disabled = validate.disabled = example.disabled = format.disabled = true;
  input.readOnly = true;
  form.setAttribute('aria-busy', 'true');
  feedback.textContent = '';
  delete feedback.dataset.error;
  try { await fn(); }
  catch (error) {
   if (!error.stale && active()) {
    feedback.dataset.error = 'true';
    feedback.textContent = error.message;
    if (label.textContent === 'VALIDANDO…') setPreviewLabel('VERIFIQUE O JSON', 'invalid');
   }
  } finally {
   running = false;
   publish.disabled = validate.disabled = example.disabled = format.disabled = false;
   input.readOnly = false;
   form.removeAttribute('aria-busy');
  }
 }

 validate.onclick = () => work(async () => {
  setPreviewLabel('VALIDANDO…');
  const result = await validatePayload();
  feedback.textContent = `Pronto para publicar. ${Number(result.characters).toLocaleString('pt-BR')} caracteres nos embeds.`;
 });
 form.onsubmit = event => {
  event.preventDefault();
  work(async () => {
   setPreviewLabel('VALIDANDO…');
   const result = await validatePayload();
   const record = await api('/embed-publications', 'POST', { payload: result.payload, request_id: requestId });
   if (!active()) return;
   note(record.status === 'sent' ? 'Publicação entregue ao Discord e ao mural.' : 'Publicação recebida. O bot vai entregar nos avisos e liberar o mesmo embed no mural dos membros.');
   await load();
  });
 };

 showEmpty();
 const list = $('publication-list');
 if (!rows.length) {
  list.innerHTML = '<div class="publication-empty"><span aria-hidden="true">↗</span><div><strong>O primeiro comunicado é seu.</strong><p>As publicações enviadas pelo estúdio ficam registradas aqui.</p></div></div>';
  return;
 }
 for (const row of rows) {
  const wrapper = document.createElement('details');
  wrapper.className = 'publication-row';
  const summary = document.createElement('summary');
  const number = document.createElement('span');
  number.className = 'publication-index';
  number.textContent = String(row.id).padStart(2, '0');
  const intro = document.createElement('div');
  intro.className = 'publication-intro';
  const title = document.createElement('h3');
  const meta = document.createElement('p');
  const status = document.createElement('span');
  title.textContent = row.payload?.embeds?.[0]?.title || row.payload?.content?.slice(0, 100) || `Publicação #${row.id}`;
  meta.textContent = date(row.created_at);
  status.className = 'badge publication-status ' + (row.status === 'sent' ? 'good' : row.status === 'failed' ? 'warn' : '');
  status.textContent = ({ pending: 'Na fila de envio', sent: 'Publicado nos dois canais', failed: 'Falha na entrega' })[row.status] || row.status;
  intro.append(title, meta);
  summary.append(number, intro, status);
  const content = document.createElement('div');
  content.className = 'publication-content';
  content.append(EmbedRenderer.render(row.payload, { messageUrl: row.message_url }));
  if (row.error) {
   const error = document.createElement('p');
   error.className = 'publication-error';
   error.textContent = row.error;
   content.append(error);
  }
  if (row.status === 'failed') {
   const retry = document.createElement('button');
   retry.className = 'ghost';
   retry.textContent = 'Tentar entregar novamente ↗';
   retry.onclick = async () => {
    if (retry.disabled || !active()) return;
    retry.disabled = true;
    try {
     await api(`/embed-publications/${row.id}/retry`, 'POST', {});
     if (!active()) return;
     note('Nova tentativa de entrega adicionada à fila.');
     await load();
    } catch (error) {
     if (active()) { note(error.message); retry.disabled = false; }
    }
   };
   content.append(retry);
  }
  wrapper.append(summary, content);
  list.append(wrapper);
 }
}
