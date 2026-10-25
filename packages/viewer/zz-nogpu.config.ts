// Throwaway, not committed: this machine's headless GPU process hangs (no animation frame fires).
import base from './playwright.config.js';
export default {
  ...base,
  use: { ...base.use, launchOptions: { ...base.use?.launchOptions, args: ['--disable-gpu', '--disable-software-rasterizer'] } },
};
