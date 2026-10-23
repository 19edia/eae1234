> Histórico preservado da versão anterior. Para a HRISTE BOZE, siga [README.md](README.md) e [VALIDACAO-HRISTE-BOZE.md](VALIDACAO-HRISTE-BOZE.md). As regras atuais são tryout de 50% e cadastro em 48 horas.

# Validação · carteiras, verificação, acesso e painéis

Verificado localmente em **07/10/2026**.

- **222 testes automatizados aprovados; zero falhas, zero testes ignorados.** Comando: `node --test --test-concurrency=2`.
- Sintaxe de **58 arquivos JavaScript** de `src`, `public` e `scripts` conferida com `node --check`.
- PostgreSQL em memória (PGlite), aplicação Express real e Discord simulado. Nenhum token, banco ou servidor de produção foi utilizado.
- Migração idempotente preserva contas, senhas, vínculos e histórico; IDRKC único de 16 dígitos, nunca reutilizado. Segredos de assinatura ausentes das respostas de API, inclusive resultados aninhados e edição administrativa.
- Leitura real dos pixels Code 128 em PNG/JPEG/WebP, imagem redimensionada, recorte e rotação. Testes de adulteração, titular incorreto, versão antiga, revogação, imagens malformadas, múltiplos códigos e limites de processamento.
- Denúncia só com carteira do denunciante e nick do alvo; cartão inválido não cria caso. Formulário antigo não contorna a conferência. Ticket privado exclui Equipe; mudança de identidade na fila é revalidada; nova carteira recupera abertura com falha sem duplicar ticket/operação.
- Reproduzida e corrigida a recusa de arquivo anexado no formulário: teste com `ModalSubmitFields` e `Attachment` reais do discord.js, URL temporária `ephemeral-attachments`, download simulado e leitura de pixels de um PNG real. URLs normais continuam aceitas; assinaturas de URL são preservadas. Domínios falsos, caminhos externos, redirecionamentos, arquivos grandes e carteira de outro Discord são rejeitados.
- Verificação por arquivo: carteira emitida ainda não verificada aceita para o próprio titular, confirmação única com prazo e vínculo à assinatura/versão, cancelamento e fila de cargos. Testados arquivo inválido, envio de outra pessoa, adulteração, revogação, versão alterada entre envio e confirmação, confirmação por outro usuário, expiração, imigração pendente e servidor incorreto.
- Login por carteira: leitura do PNG, confirmação de presença no distrito, código privado, CSRF/origem, limite de tentativas, sessão isolada e consumo único. Conta existente preserva senha; primeiro acesso exige criá-la. DM bloqueada, saída do servidor, conta suspensa, carteira desatualizada/revogada e mudança de vínculo não liberam acesso. Nenhum dado privado do titular é retornado antes da confirmação do código.
- Reenvio do código renova o prazo da sessão e do cookie para acompanhar o código recém-emitido. Teste de regressão confirma que ele continua utilizável após o prazo anterior, sem reabrir sessões expiradas ou consumidas nem contornar os limites.
- Entregas privadas persistidas, usuário presente no distrito, retentativas após bloqueio de DM, idempotência e revisão de carteira. Avisos à administração usam nonces estáveis e distintos por destinatário, preservando entregas parciais.
- Embeds: validação, permissões, prévia, deduplicação, fila, falhas, reenvio e feed de membros contendo somente payloads entregues ao Discord.
- Mantidos testes de inicialização do Render, espera de HTTP 429, SBI, cargos, moderação, sessões, CSRF, atualização dos painéis e limite de cliques.
- Fotos Discord: **13 testes do serviço de consulta** e **8 testes de integração das rotas**. Conferidos avatar estático, Nitro e padrão com objetos reais do discord.js; URL oficial, ID correto, exclusão de bots, cache, renovação, deduplicação, fila de 20 perfis, limite de concorrência, expiração de espera e respostas tardias. Todas as consultas de rede foram simuladas.
- Rotas de foto exigem sessão e usam o vínculo da conta, ignorando IDs Discord enviados por query. Staff não confirmado não consulta foto. Recrutador/moderador só consulta membros próprios; administrador/sub líder consulta os registros autorizados. Troca de Discord, sessão expirada ou conta desativada não libera perfil do antigo titular. O nome preenchido no cadastro permanece intacto.

- Convites: uso único, expiração/cancelamento, escopo da equipe, alteração de permissões, origem/CSRF, bloqueio após cinco códigos errados, DM bloqueada, identidade duplicada, saída do servidor, conta/sessão e download PNG. Busca Discord testada com servidor configurado, exclusão de bots e confirmação da presença atual.

## Navegador

Edge em modo headless, aplicação real com banco local. Conferidos login administrativo, edição/prévia do JSON, publicação na fila, entrega Discord simulada, login do membro com IDRKC, mural com o mesmo embed, próprios atendimentos e download da carteira PNG. Também conferido o fluxo administrativo com dois campos, link de convite, preenchimento, seleção de perfil, código privado, senha, boas-vindas, download e redirecionamento automático autenticado. Sem erros JavaScript ou violações CSP nos fluxos conferidos.

Na aba **Com carteira**, testados envio de PNG real, prévia, código incorreto, código válido, acesso à identidade autenticada, primeiro acesso com nova senha e saída/novo login com senha. Conferidos usuários com e sem conta anterior em **390 e 1440 px**. Sem erros JavaScript ou violações CSP. As capturas `login-carteira-desktop.png` e `login-carteira-mobile.png` foram inspecionadas visualmente.

Na atualização de perfis, aplicativo e banco reais com Discord/CDN simulados: foto da administração, lista com 20 fotos e paginação, mudança da foto, troca do Discord vinculado em outra aba seguida de Atualizar, foto do membro em boas-vindas/menu/identidade, nome próprio do cadastro, retorno às iniciais quando indisponível e resposta tardia após sair. Conferidos **390 e 1440 px**, sem transbordamento, erros JavaScript ou violações CSP. As três capturas `perfis-*.png` foram inspecionadas visualmente; nomes e avatares nelas são fictícios.

Layouts de administração, membros, acessos e convite em **390, 768 e 1440 px**, sem transbordamento horizontal. As novas capturas e a carteira foram inspecionadas visualmente. `EXEMPLOS` usa exclusivamente dados fictícios.

Esta validação não fez deploy no Render nem enviou mensagens ao Discord real. Publique a pasta `projeto` no serviço existente para ativar a atualização. A configuração do distrito usa `/criar` e os IDs persistidos no SBI.
