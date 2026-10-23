> Histórico preservado da versão anterior. Para a HRISTE BOZE, siga [README.md](README.md) e [VALIDACAO-HRISTE-BOZE.md](VALIDACAO-HRISTE-BOZE.md). As regras atuais são tryout de 50% e cadastro em 48 horas.

# Atualização IDRKC · ROKUHARA KAGE CLAN

1. Faça backup do banco atual e publique o conteúdo da pasta projeto no repositório que seu serviço Render utiliza.
2. Mantenha as variáveis e o banco existentes. Build: npm ci --omit=dev. Start: npm start. Execute uma única instância do bot.
3. A atualização do esquema é automática e preserva contas e senhas. Se o SBI ainda não estiver configurado, execute /criar no servidor atual da primeira divisão.
4. O bot atualiza os botões de denúncia/ticket e coloca as carteiras novas dos membros verificados na fila. Ele só envia ao titular presente no distrito.
5. No painel administrativo, abra Estúdio de embeds para publicar JSON nos avisos e no mural. Em Bot e histórico, acompanhe entregas e tente novamente após corrigir privados bloqueados.
6. Os membros entram com o IDRKC da nova carteira e sua senha anterior. Primeiro acesso exige confirmação no Discord vinculado.

Denúncias: própria carteira + nick da pessoa denunciada. Tickets: própria carteira. As solicitações aparecem para o titular em Meus atendimentos e para a administração no painel.

Este pacote foi validado localmente. Consulte VALIDACAO.md para a cobertura e README.md para os detalhes.
