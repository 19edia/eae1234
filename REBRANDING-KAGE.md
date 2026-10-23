> Histórico preservado da versão anterior. Para a HRISTE BOZE, siga [README.md](README.md) e [VALIDACAO-HRISTE-BOZE.md](VALIDACAO-HRISTE-BOZE.md). As regras atuais são tryout de 50% e cadastro em 48 horas.

# Kage · nova direção visual

O rebranding usa tipografia editorial condensada, preto profundo e laranja, com texto em branco suave, com uma ilustração exclusiva do distrito. Administração, acesso da equipe, portal dos membros e estúdio de embeds compartilham essa identidade.

## Arte

Arquivo: `public/kage-district-art.png`. Gerado com a ferramenta integrada ImageGen, sem CLI. O original foi copiado para o projeto; a aplicação não depende de caminhos externos.

Prompt final:

> Use case: stylized-concept. Asset type: production background art for ROKUHARA KAGE CLAN web dashboard, desktop landscape hero, not a UI mockup. Create an exceptionally crafted cinematic Japanese urban district illustration in a refined anime environment / editorial art direction. A quiet monumental torii gate and old Japanese rooftops emerging through dark smoky atmosphere, rain-dark street, an immense muted burnt-orange sun low in the fog behind the buildings on the RIGHT half. Restrained ember vermilion accents, charcoal ink black architecture, warm ivory subtle highlights, detailed matte grain textures and sophisticated screen-print influenced shading. Composition: wide 3:2 landscape; visual architectural detail concentrated on the rightmost 60%; LEFT 40% very dark atmospheric empty space suitable for white web text overlay, smoothly fading to near-black #0d0f10 without a hard seam. Slight low angle perspective. Premium clan gaming community identity, powerful but quiet, high contrast balanced, carefully layered depth, beautifully precise silhouettes. NO people, NO weapons, NO flames, NO text, NO letters, NO logos, NO watermark, NO UI controls, no neon cyberpunk purple, no excessive bloom. Deliver polished original artwork with a single strong focal silhouette and generous negative space.

## Tipografia

Manrope e Barlow Condensed são servidas localmente em `public/fonts`, com licenças OFL incluídas. Fontes obtidas do [repositório oficial Google Fonts](https://github.com/google/fonts): famílias `ofl/manrope` e `ofl/barlowcondensed`. A interface não consulta serviços de fontes externos.

## Implementação

- `kage-brand.css`: paleta, tipografia, foco e redução de movimento.
- `admin-theme.css`: administração, diretório, filtros, formulários, navegação e modais.
- `member-theme.css` e `access-theme.css`: membro e acessos.
- `studio-theme.css`: editor JSON e histórico de publicações.

O rebranding preserva os cadastros, as permissões e os endpoints do sistema. A pasta `EXEMPLOS` contém capturas com dados fictícios.

## Convites IDRKC

A criação administrativa passou a ter dois campos: patente e tipo. A nova página `/cadastro/:token` conduz o membro por dados pessoais, seleção do perfil Discord real, confirmação privada e senha. O resultado inclui boas-vindas, IDRKC, download da carteira e redirecionamento ao portal com contagem pausável. Tokens são de uso único, expiram em 48 horas e são armazenados somente como hash.

A paleta das superfícies e indicadores é preto/cinza neutro com laranja; os verdes foram removidos. Embeds enviados pela administração preservam as cores definidas no próprio JSON, para manter a mesma aparência do conteúdo publicado no Discord.
