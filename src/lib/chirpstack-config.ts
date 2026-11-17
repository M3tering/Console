/** Shared collector/agent configuration. Never logs connection credentials. */
export function applicationId(): string {
  const id = process.env.APPLICATION_ID;
  if (!id || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id)) {
    throw new Error('Configure APPLICATION_ID with your ChirpStack application UUID.');
  }
  return id.toLowerCase();
}
