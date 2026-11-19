import fs from 'fs';
import os from 'os';
import path from 'path';
import { hasNameserver, watchResolver } from '../../src/utils/dns-watch';

test('an empty DNS configuration triggers a restart only after it stays empty, and recovers if it fills in', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dns-watch-')), file = path.join(dir, 'resolv.conf');
  jest.useFakeTimers();
  try {
    fs.writeFileSync(file, '\n\n');
    expect(hasNameserver(file)).toBe(false);
    let clock = 0; const stuck = jest.fn();
    watchResolver(stuck, { file, afterMs: 180000, everyMs: 30000, now: () => clock });
    clock = 120000; jest.advanceTimersByTime(120000); expect(stuck).not.toHaveBeenCalled();
    fs.writeFileSync(file, 'nameserver 10.61.29.144\n');                         // the host got DNS and Docker refreshed it
    clock = 300000; jest.advanceTimersByTime(180000); expect(stuck).not.toHaveBeenCalled();
    fs.writeFileSync(file, '');                                                   // empty again: the 3 minutes start over
    clock = 330000; jest.advanceTimersByTime(30000);
    clock = 510000; jest.advanceTimersByTime(180000); expect(stuck).toHaveBeenCalledTimes(1);
    expect(hasNameserver(path.join(dir, 'missing'))).toBe(true);                   // nothing to inspect: never restart
  } finally { jest.useRealTimers(); fs.rmSync(dir, { recursive: true, force: true }); }
});
