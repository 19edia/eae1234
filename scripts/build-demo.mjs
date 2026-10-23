// Rebuild the portable demo without network or package dependencies.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';

const source = new URL('../public/', import.meta.url);
const [template, css, codec, demo] = await Promise.all([
  readFile(new URL('teste.html', source), 'utf8'),
  readFile(new URL('demo.css', source), 'utf8'),
  readFile(new URL('hbcode-codec.js', source), 'utf8'),
  readFile(new URL('demo.js', source), 'utf8'),
]);
// The shared codec has no imports or browser scanner. Inline its exact generator
// so the portable HTML works from disk without a module loader or network.
const codecScript = codec.replace(/^export (?=(?:const|let|var|function|class)\b)/gm, '');
const demoScript = demo.replace(/^import \{ hbcodeSvg \} from '\.\/hbcode-codec\.js';\r?\n/m, '');
if (demoScript === demo || /^\s*(?:import|export)\b/m.test(codecScript)) {
  throw new Error('O gerador compartilhado de HBCode não pôde ser incorporado.');
}
const js = `(() => {\n${codecScript}\n${demoScript}\n})();`;
new Script(js, { filename: 'demo.js' });
const html = template
  .replace('<link rel="stylesheet" href="demo.css">', () => `<style>\n${css.replace(/^@charset[^;]+;\s*/, '')}\n</style>`)
  .replace('<script type="module" src="demo.js"></script>', () => `<script>\n${js.replace(/<\/script/gi, '<\\/script')}\n</script>`);
if (html === template || /(?:src|href)="(?:demo\.(?:js|css)|hbcode-codec\.js)"/.test(html)) {
  throw new Error('Não foi possível incorporar os arquivos da demonstração.');
}
const destination = new URL('../../TESTE-HRISTE-BOZE.html', import.meta.url);
await writeFile(destination, html, 'utf8');
console.log(`Demo offline atualizada: ${fileURLToPath(destination)}`);
