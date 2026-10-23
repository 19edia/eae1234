# HRISTE BOZE · Westbound, Deepwoken e Klase

Bot Discord, painel administrativo, portal de membros e carteiras HB-ID. Identidade amarela e preta. Esta entrega foi feita em uma cópia separada; a pasta original foi preservada.

## Testar sem configurar nada

Abra **TESTE-HRISTE-BOZE.html**, na pasta acima de projeto. Qualquer usuário e senha entram na demonstração. Os dados ficam apenas no navegador, sem conexão com Discord ou banco real. Use os controles de tryout, cadastro, carteira e simulação do prazo.

Outra opção, com Node instalado: execute `npm run demo` nesta pasta e abra http://127.0.0.1:4173. Este servidor serve somente os arquivos públicos.

## Regras escolhidas

- Avaliador Discord: **1480009495915659494**. Os nicks são consultados no servidor.
- Aprovação: participante tira **50% ou mais** da vida do avaliador.
- Cadastro obrigatório: **48 horas após aprovação**.
- Acesso do aprovado é provisório até concluir o cadastro vinculado ao próprio Discord.
- Sem cadastro no prazo: reprovação por prazo, retirada dos cargos gerenciados e aviso por DM.
- A porcentagem é informada pelo avaliador; não há leitura automática de vida dentro do jogo.

## Fluxo real

1. Execute **/criar** no Discord. O bot atualiza a estrutura, guarda todos os IDs no banco e publica o painel de tryout.
2. O participante clica no painel e recebe três opções: **Westbound**, **Deepwoken** e **Klase**. Só depois da escolha o bot cria um canal privado com participante e avaliador. O jogo fica salvo e acompanha os avisos, o resultado e a página de avaliação. Cliques repetidos recuperam a tentativa em andamento sem trocar seu jogo.
3. O avaliador recebe o link da avaliação com ambos os nicks preenchidos. A página também está em **/tryout** para a equipe autorizada.
4. Entre no painel real com sua conta da equipe e confirme o Discord **1480009495915659494** em **Meu Discord**. Só o avaliador vinculado pode registrar o resultado.
5. Informe um número entre 0 e 100. A comparação com 50% é automática e o resultado é publicado no canal.
6. Se aprovado, o bot concede acesso provisório e envia o link pessoal do cadastro e o painel de membros. O participante confirma seu Discord por código privado, preenche os dados e cria a senha.
7. O cadastro concluído mantém o acesso e permite emitir a carteira. Caso expire, o sistema registra a reprovação, remove o acesso e tenta avisar por DM. Falhas de Discord ficam registradas para reenvio no painel.

O prazo fica no banco e é conferido pelo bot; após uma interrupção, os vencimentos são processados na retomada. A aplicação precisa permanecer ligada para executar as ações no Discord. A remoção de cargos não depende do sucesso da mensagem privada.

Se o canal privado for apagado ou sua criação falhar, clicar novamente no painel recupera a tentativa em andamento. Ao sair e voltar ao servidor, o bot recalcula o acesso. Corrigir o nome ou a build de um membro mantém sua aprovação e atualiza a versão da carteira; trocar o Discord exige uma nova admissão.

## Configuração e execução

1. Instale Node 22.12+ e rode `npm ci`.
2. Copie **.env.example** para **.env** e preencha token do bot, PostgreSQL, segredo de sessão e administrador inicial. Nenhum segredo foi incluído na entrega.
3. Em produção use `NODE_ENV=production`, `APP_ORIGIN=https://seu-dominio` e PostgreSQL com `sslmode=verify-full`. APP_ORIGIN precisa ser acessível aos participantes para os links funcionarem.
4. Ative **Server Members Intent** do bot e instale com os escopos **bot** e **applications.commands**. Deixe Interactions Endpoint URL vazio, pois o bot recebe interações pelo Gateway.
5. Dê ao bot Gerenciar canais, Gerenciar cargos, Ver canais, Enviar mensagens, Incorporar links, Anexar arquivos, Ler histórico, Conectar e Falar. Gerenciar servidor permite renomear o servidor; Criar convite permite guardar o convite. Posicione seu cargo acima dos cargos gerenciados.
6. Rode `npm start`. O schema é atualizado automaticamente, preservando as contas existentes. Execute uma instância do bot.
7. Execute **/criar** como dono/administrador do servidor e confirme o inventário devolvido pelo bot.

Para Render, o blueprint está em **render.yaml**. Build: `npm ci --omit=dev`; start: `npm start`; health check: **/health**. Prefira um serviço que permaneça ativo para cumprir os prazos.

### Variáveis do tryout

| Variável | Valor desta entrega |
|---|---|
| TRYOUT_EVALUATOR_DISCORD_ID | 1480009495915659494 |
| TRYOUT_PASS_PERCENT | 50 |
| TRYOUT_REGISTRATION_HOURS | 48 |

ALLIANCE_INVITE_URL é opcional; nenhum parceiro é presumido pela nova identidade.

## /criar e IDs

A configuração salva canais, categorias, cargos e servidor no estado persistido. Recursos reconhecidos são atualizados; IDs de recursos ausentes são substituídos pelos novos. Repetir o comando recupera uma configuração interrompida sem duplicar a estrutura conhecida. Em atualização, os antigos DIV_1_* podem servir como referência inicial; depois os IDs salvos no banco prevalecem. A estrutura gerenciada é atualizada sem excluir canais pessoais ou históricos.

