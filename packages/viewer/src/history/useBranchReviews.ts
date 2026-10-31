import { useEffect, useMemo, useState } from 'react';
import type { BranchReviewList } from '@symbiote/core';
import { fetchReviews } from './api.js';
import { reviewMarks } from './branchReviews.js';

/**
 * The reviewer's branch reviews (V15) as marks for History: read when the page opens, and again
 * when it is back, since a review is made on another page.
 */
export function useBranchReviews(): ReturnType<typeof reviewMarks> {
  const [reviews, setReviews] = useState<BranchReviewList | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => {
      if (document.visibilityState === 'hidden') return;
      fetchReviews()
        .then((list) => live && setReviews(list))
        .catch(() => {});
    };
    load();
    window.addEventListener('focus', load);
    document.addEventListener('visibilitychange', load);
    return () => {
      live = false;
      window.removeEventListener('focus', load);
      document.removeEventListener('visibilitychange', load);
    };
  }, []);
  return useMemo(() => reviewMarks(reviews), [reviews]);
}
