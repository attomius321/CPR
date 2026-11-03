// Opening a workspace's review (V18c): Symbiote makes the branch's review and the page goes to its
// address. One way for the workspace's head and the Overview's inbox (V91, decision 854).
import { postJson } from '../ui/http.js';

/** Asks Symbiote for `branch`'s review and opens it in this window. */
export async function openReview(branch: string): Promise<void> {
  const { url } = await postJson<{ url: string }>('/api/reviews', { ref: branch });
  window.location.assign(url);
}
