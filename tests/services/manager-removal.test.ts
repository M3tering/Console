import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { warnRemovedManagerSettings } from '../../src/lib/legacy-config';
import setupDatabase, { deleteDatabase } from '../../src/store/sqlite';

test('obsolete credentials are ignored with one warning containing no values', () => {
  const warn = jest.fn();
  warnRemovedManagerSettings({ M3TER_MANAGER_PASSWORD: 'must-not-appear', M3TER_MANAGER_USERNAME: 'secret-user', M3TER_TELEMETRY_LIMIT: '-1' }, warn);
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn.mock.calls[0][0]).toContain('ignored');
  expect(warn.mock.calls[0][0]).not.toMatch(/must-not-appear|secret-user|-1/);
  warn.mockClear(); warnRemovedManagerSettings({}, warn);
  expect(warn).not.toHaveBeenCalled();
});

test('billing initialization leaves legacy Manager tables and records intact', () => {
  const cwd = process.cwd(), directory = fs.mkdtempSync(path.join(os.tmpdir(), 'console-removal-'));
  process.chdir(directory);
  try {
    fs.mkdirSync('.data');
    const previous = new Database('.data/test.db');
    previous.exec("CREATE TABLE manager_events (id INTEGER PRIMARY KEY, message TEXT); INSERT INTO manager_events VALUES (1, 'retained');");
    previous.close();
    setupDatabase('test.db');
    const inspection = new Database('.data/test.db', { readonly: true });
    expect(inspection.prepare('SELECT * FROM manager_events').all()).toEqual([{ id: 1, message: 'retained' }]);
    inspection.close();
    deleteDatabase('test.db');
  } finally { process.chdir(cwd); fs.rmSync(directory, { recursive: true, force: true }); }
});
