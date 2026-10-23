import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext, Script } from 'node:vm';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { hbcodeSvg } from '../public/hbcode-codec.js';
import { decodeCardBarcode } from '../src/barcode.js';
import { parseCardPayload, verifyCardPayload } from '../src/idrkc.js';

const source = readFileSync(new URL('../public/demo.js', import.meta.url), 'utf8');
const executableSource = source.replace(/^import \{ hbcodeSvg \} from '\.\/hbcode-codec\.js';\r?\n/m, '');
const storageKey = 'hriste-boze-demo-v1';
const games = [['westbound', 'Westbound'], ['deepwoken', 'Deepwoken'], ['klase', 'Klase']];

// Exercise the public event handlers without exposing implementation internals.
// This is a DOM simulation, not a visual or native browser validation.
function boot(saved) {
  const clock = Date.parse('2026-10-22T15:00:00.000Z');
  class DemoDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  const storage = new Map(saved ? [[storageKey, JSON.stringify(saved)]] : []);
  const elements = new Map();
  const downloads = [];
  const radios = new Map();
  function element(id) {
    if (!elements.has(id)) {
      elements.set(id, {
        innerHTML: '', style: {}, children: [],
        classList: { add() {}, remove() {}, toggle() { return true; } },
        addEventListener(type, handler) { this[type] = handler; },
        focus() {}, setAttribute() {},
        querySelector() { return { focus() {} }; },
        querySelectorAll() { return []; },
      });
    }
    return elements.get(id);
  }
  class Form {
    constructor(id, data, dataset) { Object.assign(this, { id, data, dataset }); }
    reportValidity() { return true; }
  }
  const document = {
    getElementById: element, activeElement: { focus() {} }, title: '',
    body: { style: {}, appendChild() {} }, addEventListener() {},
    querySelector(selector) {
      if (!radios.has(selector)) radios.set(selector, { checked: false });
      return radios.get(selector);
    },
    createElement() { return { click() {}, remove() {} }; },
  };
  runInNewContext(executableSource, {
    hbcodeSvg,
    document,
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    HTMLFormElement: Form,
    FormData: class {
      constructor(form) { this.data = form.data; }
      get(key) { return this.data[key] ?? null; }
    },
    window: { scrollTo() {} }, setTimeout() {}, clearTimeout() {}, setInterval() {},
    Blob, Date: DemoDate,
    URL: { createObjectURL(blob) { downloads.push(blob); return 'blob:demo'; }, revokeObjectURL() {} },
  }, { filename: 'demo.js' });
  return {
    element, downloads,
    state() { return JSON.parse(storage.get(storageKey)); },
    html() { return element('app').innerHTML; },
    click(action, data = {}) {
      element('app').click({ target: { closest: () => ({ dataset: { action, ...data } }) }, preventDefault() {} });
    },
    submit(id, data = {}, dataset = {}) {
      element('app').submit({ target: new Form(id, data, dataset), preventDefault() {} });
    },
    change(dataset, value, checked) { element('app').change({ target: { dataset, value, checked } }); },
  };
}

function login(demo) { demo.submit('login-form', { nick: 'Teste multijogos', password: 'qualquer' }); }
function createTrial(demo, participant, game) {
  demo.click('new-tryout');
  demo.submit('create-tryout-form', { participant, game });
  return demo.state().tryouts[0];
}
function evaluate(demo, trial, damage) { demo.submit('evaluate-form', { damage }, { id: trial.id }); }

test('offline login accepts arbitrary credentials and every portal section renders', () => {
  const demo = boot();
  login(demo);
  assert.match(demo.html(), /Três jogos\./);
  for (const page of ['dashboard', 'tryouts', 'members', 'wallet', 'builds', 'messages', 'settings']) {
    demo.click('navigate', { page });
    assert.ok(demo.html().length > 1000, page);
    assert.doesNotMatch(demo.html(), /\bundefined\b/, page);
  }
  demo.click('logout');
  demo.submit('login-form');
  assert.equal(demo.state().user, 'Aventureiro');
});

