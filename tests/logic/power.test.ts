import Power from '../../src/lib/core/is_on';
import { getCrossChainRevenue, getOwedFromPriceContext } from '../../src/lib/sync';
jest.mock('../../src/lib/sync', () => ({ getCrossChainRevenue: jest.fn(), getOwedFromPriceContext: jest.fn() }));
test.each([[10n, 10n, true], [20n, 10n, true], [9n, 10n, false], [9007199254740992n, 9007199254740993n, false]])('compares revenue %s against debt %s exactly', async (revenue, owed, expected) => {
  (getCrossChainRevenue as jest.Mock).mockResolvedValue(revenue);
  (getOwedFromPriceContext as jest.Mock).mockResolvedValue(owed);
  expect(await new Power().isOnStateCompute(42)).toBe(expected);
});
test('a failed balance read is not silently treated as paid', async () => {
  (getCrossChainRevenue as jest.Mock).mockRejectedValue(new Error('RPC unavailable'));
  await expect(new Power().isOnStateCompute(42)).rejects.toThrow('RPC unavailable');
});
