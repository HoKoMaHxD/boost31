import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { MessageFlags } from 'discord.js';
import { createCommandHandlers, slashCommands } from '../src/commands.js';
import { PythonProfileReader, PythonReaderBridge } from '../src/python-reader.js';
import { ProfileError } from '../src/profile.js';
import { loadReaderToken, saveReaderToken, TOKEN_MANAGER_ID, UpdatableProfileReader } from '../src/reader-token.js';

const guildId = '333333333333333333', channelId = '444444444444444444';
const targetId = '141947703742562111';
const oldToken = 'fixture-only-placeholder', newToken = 'fixture-replacement-placeholder';
const worker = fileURLToPath(new URL('./fixtures/fake-reader.py', import.meta.url));
let sequence = 0;
function interactions({ userId = TOKEN_MANAGER_ID, reader, now = Date.now, config = {} } = {}) {
  const sent = [], modals = [], logs = [], updates = [];
  const handlers = createCommandHandlers({ reader: reader || { updateToken: async value => updates.push(value) }, config, now,
    logger: { info: value => logs.push(value), warn: value => logs.push(value) } });
  function event(extra = {}) {
    const interaction = {
      id: String(++sequence), commandName: 'تحديث', user: { id: userId }, guildId, channelId,
      isChatInputCommand: () => true, isModalSubmit: () => false, inGuild: () => true,
      options: { getSubcommand: () => 'التوكن' }, deferred: false, replied: false,
      showModal: async modal => { interaction.replied = true; modals.push(modal.toJSON()); },
      reply: async value => { interaction.replied = true; sent.push(value); },
      deferReply: async value => { interaction.deferred = true; sent.push({ defer: value }); },
      editReply: async value => sent.push(value), ...extra,
    };
    return interaction;
  }
  async function open(extra) {
    const command = event(extra);
    await handlers.onInteraction(command);
    return command;
  }
  function submit(extra = {}) {
    return event({ commandName: undefined, customId: modals.at(-1)?.custom_id,
      isChatInputCommand: () => false, isModalSubmit: () => true,
      fields: { getTextInputValue: () => newToken }, ...extra });
  }
  return { handlers, sent, modals, logs, updates, event, open, submit };
}

test('exact /تحديث التوكن command opens a modal without a credential slash option', async () => {
  const command = slashCommands.find(item => item.name === 'تحديث');
  assert.equal(command.options.length, 1);
  assert.equal(command.options[0].name, 'التوكن');
  assert.equal(command.options[0].type, 1);
  assert.equal(command.options[0].options, undefined);
  const f = interactions();
  await f.open();
  assert.equal(f.sent.length, 0);
  assert.equal(f.modals.length, 1);
  assert.equal(JSON.stringify(f.modals).includes(newToken), false);
  assert.equal(f.modals[0].components[0].component.custom_id, 'reader-token');
});

test('only the exact permitted ID can open or submit, regardless of admin or guild ownership', async () => {
  for (const userId of ['141947703742562305', '999999999999999999']) {
    const f = interactions({ userId });
    await f.open({ memberPermissions: { has: () => true }, guild: { ownerId: userId } });
    await f.handlers.onInteraction(f.submit({ customId: 'reader-token:forged' }));
    assert.equal(f.modals.length, 0);
    assert.equal(f.updates.length, 0);
    assert.equal(f.sent.length, 2);
    for (const reply of f.sent) {
      assert.equal(reply.flags, MessageFlags.Ephemeral);
      assert.match(reply.content, /غير مسموح/);
    }
  }
  const f = interactions();
  await f.open();
  await f.handlers.onInteraction(f.submit({ user: { id: '141947703742562305' } }));
  assert.equal(f.updates.length, 0);
  await f.handlers.onInteraction(f.submit());
  assert.deepEqual(f.updates, [newToken]);
});

