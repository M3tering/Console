import fs from 'fs';
import os from 'os';
import path from 'path';
import ts from 'typescript';
import { getModuleConfiguration, parseModuleReference, resolveModulePath } from '../../src/lib/modules';
const { installModules } = require('../../scripts/install-modules.cjs');

test('runtime and installer share owner/repo paths, UI references, and pinned refs', () => {
  const config = getModuleConfiguration({ BACKEND_MODULES: ' core/is_on, alice/extension#v1 ', UI_MODULES: 'custom:alice/extension#v1, streamr:core/streamr/ui' });
  expect(config.external).toEqual([{ reference: 'alice/extension#v1', builtIn: false, repository: 'alice/extension', ref: 'v1' }]);
  expect(resolveModulePath('/app/dist/lib', config.modules[1])).toBe('/app/dist/extensions/alice/extension');
  expect(resolveModulePath('/app/dist/lib', config.uiModules.streamr)).toBe('/app/dist/lib/core/streamr/ui');
  expect(() => getModuleConfiguration({ BACKEND_MODULES: 'a/b#v1', UI_MODULES: 'test:a/b#v2' })).toThrow('Conflicting');
});
test.each(['../outside', '/tmp/module', 'a/b#../../escape', 'a/b#-flag', 'core/../outside', 'https://github.com/a/b'])('invalid module reference %s is rejected', reference => expect(() => parseModuleReference(reference)).toThrow());
test('external modules install and rebuild at the exact runtime location without downloading core modules', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'console-modules-'));
  try {
    fs.mkdirSync(path.join(root, 'dist/lib'), { recursive: true });
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src/index.ts'), 'export {};');
    fs.writeFileSync(path.join(root, 'src/types.ts'), 'export interface Hooks { onAfterInit(): void }');
    const compiled = ts.transpileModule(fs.readFileSync(path.resolve('src/lib/modules.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
    fs.writeFileSync(path.join(root, 'dist/lib/modules.js'), compiled);
    const run = jest.fn((command, args) => {
      if (command === 'git' && args[0] === 'clone') {
        const dest = args.at(-1); fs.mkdirSync(dest, { recursive: true });
        fs.writeFileSync(path.join(dest, 'index.ts'), 'import type { Hooks } from "../../../types"; export default class implements Hooks { onAfterInit() {} }');
        fs.writeFileSync(path.join(dest, 'package.json'), '{}');
      }
      if (command === 'npm' && args[0] === 'run') {
        const program = ts.createProgram([path.join(root, 'src/index.ts'), path.join(root, 'src/extensions/alice/custom/index.ts')], { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, rootDir: path.join(root, 'src'), outDir: path.join(root, 'dist'), skipLibCheck: true, types: [] });
        expect(ts.getPreEmitDiagnostics(program)).toEqual([]);
        program.emit();
      }
    });
    installModules({ appDir: root, env: { BACKEND_MODULES: 'core/is_on,alice/custom#v1', UI_MODULES: 'custom:alice/custom#v1' }, run });
    expect(run).toHaveBeenCalledWith('git', ['clone', '--depth=1', '--branch', 'v1', 'https://github.com/alice/custom.git', path.join(root, 'src/extensions/alice/custom')], expect.anything());
    const Loaded = require(resolveModulePath(path.join(root, 'dist/lib'), 'alice/custom#v1')).default;
    expect(typeof new Loaded().onAfterInit).toBe('function');
    expect(run).toHaveBeenLastCalledWith('npm', ['run', 'build'], expect.objectContaining({ cwd: root }));
    installModules({ appDir: root, env: { BACKEND_MODULES: 'alice/custom#v2' }, run });
    expect(run).toHaveBeenCalledWith('git', ['fetch', '--depth=1', 'origin', 'v2'], expect.anything());
    expect(run).toHaveBeenCalledWith('git', ['checkout', '--detach', 'FETCH_HEAD'], expect.anything());
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
