import { describe } from 'vitest';
import { memoryStorage } from '../src/store/memory';
import { createLocalDajareStore } from '../src/store/local-dajare-store';
import { registerStoreContract } from './store-contract.cases';

describe('LocalStore contract', () => {
  registerStoreContract(async () =>
    createLocalDajareStore(memoryStorage(), { seed: { schemaVersion: 2, items: [] } }),
  );
});