test('authorized submissions defer privately and edit one response without exposing the token', async () => {
  const f = interactions();
  await f.open();
  const submitted = f.submit();
  await Promise.all([f.handlers.onInteraction(submitted), f.handlers.onInteraction(submitted)]);
  assert.equal(f.sent[0].defer.flags, MessageFlags.Ephemeral);
  assert.match(f.sent[1].content, /تم تحديث/);
  assert.equal(f.sent.length, 2);
  assert.deepEqual(f.updates, [newToken]);
  assert.equal(JSON.stringify([...f.sent, ...f.logs]).includes(newToken), false);
  await f.handlers.onInteraction(f.submit());
  assert.equal(f.updates.length, 1);
  assert.equal(f.sent.at(-1).flags, MessageFlags.Ephemeral);
});

test('forged, expired, replaced and cross-channel forms never update credentials', async () => {
  let clock = 10000;
  const f = interactions({ now: () => clock });
  await f.handlers.onInteraction(f.submit({ customId: 'reader-token:forged' }));
  await f.open();
  const first = f.submit();
  await f.open();
  await f.handlers.onInteraction(first);
  await f.handlers.onInteraction(f.submit({ channelId: 'different' }));
  await f.handlers.onInteraction(f.submit({ guildId: 'different' }));
  clock += 600001;
  f.handlers.cleanup();
  await f.handlers.onInteraction(f.submit());
  assert.equal(f.updates.length, 0);
  assert.ok(f.sent.every(reply => reply.flags === MessageFlags.Ephemeral));
});

test('update commands and modal submissions obey existing guild/channel and DM restrictions', async () => {
  for (const extra of [{ guildId: 'other' }, { channelId: 'other' }, { inGuild: () => false }]) {
    const f = interactions({ config: { guildId, channelId } });
    await f.open(extra);
    assert.equal(f.modals.length, 0);
    await f.open();
    await f.handlers.onInteraction(f.submit(extra));
    assert.equal(f.updates.length, 0);
    assert.ok(f.sent.every(reply => reply.flags === MessageFlags.Ephemeral));
  }
});

test('reader failure produces one edited private error and logs only the allowlisted code', async () => {
  const f = interactions({ reader: { updateToken: async () => { throw Object.assign(new Error(newToken), { code: 'READER_AUTH' }); } } });
  await f.open();
  await f.handlers.onInteraction(f.submit());
  assert.equal(f.sent[0].defer.flags, MessageFlags.Ephemeral);
  assert.match(f.sent[1].content, /رفض ديسكورد/);
  assert.equal(f.sent.length, 2);
  assert.equal(JSON.stringify([...f.sent, ...f.logs]).includes(newToken), false);
});

async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), 'boost-token-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}
async function liveFacade(t, options = {}) {
  const path = await directory(t), readers = [], logs = [];
  const tokenFile = join(path, 'data', 'reader-token.json');
  const logger = { info: value => logs.push(value), warn: value => logs.push(value) };
  const manager = new UpdatableProfileReader({ source: 'discord.py-self', token: oldToken }, {
    tokenFile, logger, createReader: settings => {
      const bridge = new PythonReaderBridge({ token: settings.token, worker,
        python: process.env.TEST_PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3'), logger,
        startupTimeout: 1000, requestTimeout: 500 });
      const reader = new PythonProfileReader({ bridge, cacheFile: null, logger });
      readers.push(reader);
      return reader;
    }, ...options,
  });
  t.after(() => manager.close());
  return { manager, tokenFile, readers, logs };
}

test('token is saved privately and used after restart ahead of the environment fallback', async t => {
  const path = join(await directory(t), 'token.json');
  assert.equal(await loadReaderToken(oldToken, path), oldToken);
  await saveReaderToken(` ${newToken} `, path);
  assert.equal(await loadReaderToken(oldToken, path), newToken);
  if (process.platform !== 'win32') assert.equal((await stat(path)).mode & 0o777, 0o600);
  await assert.rejects(saveReaderToken('bad\ncredential', path), { code: 'TOKEN_INVALID' });
  assert.equal(await loadReaderToken(oldToken, path), newToken);
  await writeFile(path, '{invalid');
  await assert.rejects(loadReaderToken(oldToken, path), { code: 'TOKEN_STORE_READ' });
});

