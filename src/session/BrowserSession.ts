import type { C64MachineState, RawCartridgeMode, SidChipModel, VicVideoStandard } from '../core';
import { decodeMachineState, encodeMachineState } from './StateCodec';

const DATABASE_NAME = 'c64-browser-emulator';
const DATABASE_VERSION = 1;
const STORE_NAME = 'session';
const PREFERENCES_KEY = 'preferences';
const QUICK_STATE_KEY = 'quick-state';

export type PersistedAssetKind =
  | 'rom-basic'
  | 'rom-kernal'
  | 'rom-character'
  | 'rom-1541'
  | 'disk-1541'
  | 'cartridge'
  | 'tape'
  | 't64'
  | 'prg';

export interface SessionPreferences {
  readonly videoStandard: VicVideoStandard;
  readonly sidModel: SidChipModel;
  readonly joystickCapture: 'keyboard' | '1' | '2';
}

export interface PersistedAsset {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly mediaType?: 'd64' | 'g64' | 'crt' | 'raw' | 'tap' | 't64' | 'prg' | 'rom';
  readonly writeProtected?: boolean;
  readonly rawCartridgeMode?: RawCartridgeMode;
}

export interface RestoredBrowserSession {
  readonly preferences: SessionPreferences;
  readonly assets: Readonly<Partial<Record<PersistedAssetKind, PersistedAsset>>>;
}

export const DEFAULT_SESSION_PREFERENCES: SessionPreferences = Object.freeze({
  videoStandard: 'pal',
  sidModel: '6581',
  joystickCapture: 'keyboard'
});

export class BrowserSessionStore {
  private databasePromise: Promise<IDBDatabase> | null = null;

  async loadPreferences(): Promise<SessionPreferences> {
    const value = await this.get<SessionPreferences>(PREFERENCES_KEY);
    return normalizePreferences(value);
  }

  async savePreferences(preferences: SessionPreferences): Promise<void> {
    await this.put(PREFERENCES_KEY, normalizePreferences(preferences));
  }

  async putAsset(kind: PersistedAssetKind, asset: PersistedAsset): Promise<void> {
    await this.put(assetKey(kind), cloneAsset(asset));
  }

  async removeAsset(kind: PersistedAssetKind): Promise<void> {
    await this.delete(assetKey(kind));
  }

  async loadAsset(kind: PersistedAssetKind): Promise<PersistedAsset | null> {
    const value = await this.get<PersistedAsset>(assetKey(kind));
    return value === undefined ? null : cloneAsset(value);
  }

  async loadSession(): Promise<RestoredBrowserSession> {
    const preferences = await this.loadPreferences();
    const kinds: readonly PersistedAssetKind[] = [
      'rom-basic', 'rom-kernal', 'rom-character', 'rom-1541',
      'disk-1541', 'cartridge', 'tape', 't64', 'prg'
    ];
    const values = await Promise.all(kinds.map(async (kind) => [kind, await this.loadAsset(kind)] as const));
    const assets: Partial<Record<PersistedAssetKind, PersistedAsset>> = {};
    for (const [kind, asset] of values) if (asset !== null) assets[kind] = asset;
    return { preferences, assets };
  }

  async saveQuickState(state: C64MachineState): Promise<void> {
    await this.put(QUICK_STATE_KEY, encodeMachineState(state));
  }

  async loadQuickState(): Promise<C64MachineState | null> {
    const encoded = await this.get<string>(QUICK_STATE_KEY);
    return encoded === undefined ? null : decodeMachineState(encoded);
  }

  async clearQuickState(): Promise<void> {
    await this.delete(QUICK_STATE_KEY);
  }

  async clearAll(): Promise<void> {
    const database = await this.database();
    await transactionPromise(database, 'readwrite', (store) => store.clear());
  }

  private async get<T>(key: string): Promise<T | undefined> {
    const database = await this.database();
    return transactionPromise<T | undefined>(database, 'readonly', (store) => store.get(key));
  }

  private async put(key: string, value: unknown): Promise<void> {
    const database = await this.database();
    await transactionPromise(database, 'readwrite', (store) => store.put(value, key));
  }

  private async delete(key: string): Promise<void> {
    const database = await this.database();
    await transactionPromise(database, 'readwrite', (store) => store.delete(key));
  }

  private database(): Promise<IDBDatabase> {
    if (this.databasePromise !== null) return this.databasePromise;

    const promise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onerror = () => reject(request.error ?? new Error('Unable to open browser session storage.'));
      request.onblocked = () => reject(new Error('Browser session storage is blocked by another open emulator tab.'));
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => {
          database.close();
          if (this.databasePromise === promise) this.databasePromise = null;
        };
        resolve(database);
      };
    });

    this.databasePromise = promise;
    void promise.catch(() => {
      if (this.databasePromise === promise) this.databasePromise = null;
    });
    return promise;
  }
}

function normalizePreferences(value: SessionPreferences | undefined): SessionPreferences {
  if (value === undefined) return DEFAULT_SESSION_PREFERENCES;
  return {
    videoStandard: value.videoStandard === 'ntsc' ? 'ntsc' : 'pal',
    sidModel: value.sidModel === '8580' ? '8580' : '6581',
    joystickCapture: value.joystickCapture === '1' || value.joystickCapture === '2'
      ? value.joystickCapture
      : 'keyboard'
  };
}

function cloneAsset(asset: PersistedAsset): PersistedAsset {
  return { ...asset, bytes: asset.bytes.slice() };
}

function assetKey(kind: PersistedAssetKind): string { return `asset:${kind}`; }

function transactionPromise<T = void>(
  database: IDBDatabase,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T> | IDBRequest | void
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    let request: IDBRequest<T> | IDBRequest | void;
    try {
      request = action(store);
    } catch (error) {
      reject(error);
      return;
    }
    transaction.onerror = () => reject(transaction.error ?? new Error('Browser session storage failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Browser session storage was aborted.'));
    transaction.oncomplete = () => {
      if (request === undefined) {
        resolve(undefined as T);
      } else {
        resolve(request.result as T);
      }
    };
  });
}

export const browserSessionStore = new BrowserSessionStore();
