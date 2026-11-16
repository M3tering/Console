/** Monitoring only. A snapshot is pending, never an independent billing interval.
 * A consecutive nonce transition supports a completed-cycle observation, not
 * proof of blockchain settlement. Only the collector supplies accepted energy.
 */
export type Accumulator = {
  nonce: number; segment: number; highWater: number; timestamp: number; uncertain: boolean;
  acceptedRaw: number | null; completedObserved: number; completedCollected: number;
};
export function advance(previous: Accumulator | null, nonce: number, rawEnergy: number, timestamp: number) {
  let accounting = 'pending';
  let completedNonce: number | null = null, intervalEnergy: number | null = null, collectedEnergy: number | null = null;
  if (previous && timestamp < previous.timestamp) return { state: previous, accounting: 'late-report', completedNonce, intervalEnergy, collectedEnergy };
  const state: Accumulator = previous ? { ...previous, timestamp, segment: previous.segment || 0 } : {
    nonce, segment: 0, highWater: rawEnergy, timestamp, uncertain: false, acceptedRaw: null, completedObserved: 0, completedCollected: 0,
  };
  if (previous) {
    if (nonce === previous.nonce) {
      accounting = rawEnergy === previous.highWater ? 'repeated-total' : rawEnergy < previous.highWater ? 'counter-reset-uncertain' : 'pending';
      state.highWater = Math.max(previous.highWater, rawEnergy);
      state.uncertain ||= rawEnergy < previous.highWater;
      if (rawEnergy < previous.highWater) state.segment++;
    } else {
      state.segment++;
      const consecutive = nonce === previous.nonce + 1;
      if (consecutive && !previous.uncertain) {
        completedNonce = previous.nonce;
        intervalEnergy = previous.highWater / 1e6; // observed lower bound, not a billed amount
        collectedEnergy = previous.acceptedRaw === null ? null : previous.acceptedRaw / 1e6;
        state.completedObserved += intervalEnergy;
        state.completedCollected += collectedEnergy || 0;
        accounting = 'cycle-advanced';
      } else accounting = consecutive ? 'uncertain-cycle-ended' : 'nonce-reset-or-gap';
      state.nonce = nonce; state.highWater = rawEnergy; state.acceptedRaw = null;
      // A consecutive transition establishes the next cycle's baseline.
      state.uncertain = !consecutive;
    }
  }
  return { state, accounting, completedNonce, intervalEnergy, collectedEnergy };
}