test('all three games are offered and a game is required before creating a tryout', () => {
  const demo = boot();
  login(demo);
  demo.click('new-tryout');
  for (const [id, name] of games) {
    assert.ok(demo.html().includes(`type="radio" name="game" value="${id}" required`));
    assert.ok(demo.html().includes(`data-game="${id}"`), name);
  }
  demo.submit('create-tryout-form', { participant: 'Sem jogo' });
  demo.submit('create-tryout-form', { participant: 'Jogo inválido', game: 'inventado' });
  assert.equal(demo.state().tryouts.length, 0);
});

test('each game survives approval, registration, card rendering and SVG download', async () => {
  const demo = boot();
  login(demo);
  for (const [game, name] of games) {
    const trial = createTrial(demo, `Teste ${name}`, game);
    assert.equal(trial.game, game);
    assert.ok(demo.html().includes(name));
    evaluate(demo, trial, '50');
    assert.equal(demo.state().tryouts[0].status, 'provisional');
    assert.equal(demo.state().tryouts[0].roleGranted, true);
    demo.click('register', { id: trial.id });
    const modal = demo.element('modal-root').innerHTML;
    assert.ok(modal.includes(name));
    assert.equal(modal.includes('register-race'), game === 'deepwoken');
    assert.equal(modal.includes('register-oath'), game === 'deepwoken');
    demo.submit('register-form', {
      roblox: `R${game}`, terms: 'on',
      ...(game === 'deepwoken' ? { race: 'Adret', oath: 'Oathless' } : {}),
    }, { id: trial.id });
    const member = demo.state().members.at(-1);
    assert.equal(demo.state().tryouts[0].status, 'registered');
    assert.equal(member.game, game);
    assert.equal(member.hbidVerified, true);
    assert.ok(demo.html().includes(name));
    demo.click('download-card', { id: member.id });
    assert.ok((await demo.downloads.at(-1).text()).includes(name));
    demo.click('view-card', { id: member.id });
    demo.click('flip-card');
    demo.click('download-card', { id: member.id });
    const reverse = await demo.downloads.at(-1).text();
    assert.ok(reverse.includes(name));
    assert.ok(reverse.includes('VERSO / 02'));
    demo.click('close-modal');
    demo.click('navigate', { page: 'tryouts' });
    assert.ok(demo.html().includes(member.name));
  }
});

test('49.99% fails; 48 hours without registration revokes provisional access and records a DM', () => {
  const demo = boot();
  login(demo);
  let trial = createTrial(demo, 'Negado', 'klase');
  evaluate(demo, trial, '49.99');
  assert.equal(demo.state().tryouts[0].status, 'rejected');
  assert.equal(demo.state().tryouts[0].roleGranted, false);
  trial = createTrial(demo, 'Expirou', 'westbound');
  evaluate(demo, trial, '75');
  const approved = demo.state().tryouts[0];
  assert.equal(approved.deadline - approved.evaluatedAt, 48 * 3600000);
  demo.click('expire-trial', { id: trial.id });
  assert.equal(demo.state().tryouts[0].status, 'expired');
  assert.equal(demo.state().tryouts[0].roleGranted, false);
  assert.ok(demo.state().logs.some(log => log.kind === 'DM' && log.participant === 'Expirou' && /prazo de 48 horas terminou/.test(log.text)));
  demo.click('register', { id: trial.id });
  assert.doesNotMatch(demo.element('modal-root').innerHTML, /register-form/);
});

