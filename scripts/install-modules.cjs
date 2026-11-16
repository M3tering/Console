/* Uses the same parsed references and paths as the runtime loader. */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function installModules({ appDir = path.resolve(__dirname, '..'), env = process.env, run = execFileSync } = {}) {
  const { getModuleConfiguration } = require(path.join(appDir, 'dist/lib/modules.js'));
  const { external } = getModuleConfiguration(env);
  if (!external.length) return;
  const execute = (command, args, cwd) => run(command, args, { cwd, stdio: 'inherit', env });
  for (const module of external) {
    const source = path.join(appDir, 'src/extensions', module.repository);
    const destination = path.join(appDir, 'dist/extensions', module.repository);
    fs.mkdirSync(path.dirname(source), { recursive: true });
    if (!fs.existsSync(source)) {
      const args = ['clone', '--depth=1'];
      if (module.ref) args.push('--branch', module.ref);
      execute('git', [...args, `https://github.com/${module.repository}.git`, source], appDir);
    } else {
      // Refresh the requested ref on every start; changing a tag/branch must not
      // silently reuse an unrelated .built marker or a stale checkout.
      execute('git', ['fetch', '--depth=1', 'origin', module.ref || 'HEAD'], source);
      execute('git', ['checkout', '--detach', 'FETCH_HEAD'], source);
    }
    if (!fs.existsSync(path.join(source, 'index.ts')) && !fs.existsSync(path.join(source, 'index.js'))) {
      throw new Error(`${module.repository} must export its extension from index.ts or index.js`);
    }
    if (fs.existsSync(path.join(source, 'package.json'))) {
      execute('npm', [fs.existsSync(path.join(source, 'package-lock.json')) ? 'ci' : 'install', '--include=dev'], source);
    }
    fs.mkdirSync(destination, { recursive: true });
    fs.cpSync(source, destination, {
      recursive: true,
      filter: entry => path.basename(entry) !== '.git',
    });
    // Plain JS entrypoints and assets are copied; TS modules are compiled below
    // using the console's CommonJS settings and shared src/types.ts imports.
  }
  execute('npm', ['run', 'build'], appDir);
}

module.exports = { installModules };
if (require.main === module) {
  require('dotenv/config');
  installModules();
}
