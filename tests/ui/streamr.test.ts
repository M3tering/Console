import StreamrUI from '../../src/lib/core/streamr/ui';
import { getAllTransactionRecords } from '../../src/store/sqlite';

jest.mock('@streamr/sdk', () => ({ StreamrClient: jest.fn() }));
jest.mock('../../src/store/sqlite', () => ({ getAllTransactionRecords: jest.fn(() => []) }));

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
});
