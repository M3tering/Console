export type CommandDefinition = {
  id: string; name: string; category: string; fPort: 2 | 3; code: number;
  description: string; confirmation?: string; options?: { value: number; label: string }[];
  min?: number; max?: number; defaultValue?: number;
  fixedValue?: number;
};
const gain = [1, 2, 4].map(value => ({ value, label: `×${value}` }));
const billing = 'The relay will change state, the energy accumulator will reset to zero, and the nonce will increment.';
export const commandCatalogue: CommandDefinition[] = [
  { id: 'relay-on', name: 'Relay ON', category: 'Relay control', fPort: 2, code: 0x1b, description: 'Close the relay. Energy and nonce remain unchanged.' },
  { id: 'relay-off', name: 'Relay OFF', category: 'Relay control', fPort: 2, code: 0x1c, description: 'Open the relay. Energy and nonce remain unchanged.' },
  { id: 'billing-disconnect', name: 'Disconnect (Billing)', category: 'Billing connectivity', fPort: 2, code: 0, description: 'Open the relay and reset the billing accumulator.', confirmation: billing },
  { id: 'billing-connect', name: 'Connect (Billing)', category: 'Billing connectivity', fPort: 2, code: 1, description: 'Close the relay and reset the billing accumulator.', confirmation: billing },
  { id: 'report-interval', name: 'Set report interval', category: 'Reporting configuration', fPort: 2, code: 2, min: 10, max: 65535, defaultValue: 60, description: 'Set the reporting interval in seconds. Values below 60 seconds consume more LoRaWAN airtime.' },
  { id: 'restart', name: 'Restart meter', category: 'Maintenance', fPort: 2, code: 0x1d, description: 'Software reset and rejoin; telemetry may stop for approximately 10–60 seconds.', confirmation: 'Restart this meter? Telemetry may stop while it restarts and rejoins. Enqueueing does not confirm a restart.' },
  { id: 'relay-drive', name: 'Relay drive level', category: 'Relay hardware', fPort: 2, code: 0x1e, options: [{ value: 1, label: 'Active high' }, { value: 0, label: 'Active low' }], description: 'Set the output level that activates the physical relay.', confirmation: 'An incorrect drive level can invert relay ON/OFF behavior. Check the physical driver circuit before continuing.' },
  { id: 'relay-fitted', name: 'Relay fitted', category: 'Relay hardware', fPort: 2, code: 0x1f, options: [{ value: 1, label: 'Relay fitted' }, { value: 0, label: 'No relay fitted' }], description: 'Configure whether a relay is installed.', confirmation: 'When no relay is fitted, firmware ignores disconnect commands. Confirm the actual hardware configuration.' },
  { id: 'current-gain', name: 'Current gain (PGA)', category: 'Amplifier gain', fPort: 2, code: 0x20, options: gain, description: 'Firmware converts saved calibration. For 2000:1 CTs and a 5.6 Ω burden, ×2 suits up to approximately 128 A; ×4 suits lighter loads up to approximately 64 A.' },
  { id: 'voltage-gain', name: 'Voltage gain (PGA)', category: 'Amplifier gain', fPort: 2, code: 0x21, options: gain, description: 'Set voltage-channel gain. The normal configuration is ×1.' },
  { id: 'phase-mode', name: 'Phase mode', category: 'Phase configuration', fPort: 2, code: 0x22, options: [{ value: 0, label: 'Three-phase' }, { value: 1, label: 'Phase A' }, { value: 2, label: 'Phase B' }, { value: 3, label: 'Phase C' }], description: 'Select reported phases without resetting energy. Three-phase reports total energy and the SUM of phase voltages (about 690 V on a 230 V system). A queued mode is not verified configuration.' },
  { id: 'class-a', name: 'Switch to Class A', category: 'LoRaWAN class', fPort: 3, code: 0, description: 'Downlinks become available only after an uplink.', confirmation: 'Switch to Class A? Future downlinks must wait for an uplink. Class C is the normal operating mode.' },
  { id: 'class-c', name: 'Switch to Class C', category: 'LoRaWAN class', fPort: 3, code: 2, description: 'Request the normal Class C operating mode. A reachable Class C meter can receive downlinks without waiting for an uplink.' },
  { id: 'telemetry-enable', name: 'Enable telemetry', category: 'Monitoring telemetry', fPort: 2, code: 0x23, fixedValue: 1, description: 'Enable periodic FPort 4 electrical monitoring (firmware v1.0.4+). Subsequent frames provide evidence of operation; queue acceptance is not confirmation.' },
  { id: 'telemetry-disable', name: 'Disable telemetry', category: 'Monitoring telemetry', fPort: 2, code: 0x23, fixedValue: 0, description: 'Stop periodic monitoring; FPort 2 usage reports continue.', confirmation: 'Disable periodic FPort 4 telemetry? Monitoring will become stale. Silence alone cannot confirm that the setting was applied.' },
  { id: 'telemetry-interval', name: 'Set telemetry interval', category: 'Monitoring telemetry', fPort: 2, code: 0x24, min: 10, max: 65535, defaultValue: 60, description: 'Set the FPort 4 monitoring interval in seconds. Below 60 seconds uses more LoRaWAN airtime. This does not change the FPort 2 usage-report interval.' },
  { id: 'telemetry-now', name: 'Request Telemetry Now', category: 'Monitoring telemetry', fPort: 2, code: 0x25, description: 'Request one FPort 4 frame immediately, even when periodic monitoring is disabled (firmware v1.0.4+).' },
];

export function generateCommand(id: unknown, value?: unknown) {
  const command = commandCatalogue.find(item => item.id === id);
  if (!command) throw new Error('Unsupported command');
  const bytes = [command.code];
  if (command.min !== undefined || command.options) {
    if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error('An integer parameter is required');
    if (command.options) {
      if (!command.options.some(option => option.value === value)) throw new Error('Unsupported parameter value');
      bytes.push(value);
    } else {
      if (value < command.min! || value > command.max!) throw new Error('Report interval must be 10–65535 seconds');
      bytes.push(value >> 8, value & 255);
    }
  } else if (value !== undefined && value !== null) throw new Error('This command takes no parameters');
  if (command.fixedValue !== undefined) bytes.push(command.fixedValue);
  const expectedLength = command.min !== undefined ? 3 : command.options || command.fixedValue !== undefined ? 2 : 1;
  if (bytes.length !== expectedLength || ![2, 3].includes(command.fPort)) throw new Error('Invalid command frame');
  const payload = Buffer.from(bytes);
  return { id: command.id, name: command.name, description: command.description, fPort: command.fPort,
    hex: payload.toString('hex').toUpperCase(), data: payload.toString('base64'), length: payload.length,
    value: value ?? null, parameter: command.options?.find(option => option.value === value)?.label || (command.min !== undefined ? `${value} seconds` : null),
    requiresConfirmation: !!command.confirmation, confirmation: command.confirmation || null, confirmed: false };
}
