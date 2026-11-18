import StreamrUI from '../../src/lib/core/streamr/ui';
import { getAllTransactionRecords } from '../../src/store/sqlite';

jest.mock('@streamr/sdk', () => ({ StreamrClient: jest.fn() }));
jest.mock('../../src/store/sqlite', () => ({ getAllTransactionRecords: jest.fn(() => []), getMeterByDevEui: jest.fn((devEui: string) => devEui === 'aaaaaaaaaaaaaaaa' ? { tokenId: 1 } : devEui === 'bbbbbbbbbbbbbbbb' ? { tokenId: 2 } : null) }));
import { configurePublications } from '../../src/central/distribution';

describe('Streamr desktop presentation', () => {
  const originalStream = process.env.STREAMR_STREAM_ID;
  afterEach(() => {
    if (originalStream === undefined) delete process.env.STREAMR_STREAM_ID;
    else process.env.STREAMR_STREAM_ID = originalStream;
    jest.clearAllMocks();
  });
  it('preserves application and action identifiers and displays empty status', async () => {
    delete process.env.STREAMR_STREAM_ID;
    const ui = new StreamrUI();
    expect(ui.getAppIcon()).toMatchObject({ id: 'streamr', label: 'Streamr' });
    expect(ui.getActions()[0].id).toBe('publish-now');
    const window = await ui.getAppWindow();
    expect(window.id).toBe('streamr');
    expect(window.contentHtml).toContain('No streams configured.');
    expect(window.contentHtml).toContain('disabled');
    expect(window.contentHtml).toContain("invokeAction('streamr', 'publish-now', this)");
  });
  it('renders configured streams as text and enables publishing pending transactions', async () => {
    process.env.STREAMR_STREAM_ID = 'example/<script>&"';
    (getAllTransactionRecords as jest.Mock).mockReturnValueOnce([{ nonce: 1 }]);
    const window = await new StreamrUI().getAppWindow();
    expect(window.contentHtml).toContain('1 pending');
    expect(window.contentHtml).toContain('example/&lt;script&gt;&amp;&quot;');
    expect(window.contentHtml).not.toContain('<script>');
    expect(window.contentHtml).not.toContain('disabled');
  });

  describe('in each role', () => {
    const role = process.env.CONSOLE_ROLE;
    const records = [1, 2, 3].map(nonce => ({ identifier: 1, nonce, receivedAt: 1, raw: '' })).concat([{ identifier: 2, nonce: 1, receivedAt: 1, raw: '' }]);
    afterEach(() => { if (role === undefined) delete process.env.CONSOLE_ROLE; else process.env.CONSOLE_ROLE = role; });

    it('central counts only what is still to publish, for every gateway or one gateway\'s meters', async () => {
      process.env.CONSOLE_ROLE = 'central'; process.env.STREAMR_STREAM_ID = 'stream/a';
      configurePublications(':memory:');
      (getAllTransactionRecords as jest.Mock).mockReturnValue(records);
      const ui = new StreamrUI();
      expect(await ui.getStatusData()).toMatchObject({ role: 'central', pendingCount: 4, uncertainCount: 0, canPublish: true });
      // Publish two readings: they no longer count as waiting.
      const { publishManaged } = require('../../src/central/distribution');
      await publishManaged('streamr:stream/a', records.slice(0, 2), async () => {});
      await expect(publishManaged('streamr:stream/a', records.slice(2, 3), async () => { throw new Error('lost'); })).rejects.toThrow();
      expect(await ui.getStatusData()).toMatchObject({ pendingCount: 1, uncertainCount: 1 });
      // A gateway tab sees only its own meters (token 2 here).
      const scoped = await ui.getStatusData({ gateway: 'g2', gatewayName: 'South', devEuis: ['bbbbbbbbbbbbbbbb'] });
      expect(scoped).toMatchObject({ gateway: 'g2', recordCount: 1, pendingCount: 1 });
      expect(scoped.scope).toContain("South's meters");
      (getAllTransactionRecords as jest.Mock).mockReturnValue([]);
    });

    it('a managed gateway shows that central publishes, with no Publish Now button', async () => {
      process.env.CONSOLE_ROLE = 'gateway'; process.env.STREAMR_STREAM_ID = 'stream/a';
      (getAllTransactionRecords as jest.Mock).mockReturnValue(records);
      const ui = new StreamrUI();
      expect(await ui.getStatusData()).toMatchObject({ role: 'gateway', pendingCount: 0, recordCount: 4, canPublish: false });
      const window = await ui.getAppWindow();
      expect(window.contentHtml).toContain('Central publishes');
      expect(window.contentHtml).toMatch(/data-streamr-field="publish"[^>]*disabled[^>]*hidden/);
      (getAllTransactionRecords as jest.Mock).mockReturnValue([]);
    });
  });
});
