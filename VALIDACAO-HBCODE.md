# HBCode 1.0 — implementação e validação

Atualização de 23/10/2026, somente na cópia `HRISTE-BOZE-DEEPWOKEN-2026-10-15`. O inventário SHA-256 confirmou os 165 arquivos originais intactos.

## Integração realizada

A inspeção identificou `src/cards.js` como gerador, `src/barcode.js` e `src/barcode-worker.js` como transporte/leitor, `src/idrkc.js` como verificador da identidade, e os formulários `verify-card-form`, `ticket-card-form` e `report-card-form` como os fluxos existentes do Discord. O portal também já usava o mesmo leitor para seu acesso por arquivo.

O gerador agora desenha HBCode na faixa **x=542, y=902, largura=950, altura=88** da carteira de 1600 × 1100. Todo o resto do desenho foi preservado. A comparação executada dos cinco modelos encontrou **zero pixels alterados fora dessa faixa**. Na demonstração, a comparação da frente também encontrou zero alterações fora do antigo código, e o SVG do verso permaneceu idêntico.

O formato próprio transporta o mesmo identificador assinado em uma matriz binária: cabeçalho, versão, dados em BCD e CRC-32. Dois blocos devem ser válidos e concordar. Os marcadores e o monograma são vetoriais; não foi usado QR Code. A descrição técnica está em [docs/HBCODE-PROTOCOL.md](docs/HBCODE-PROTOCOL.md).

A leitura de pixels roda no worker já existente. O backend continua validando a assinatura HMAC vinculada ao Discord, o cadastro verdadeiro, a revisão, a revogação, as autorizações e a admissão. CRC não substitui autenticação. Os nomes e patentes apresentados pelo bot vêm do banco, mesmo que alguém edite o texto visível na imagem. Códigos válidos copiados por outro usuário não dão acesso.

## Preservação e reemissão

- Nenhum schema, ID, segredo, registro, senha, cargo ou permissão foi alterado por esta implementação.
- A API interna de geração/leitura foi mantida para integrar emissão, portal, denúncias, atendimento e verificação. Não foi acrescentado comando, aplicativo, scanner web ou login.
- Carteiras antigas com Code128 assinado continuam sendo lidas e verificadas pelas mesmas regras. Códigos arbitrários antigos não são aceitos como identidade.
- Após atualizar e reiniciar a aplicação, `/ver-sua-carteira` ou o download já existente no portal gera a imagem com HBCode. Não é necessário `/criar` para esta atualização.
- Não há troca automática das imagens já publicadas em mensagens antigas nem envio coletivo. A reemissão usa o registro atual e preserva ID, chave e revisão; as verificações antigas de revogação continuam valendo.
- O HTML portátil contém o gerador real com identidades fictícias e assinatura inválida para produção. As imagens de `EXEMPLOS` também são ilustrativas.

## Evidências reproduzíveis

**Suíte completa executada em 23/10/2026: 297 testes aprovados, 0 falhas, 0 cancelados e 0 ignorados, em 210,2 segundos.** Comando: `node --test --test-concurrency=1`. Registro integral: [teste-hbcode-final.log](teste-hbcode-final.log). Inclui os fluxos anteriores de tryout, cadastro, cargos, atendimento e login, além do novo HBCode.

A rodada específica de codificação, imagens e preservação aprovou **33/33 testes**, registrada em `teste-hbcode-codec-final.log`. A demonstração aprovou seus 10 testes e foi reconstruída com o gerador final. Os 66 arquivos JavaScript de `src`, `public` e `scripts` passaram em `node --check`. Os testes específicos também estão incluídos na suíte completa.

Execute os comandos dentro de `projeto`:

```powershell
node --test --test-concurrency=1
node scripts/build-demo.mjs
node .validation/demo-preservation.mjs
node scripts/render-examples.js
```

Os testes cobrem codificação determinística, leitura do código e da carteira inteira, PNG/JPEG/WebP, recorte, redução para 80%, rotações e inclinação leve; diferentes titulares; dados adulterados; assinatura falsa; dono incorreto; versão antiga; revogação; cadastro inexistente; múltiplas regiões e compatibilidade com o código antigo.

O teste do bot usa o roteador `createBot`, os campos de anexo do Discord, download simulado, o decodificador real de pixels e PostgreSQL embarcado. O teste do SVG da demonstração rasteriza o arquivo inteiro de 4800 × 3000 pixels, lê o HBCode e confirma que sua assinatura fictícia não autentica uma conta real.

As referências visuais anteriores foram capturadas antes da alteração e estão em `test/fixtures/hbcode-before/`. O teste `hbcode-layout.test.js` as compara com a geração atual. A referência e a comparação da demonstração estão em `../HBCODE-1.0-baseline-demo/` e `.validation/demo-preservation.mjs`.

## Limites

- A integração foi exercitada com banco local e Discord simulado. O bot não foi conectado ao servidor de produção e nenhum dado de membro real foi modificado.
- Foram inspecionadas as imagens geradas. Não foi realizada nova validação interativa no navegador nesta atualização.
- A imagem de referência mencionada no pedido não estava anexada; o desenho segue a descrição textual: preto/dourado, HB central, cruz, escudo, espada e geometria.
- O leitor foi preparado para arquivos digitais. Não há garantia para fotos em perspectiva forte, desfoque intenso, reflexos, códigos cortados, mudança das cores ou miniaturas muito pequenas. Prefira o PNG original.
- Os dois blocos precisam passar na integridade. A versão 1.0 rejeita danos, sem inventar dados nem tentar corrigir erros não confirmados.
- Os limites existentes permanecem: PNG/JPEG/WebP estático, 8 MB, 8192 pixels por lado e 16 megapixels. A leitura tem timeout, uma tarefa simultânea e limites internos de busca. Ao exceder limites, rejeita a imagem inteira.
- O SVG de demonstração mantém a composição e usa maior resolução intrínseca de exportação para preservar a leitura do código pequeno. A miniatura exibida na interface não é uma credencial oficial.

## Arquivos desta atualização

**Código principal:** `src/hbcode.js`, `public/hbcode-codec.js`, `src/barcode.js`, `src/barcode-worker.js`, `src/cards.js`.

**Textos e comentários necessários, sem trocar os fluxos:** `src/idrkc.js`, `src/card-verification.js`, `src/verified-services.js`, `src/idrkc-delivery.js`, `src/bot.js`, `src/community.js`, `public/member.js`, `public/member.html`.

**Demonstração:** `public/demo.js`, `public/demo.css`, `public/teste.html`, `scripts/build-demo.mjs`, `../TESTE-HRISTE-BOZE.html`.

**Testes:** `test/hbcode.test.js`, `test/hbcode-layout.test.js`, `test/hbcode-bot.test.js`, `test/idrkc.test.js`, `test/card-verification.test.js`, `test/verified-services.test.js`, `test/demo.test.js`, `test/fixtures/hbcode-before/` e `.validation/demo-preservation.mjs`.

**Documentação e artefatos:** `README.md`, `../LEIA-ME.md`, este relatório, `docs/HBCODE-PROTOCOL.md`, as cinco carteiras atualizadas e `hbcode-1.0.png` em `../EXEMPLOS/`, além dos logs e referências locais da validação. Nenhuma dependência foi acrescentada.
