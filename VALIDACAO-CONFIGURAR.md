# /configurar cargos — HRISTE BOZE

Atualização de 23/10/2026, somente na cópia HRISTE-BOZE-DEEPWOKEN-2026-10-15.

O comando agora atribui Juramentado e a patente cadastrada aos membros verificados no painel, mesmo quando não têm histórico de tryout ou conta antiga no portal. A atribuição usa o ID Discord salvo no cadastro. Líder, Sub líder, High member e Moderador também recebem Conselho. PvP, PvE, Artífice de builds e Explorador participam da atribuição, remoção e validação de permissões.

Uma tentativa atual pendente, reprovada, expirada ou cancelada continua bloqueando o acesso, assim como uma carteira revogada. Aprovados dentro do prazo de cadastro recebem apenas o acesso provisório. O comando não modifica a verificação, a patente nem o HB-ID no banco. Cargos sem relação com o bot são preservados. As validações de cadastro do portal e da carteira continuam próprias.

## Ativação

Reinicie o bot usando o código atualizado desta cópia e execute **/configurar cargos** como dono ou administrador do servidor. O bot salva os IDs e processa automaticamente a fila de atribuições; seu cargo precisa estar acima dos cargos gerenciados. Em um servidor ainda sem estrutura, execute **/criar** primeiro. **/configurar permissoes** continua disponível para reaplicar as permissões dos canais e categorias.

O comando foi validado com banco local de testes e Discord simulado. Nenhum comando foi executado no Discord real nesta atualização.

## Verificações

- A suíte completa passou: **303 testes, zero falhas**, com `node --test --test-concurrency=1`. Log local: `teste-configurar-final.log`.
- Cinco testes de integração passaram pelo comando real, fila e worker, cobrindo todas as patentes, identidade Discord, bloqueios, troca de patente, remoção da verificação, reinício, reentrada e repetição sem duplicar operações.
- Onze testes da demonstração passaram, incluindo sincronização de patentes e decodificação das carteiras HBCode.
- A sintaxe dos sete arquivos de produção alterados foi validada.
- Os 165 arquivos originais foram comparados ao manifesto SHA-256: nenhuma alteração.

O arquivo **../TESTE-HRISTE-BOZE.html** foi reconstruído. Aceita qualquer login de demonstração; em **Configurações**, permite marcar a verificação, escolher a patente e simular **/configurar cargos**.