test('role synchronization requires verified HB-ID and uses the recorded rank', () => {
  const demo = boot();
  login(demo);
  demo.click('navigate', { page: 'settings' });
  demo.change({ verifyMember: 'HB-ID-0001' }, null, false);
  demo.change({ rankMember: 'HB-ID-0002' }, 'Líder');
  demo.click('configure-roles');
  assert.deepEqual(demo.state().members[0].assignedRoles, []);
  assert.deepEqual(demo.state().members[1].assignedRoles, ['Líder', 'Conselho', 'Juramentado']);
  demo.change({ rankMember: 'HB-ID-0002' }, 'Membro');
  demo.click('configure-roles');
  assert.deepEqual(demo.state().members[1].assignedRoles, ['Juramentado']);
  demo.click('configure-permissions');
  assert.ok(demo.state().permissionsConfigured > 0);
  assert.ok(demo.state().logs.some(log => log.kind === 'COMANDO' && log.text.includes('/configurar permissoes')));
});

test('every registered rank synchronizes for panel-verified members without a prior tryout or portal account', () => {
  const demo = boot();
  login(demo);
  demo.click('navigate', { page: 'settings' });
  assert.equal(demo.state().tryouts.length, 0);
  const expected = new Map([
    ['Líder', ['Líder', 'Conselho', 'Juramentado']],
    ['Sub líder', ['Sub líder', 'Conselho', 'Juramentado']],
    ['High member', ['High member', 'Conselho', 'Juramentado']],
    ['Moderador', ['Moderador', 'Conselho', 'Juramentado']],
    ['Examinador', ['Examinador', 'Juramentado']],
    ['Veterano', ['Veterano', 'Juramentado']],
    ['Iniciado', ['Iniciado', 'Juramentado']],
    ['Membro', ['Juramentado']],
    ['Aliado', ['Guilda aliada', 'Juramentado']],
    ['PvP', ['PvP', 'Juramentado']],
    ['PvE', ['PvE', 'Juramentado']],
    ['Artífice de builds', ['Artífice de builds', 'Juramentado']],
    ['Explorador', ['Explorador', 'Juramentado']],
  ]);
  for (const [rank, roles] of expected) {
    assert.ok(demo.html().includes(`>${rank}</option>`), `select exposes ${rank}`);
    demo.change({ rankMember: 'HB-ID-0002' }, rank);
    demo.click('configure-roles');
    const member = demo.state().members[1];
    assert.equal(member.role, rank);
    assert.deepEqual(member.assignedRoles, roles, rank);
  }
  demo.change({ verifyMember: 'HB-ID-0002' }, null, false);
  demo.click('configure-roles');
  assert.deepEqual(demo.state().members[1].assignedRoles, []);
});

test('verified HB-ID cannot recover roles with a rejected, expired, pending or cancelled admission', () => {
  const demo = boot();
  login(demo);
  const saved = demo.state();
  for (const status of ['rejected', 'expired', 'pending', 'cancelled', 'provisional']) {
    const member = saved.members[0];
    member.hbidVerified = true;
    member.assignedRoles = ['Líder', 'Conselho', 'Juramentado'];
    saved.tryouts = [{ id: `BAD-${status}`, game: 'klase', participant: member.name, status, deadline: Date.now() + 3600000 }];
    const blocked = boot(saved);
    login(blocked);
    blocked.click('configure-roles');
    assert.deepEqual(blocked.state().members[0].assignedRoles, [], status);
  }
});

test('old saved data migrates to Deepwoken without losing records and reset remains usable', () => {
  const demo = boot();
  login(demo);
  createTrial(demo, 'Registro antigo', 'deepwoken');
  const old = demo.state();
  for (const member of old.members) {
    delete member.game; delete member.hbidVerified; delete member.assignedRoles;
  }
  for (const trial of old.tryouts) delete trial.game;
  old.members[0].role = 'Comandante';
  const migrated = boot(old);
  login(migrated);
  assert.equal(migrated.state().tryouts.length, 1);
  assert.equal(migrated.state().tryouts[0].participant, 'Registro antigo');
  assert.ok(migrated.state().tryouts.every(trial => trial.game === 'deepwoken'));
  assert.ok(migrated.state().members.every(member => member.game === 'deepwoken'));
  assert.equal(migrated.state().members[0].role, 'Líder');
  migrated.click('confirm-reset');
  migrated.click('navigate', { page: 'settings' });
  migrated.click('configure-roles');
  assert.equal(migrated.state().members.length, 5);
  assert.equal(migrated.state().tryouts.length, 0);
  assert.ok(migrated.state().members[0].assignedRoles.includes('Conselho'));
  assert.equal(new Set(migrated.state().members.map(member => member.game)).size, 3);
});