test('successful offline reader login swaps readers and leaves existing bot handlers working', async t => {
  const f = await liveFacade(t);
  const previous = f.manager.reader;
  assert.ok((await f.manager.get(targetId)).premium_since);
  const handlers = interactions({ reader: f.manager });
  await handlers.open();
  await handlers.handlers.onInteraction(handlers.submit());
  assert.match(handlers.sent.at(-1).content, /تم تحديث/);
  assert.equal(await loadReaderToken('', f.tokenFile), newToken);
  assert.equal(previous.bridge.closed, true);
  assert.notEqual(f.manager.reader, previous);
  assert.equal(f.manager.reader.bridge.token, newToken);
  assert.ok((await f.manager.get(targetId)).premium_since);
  assert.equal(f.logs.join().includes(newToken), false);
});

test('invalid login and failed persistence retain the original reader and saved credential', async t => {
  const f = await liveFacade(t);
  const previous = f.manager.reader;
  await saveReaderToken(oldToken, f.tokenFile);
  await assert.rejects(f.manager.updateToken('fixture-rejected-token'), { code: 'READER_STARTUP' });
  assert.equal(f.manager.reader, previous);
  assert.equal(await loadReaderToken('', f.tokenFile), oldToken);
  assert.equal(f.readers.at(-1).bridge.closed, true);
  f.manager.persist = async () => { throw new ProfileError('TOKEN_STORE_WRITE'); };
  await assert.rejects(f.manager.updateToken(newToken), { code: 'TOKEN_STORE_WRITE' });
  assert.equal(f.manager.reader, previous);
  assert.equal(f.readers.at(-1).bridge.closed, true);
  assert.equal(await loadReaderToken('', f.tokenFile), oldToken);
  assert.ok((await f.manager.get(targetId)).premium_since);
});

test('manual replacement recovers a stopped reader; unchanged token never retries a failed login', async t => {
  const f = await liveFacade(t);
  await assert.rejects(f.manager.get('141947703742562113'), { code: 'READER_AUTH' });
  const previous = f.manager.reader;
  await assert.rejects(f.manager.updateToken(oldToken), { code: 'TOKEN_UNCHANGED' });
  assert.equal(f.readers.length, 1);
  await f.manager.updateToken(newToken);
  assert.equal(previous.bridge.closed, true);
  assert.ok((await f.manager.get(targetId)).premium_since);
});

test('one update at a time blocks new reads, waits for accepted reads, then clears old negative cache', async t => {
  let finishRead;
  const pendingRead = new Promise(resolve => { finishRead = resolve; });
  const readers = [];
  const f = await liveFacade(t, { createReader: settings => {
    const initial = readers.length === 0;
    const reader = {
      get: () => pendingRead, ready: Promise.resolve(), tail: initial ? pendingRead : Promise.resolve(),
      cache: new Map([['private', { error: 'PROFILE_PRIVATE' }], ['valid', { data: {} }]]),
      bridge: { start: async () => {} }, close: async () => {}, saveCache: async () => {},
    };
    readers.push(reader);
    return reader;
  } });
  const update = f.manager.updateToken(newToken);
  await assert.rejects(f.manager.updateToken('other-token'), { code: 'TOKEN_BUSY' });
  await assert.rejects(f.manager.get(targetId), { code: 'TOKEN_BUSY' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(readers.length, 1);
  finishRead({});
  await update;
  assert.equal(readers.length, 2);
  assert.equal(f.manager.reader.cache.has('private'), false);
  assert.equal(f.manager.reader.cache.has('valid'), true);
});

test('bot token and external-source updates are rejected before starting another reader', async t => {
  const f = await liveFacade(t, { botToken: 'fixture-bot-token' });
  for (const value of ['', 'bad token', 'fixture-bot-token']) await assert.rejects(f.manager.updateToken(value), { code: 'TOKEN_INVALID' });
  assert.equal(f.readers.length, 1);
  f.manager.settings.source = 'dcdn';
  await assert.rejects(f.manager.updateToken(newToken), { code: 'TOKEN_SOURCE' });
  assert.equal(f.readers.length, 1);
});
