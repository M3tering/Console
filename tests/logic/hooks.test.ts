import { defaultConfigurations, loadExtensionsFromConfig, runHook, notifyHook } from '../../src/lib/utils';
let extensions: any[];
beforeEach(async () => { defaultConfigurations.modules = []; extensions = await loadExtensionsFromConfig(); extensions.splice(0); });
afterEach(() => extensions.splice(0));
test('one rejected delivery hook does not skip later services', async () => {
  const delivered = jest.fn();
  extensions.push({ onTransactionDistribution: async () => { throw new Error('upload failed'); } }, { onTransactionDistribution: delivered });
  await expect(notifyHook('onTransactionDistribution', 1, {} as any, [])).resolves.toBeUndefined();
  expect(delivered).toHaveBeenCalledTimes(1);
});
test('lifecycle hooks remain awaited and propagate failures to startup', async () => {
  let resolve!: () => void;
  extensions.push({ onBeforeInit: () => new Promise<void>(r => { resolve = r; }) });
  let finished = false;
  const task = runHook('onBeforeInit').then(() => { finished = true; });
  await Promise.resolve(); expect(finished).toBe(false);
  resolve(); await task; expect(finished).toBe(true);
  extensions.push({ onAfterInit: () => { throw new Error('invalid cron'); } });
  await expect(runHook('onAfterInit')).rejects.toThrow('onAfterInit');
});