test('standalone HTML contains the current inline JS and CSS without external demo dependencies', () => {
  const html = readFileSync(new URL('../../TESTE-HRISTE-BOZE.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../public/demo.css', import.meta.url), 'utf8');
  const codec = readFileSync(new URL('../public/hbcode-codec.js', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /(?:src|href)="(?:demo\.(?:js|css)|hbcode-codec\.js)"/);
  assert.ok(html.includes(css.replace(/^@charset[^;]+;\s*/, '')));
  const inline = html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
  assert.ok(inline);
  const expected = `(() => {\n${codec.replace(/^export (?=(?:const|let|var|function|class)\b)/gm, '')}\n${executableSource}\n})();`;
  assert.equal(inline.trim(), expected.replace(/<\/script/gi, '<\\/script').trim());
  assert.doesNotThrow(() => new Script(inline, { filename: 'standalone-demo.js' }));
});

test('demo replaces only the front barcode slot and preserves the existing reverse crest', async () => {
  const demo = boot();
  login(demo);
  assert.match(demo.html(), /class="hbcode"/);
  assert.doesNotMatch(demo.html(), /class="barcode"/);
  assert.match(demo.html(), /HBCode 1\.0 de demonstração, sem validade oficial/);
  demo.click('download-card', { id: 'HB-ID-0001' });
  const front = await demo.downloads.at(-1).text();
  assert.match(front, /width="4800" height="3000" viewBox="0 0 1200 750"/);
  assert.match(front, /x="890" y="577" width="205" height="55"/);
  assert.match(front, /DEMONSTRAÇÃO LOCAL · SEM VALIDADE OFICIAL/);
  demo.click('view-card', { id: 'HB-ID-0001' });
  demo.click('flip-card');
  demo.click('download-card', { id: 'HB-ID-0001' });
  const reverse = await demo.downloads.at(-1).text();
  assert.match(reverse, /M936 260h132v108l-66 72-66-72V260Z/);
  assert.match(reverse, /VERSO \/ 02/);
  assert.doesNotMatch(reverse, /HBCode 1\.0/);
});

test('exported full demo cards decode to distinct deterministic test identities but fail production authentication', async () => {
  const demo = boot();
  login(demo);
  const payloads = [];
  for (const id of ['HB-ID-0001', 'HB-ID-0002']) {
    demo.click('download-card', { id });
    const svg = await demo.downloads.at(-1).text();
    demo.click('download-card', { id });
    assert.equal(await demo.downloads.at(-1).text(), svg);
    const image = await loadImage(Buffer.from(svg));
    const canvas = createCanvas(image.width, image.height);
    canvas.getContext('2d').drawImage(image, 0, 0);
    const payload = await decodeCardBarcode(await canvas.encode('png'));
    payloads.push(payload);
    const identity = parseCardPayload(payload);
    assert.match(identity.idrkc, /^99\d{14}$/);
    assert.equal(identity.version, 1);
    assert.equal(payload.slice(30), '0'.repeat(30));
    const member = { idrkc: identity.idrkc, discord_id: '1480009495915659494', card_secret: 'a336190a-f3c4-4a79-bd18-f3a4ba749cad', identity_version: 1, verified: true };
    await assert.rejects(verifyCardPayload({ query: async () => ({ rows: [member] }) }, payload, { discordId: member.discord_id }), { code: 'CARD_SIGNATURE_INVALID' });
  }
  assert.notEqual(payloads[0], payloads[1]);
});
