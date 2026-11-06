import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProfileReader } from './python-reader.js';
import { ProfileError } from './profile.js';

export const TOKEN_MANAGER_ID = '141947703742562304';
export const READER_TOKEN_FILE = fileURLToPath(new URL('../data/reader-token.json', import.meta.url));

function normalizeToken(value) {
  const token = typeof value === 'string' ? value.trim() : '';
  if (!token || token.length > 2048 || !/^[\x21-\x7e]+$/.test(token)) throw new ProfileError('TOKEN_INVALID');
  return token;
}

export async function loadReaderToken(fallback = '', file = READER_TOKEN_FILE) {
  try {
    const saved = JSON.parse(await readFile(file, 'utf8'));
    return normalizeToken(saved.token);
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw new ProfileError('TOKEN_STORE_READ');
  }
}

export async function saveReaderToken(value, file = READER_TOKEN_FILE) {
  const token = normalizeToken(value);
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(temporary, JSON.stringify({ token }) + '\n', { mode: 0o600, flag: 'wx' });
    await rename(temporary, file);
  } catch {
    throw new ProfileError('TOKEN_STORE_WRITE');
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

// All handlers keep the same facade while only the reader is replaced. A failed
// login or disk write leaves the current credential and reader in place.
export class UpdatableProfileReader {
  constructor(settings, { tokenFile = READER_TOKEN_FILE, createReader = createProfileReader, persist = saveReaderToken, botToken = '', logger = console } = {}) {
    this.settings = { ...settings };
    this.tokenFile = tokenFile;
    this.createReader = createReader;
    this.persist = persist;
    this.botToken = botToken;
    this.logger = logger;
    this.reader = createReader(this.settings);
    this.updating = false;
    this.closed = false;
  }
  get(userId) {
    if (this.closed) return Promise.reject(new ProfileError('READER_CLOSED'));
    if (this.updating) return Promise.reject(new ProfileError('TOKEN_BUSY'));
    return this.reader.get(userId);
  }
  async updateToken(value) {
    if (this.closed) throw new ProfileError('READER_CLOSED');
    if (this.settings.source !== 'discord.py-self') throw new ProfileError('TOKEN_SOURCE');
    if (this.updating) throw new ProfileError('TOKEN_BUSY');
    const token = normalizeToken(value);
    if (token === this.botToken) throw new ProfileError('TOKEN_INVALID');
    if (token === this.settings.token) throw new ProfileError('TOKEN_UNCHANGED');
    this.updating = true;
    let candidate;
    try {
      // Drain already accepted requests before validating a replacement.
      await this.reader.ready;
      await this.reader.tail;
      if (this.closed) throw new ProfileError('READER_CLOSED');
      candidate = this.createReader({ ...this.settings, token });
      await candidate.ready;
      await candidate.bridge.start();
      if (this.closed) throw new ProfileError('READER_CLOSED');
      await this.persist(token, this.tokenFile);
      const previous = this.reader;
      this.reader = candidate;
      this.settings.token = token;
      candidate = null;
      // A different reader account may be able to see previously private data.
      for (const [id, entry] of this.reader.cache) if (entry.error) this.reader.cache.delete(id);
      await this.reader.saveCache();
      await previous.close?.().catch(() => this.logger.warn('[READER_CLOSE_FAILED]'));
    } finally {
      if (candidate) await candidate.close?.().catch(() => {});
      this.updating = false;
    }
  }
  async close() {
    this.closed = true;
    await this.reader.close?.();
  }
}
