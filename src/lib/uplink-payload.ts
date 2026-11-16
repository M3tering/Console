/** Transport decoding only. Firmware decoders consume bytes, never encoded text.
 * ChirpStack v4's unmarked `data` is Base64. Hex producers must use `dataHex`
 * or explicitly mark `dataEncoding: 'hex'`; alphabet guessing is ambiguous.
 */
export function uplinkPayload(event: { data?: unknown; dataHex?: unknown; dataEncoding?: unknown }) {
  const explicitHex = event.dataHex !== undefined;
  const field = explicitHex ? 'dataHex' : 'data';
  const raw = explicitHex ? event.dataHex : event.data;
  const encoding = explicitHex ? 'hex' : event.dataEncoding ?? 'base64';
  if (typeof raw !== 'string' || !raw || raw.length > 4096) throw new Error('Missing or oversized uplink payload');
  if (encoding !== 'hex' && encoding !== 'base64') throw new Error('Unsupported payload encoding; use hex or base64');
  if (encoding === 'hex') {
    if (!/^(?:[a-fA-F0-9]{2})+$/.test(raw)) throw new Error('Invalid hex payload: expected complete hexadecimal byte pairs');
  } else if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(raw)) {
    throw new Error('Invalid Base64 payload; hexadecimal data must use dataHex or dataEncoding: hex');
  }
  const bytes = Buffer.from(raw, encoding);
  if (encoding === 'base64' && bytes.toString('base64') !== raw) throw new Error('Invalid Base64 payload');
  return { bytes, raw, field, encoding, hex: bytes.toString('hex').toUpperCase() };
}
