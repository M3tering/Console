/** Shared by the hourly job and the Publish Now button, so the app shows whichever ran last. */
export const lastPublish: { time: Date | null; status: 'success' | 'error' | null; count: number } = { time: null, status: null, count: 0 };
export function recordPublish(status: 'success' | 'error', count = 0): void {
  lastPublish.time = new Date(); lastPublish.status = status; lastPublish.count = count;
}
