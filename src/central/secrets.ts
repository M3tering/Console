import { randomBytes, createHash, timingSafeEqual, scrypt } from 'crypto';
import fs from 'fs';
import path from 'path';

export const newSecret = (): string => randomBytes(32).toString('base64url');
export const hashSecret = (secret: string): string => createHash('sha256').update(secret).digest('hex');
export function equalSecretHash(secret: string, expected: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(expected)) return false;
  return timingSafeEqual(Buffer.from(hashSecret(secret), 'hex'), Buffer.from(expected, 'hex'));
}
const derive = (password: string, salt: string): Promise<Buffer> => new Promise((resolve, reject) =>
  scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (error, value) => error ? reject(error) : resolve(value)));
export async function hashPassword(password: string): Promise<string> {
  if (password.length < 16 || Buffer.byteLength(password) > 1024) throw new Error('Central passwords must contain 16–1024 bytes.');
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${(await derive(password, salt)).toString('hex')}`;
}
export async function verifyPassword(password: unknown, stored: string): Promise<boolean> {
  if (typeof password !== 'string' || Buffer.byteLength(password) > 1024) return false;
  const match = /^scrypt\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(stored);
  if (!match) return false;
  return timingSafeEqual(await derive(password, match[1]), Buffer.from(match[2], 'hex'));
}

/** Refuse permissive files and symlinks; atomic writes never print a credential. */
export function readOwnerSecret(filename: string): string {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > 4096 || (stat.mode & 0o077) ||
        (typeof process.getuid === 'function' && stat.uid !== process.getuid())) throw new Error('Secret file must be owner-only and owned by this process user.');
    const value = fs.readFileSync(fd, 'utf8').trim();
    if (value.length < 32 || value.length > 512 || /\s/.test(value)) throw new Error('Secret file has an invalid format.');
    return value;
  } finally { fs.closeSync(fd); }
}
export function writeOwnerSecret(filename: string, value: string): void {
  if (value.length < 32 || value.length > 512 || /\s/.test(value)) throw new Error('Credential format is invalid.');
  const directory = path.dirname(filename);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temp = path.join(directory, `.credential-${randomBytes(12).toString('hex')}`);
  const fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeFileSync(fd, value); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try {
    fs.renameSync(temp, filename);
    const directoryFd = fs.openSync(directory, 'r');
    try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
  } catch { fs.rmSync(temp, { force: true }); throw new Error('Could not persist credential.'); }
}
