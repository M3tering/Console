import path from 'path';

export interface ModuleReference {
  reference: string;
  builtIn: boolean;
  repository?: string;
  ref?: string;
}

export function parseModuleReference(input: string): ModuleReference {
  const reference = input.trim();
  if (/^core\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(reference)) return { reference, builtIn: true };
  const match = /^([a-zA-Z0-9][a-zA-Z0-9_.-]*)\/([a-zA-Z0-9][a-zA-Z0-9_.-]*)(?:#([a-zA-Z0-9][a-zA-Z0-9_./-]*))?$/.exec(reference);
  if (!match || match[3]?.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`Invalid module reference: ${reference}. Use core/name or owner/repository#branch-or-tag`);
  }
  return { reference, builtIn: false, repository: `${match[1]}/${match[2]}`, ref: match[3] };
}

export function getModuleConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const modules = (env.BACKEND_MODULES || '').split(',').map(value => value.trim()).filter(Boolean);
  const uiModules: Record<string, string> = Object.create(null);
  for (const entry of (env.UI_MODULES || '').split(',').map(value => value.trim()).filter(Boolean)) {
    const delimiter = entry.indexOf(':');
    const id = entry.slice(0, delimiter).trim(), reference = entry.slice(delimiter + 1).trim();
    if (delimiter < 1 || !/^[a-zA-Z0-9_-]+$/.test(id) || !reference) throw new Error(`Invalid UI module: ${entry}`);
    if (Object.hasOwnProperty.call(uiModules, id)) throw new Error(`Duplicate UI module ID: ${id}`);
    uiModules[id] = reference;
  }
  const references = [...modules, ...Object.values(uiModules), ...(env.MODULES || '').split(',').map(value => value.trim()).filter(Boolean)].map(parseModuleReference);
  const repositories = new Map<string, ModuleReference>();
  for (const reference of references) {
    if (reference.builtIn) continue;
    const previous = repositories.get(reference.repository!);
    if (previous && previous.ref !== reference.ref) throw new Error(`Conflicting versions for ${reference.repository}`);
    repositories.set(reference.repository!, reference);
  }
  return { modules, uiModules, external: [...repositories.values()] };
}

export function resolveModulePath(libDirectory: string, reference: string): string {
  const parsed = parseModuleReference(reference);
  return parsed.builtIn ? path.resolve(libDirectory, parsed.reference) :
    path.resolve(libDirectory, '..', 'extensions', parsed.repository!);
}
