/** Existing Console broker settings, shared with the opt-in agent. */
export function mqttConnection(): string | { host: string; port: number } {
  if (!process.env.MQTT_URL) return { host: process.env.CHIRPSTACK_HOST || 'localhost', port: 1883 };
  try {
    const url = new URL(process.env.MQTT_URL);
    if (!['mqtt:', 'mqtts:', 'ws:', 'wss:'].includes(url.protocol) || !url.hostname || url.hash) throw new Error();
    return process.env.MQTT_URL;
  } catch { throw new Error('MQTT_URL must be a valid mqtt, mqtts, ws or wss broker URL.'); }
}
