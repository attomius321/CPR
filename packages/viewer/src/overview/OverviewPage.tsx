// The Overview (V91, decisions 848–849): one page at `/overview`, the one `/` opens, first in the
// sidenav; normal mode's or Hive's by the mode the repository is in.
import { useHive } from '../shell/hive.js';
import { HiveOverview } from './HiveOverview.js';
import { NormalOverview } from './NormalOverview.js';

export function OverviewPage() {
  return useHive() ? <HiveOverview /> : <NormalOverview />;
}