A estrutura possui áreas próprias para **Westbound**, **Deepwoken** e **Klase**, com chat, grupos, guias e voz. Canais específicos de Deepwoken ficam em suas áreas; convivência, avisos e atendimento são compartilhados. Tryouts anteriores à atualização permanecem identificados como Deepwoken.

### /configurar cargos e /configurar permissoes

Depois de executar `/criar`, o dono ou administrador do Discord pode usar:

- **/configurar cargos**: cria ou recupera os cargos gerenciados, salva os IDs e coloca a atribuição automática na fila do bot. Membros marcados como verificados no painel recebem **Juramentado** e o cargo da patente cadastrada, inclusive os registros que não possuem tentativa de tryout nem conta antiga no portal. Líder, Sub líder, High member e Moderador também recebem **Conselho**. Examinador/Recrutador recebe Examinador; Iniciado/Novato recebe Iniciado; Aliado recebe Guilda aliada. As patentes PvP, PvE, Artífice de builds e Explorador também recebem o cargo correspondente. Cargos sem relação com o bot são preservados. Aprovados dentro das 48 horas recebem somente o acesso provisório até concluir o cadastro.
- **/configurar permissoes**: reaplica as permissões nos canais e categorias gerenciados já salvos. Canais individuais de tryout e atendimento mantêm seus participantes e sua privacidade. Para criar categorias novas ou recuperar canais apagados, use `/criar`.

As ações consultam a situação atual do cadastro. HB-IDs não verificados ou revogados e tentativas reprovadas, expiradas, pendentes ou canceladas não recebem cargos. Marcar o perfil como verificado não anula uma dessas tentativas. O bot precisa estar conectado e acima dos cargos que atribui; o comando informa problemas de hierarquia ou permissões. Nenhuma patente concede automaticamente acesso administrativo ao site.

Para os cargos do Discord, um perfil verificado sem tentativa de tryout já é suficiente; não é necessário criar uma conta antiga no portal. A emissão da carteira e o acesso pessoal ao portal mantêm suas próprias validações de cadastro e admissão. Nesses fluxos, membros que já estavam verificados e possuíam conta ativa no portal são preservados por um registro único da migração. Isso não cria resultados de tryout e não inclui cadastros posteriores. Uma nova tentativa reprovada ou expirada prevalece sobre essa preservação. Membros sem admissão válida devem concluir o fluxo de tryout e confirmação para usar o portal e a carteira.

## Carteiras e painéis

- **/membros**: conta do membro, carteira, mural e atendimentos.
- **/painel**: equipe, membros, convites, avisos, embeds e operações.
- **/tryout**: fila e avaliações exclusivas do avaliador vinculado.
- **/ver-sua-carteira**: envia a carteira do próprio titular por DM.
- HB-ID tem 16 dígitos e agora é representado pelo **HBCode 1.0**, com dados assinados. Trocar o nome público não troca as chaves nem os identificadores existentes. Os nomes internos `idrkc` e `ifj` permanecem apenas para compatibilidade.

A demonstração aceita qualquer login. O sistema real continua exigindo senha, sessão, confirmação do Discord e verificação de autorização. Carteiras demonstrativas não são credenciais de produção.

## Atualização das carteiras para HBCode 1.0

O HBCode substitui somente a faixa do antigo código de barras. É um formato próprio de matriz, com marcadores, verificação de integridade e o mesmo identificador autenticado já usado pelo bot. O leitor usa os pixels da imagem; não depende do nome do arquivo nem de metadados. A assinatura, o titular no Discord, a versão, a revogação e a admissão continuam sendo conferidos no registro real.

Após reiniciar a aplicação com esta versão, use o comando existente **`/ver-sua-carteira`** ou baixe novamente a carteira no portal. A imagem é gerada com HBCode usando o mesmo cadastro, ID, chave e versão. Não é necessário executar `/criar`, alterar cargos ou migrar o banco por causa desta troca. Imagens já enviadas em mensagens antigas não são editadas; a reemissão é individual, sem disparo de mensagens em massa.

Carteiras antigas com Code128 assinado continuam aceitas pelo mesmo fluxo e pelas mesmas validações. Todos os novos arquivos emitidos usam HBCode. A leitura continua nos formulários e botões existentes do Discord; o acesso por arquivo no portal já existente também preserva sua confirmação privada. Não foi criado scanner, câmera, aplicativo ou comando novo.

O HBCode não torna uma imagem incopiável. Uma cópia não autoriza outro Discord, e texto visível editado na carteira não substitui os dados consultados no banco. O formato e seus limites estão em [docs/HBCODE-PROTOCOL.md](docs/HBCODE-PROTOCOL.md); os resultados executados estão em [VALIDACAO-HBCODE.md](VALIDACAO-HBCODE.md).

## Verificação

`npm test` executa testes de APIs, banco, permissões, tryout e carteiras com Discord simulado. `npm run check` confere sintaxe. `npm run carteiras:exemplos` gera as carteiras ilustrativas em **../EXEMPLOS**. A atualização HBCode passou nos **297 testes** da suíte completa; resultados e limites atuais estão em **VALIDACAO-HBCODE.md**. O relatório anterior da atualização multijogos está em **VALIDACAO-HRISTE-BOZE.md**.

Canais privados usam permissões explícitas. Dono e contas com Administrator mantêm o acesso inerente do Discord: [documentação oficial de permissões](https://github.com/discord/discord-api-docs/blob/main/developers/topics/permissions.mdx).
