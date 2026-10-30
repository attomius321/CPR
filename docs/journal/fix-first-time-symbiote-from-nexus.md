# Journal: Fix — a Symbiote opened from the nexus in Chrome on Windows showed Chrome's error

[Index](../JOURNAL.md) · [Plan](../plan/nx2-open-from-folders.md#fix-a-symbiote-framed-once-this-browser-reaches-it-fixfirst-time-symbiote-from-nexus)

## Fix — a Symbiote framed once this browser reaches it (2026-10-30, branch `fix/first-time-symbiote-from-nexus`)

The person: "I get this error on first time connecting to a repo with symbiote..fix it", with a
screenshot. It showed the nexus with Starknet's tab open and the frame grey, a sad document in
its middle. The logs showed a clean start: the nexus started Starknet's `symbiote view` 6 s before
the screenshot, and it served its page to `curl` afterwards.

**Learned**:
- **The screenshot was Chrome on Windows, not Symbiote's window.** The row had no window buttons.
  Windows' `netstat` showed `chrome.exe` connected to the nexus and to the other Symbiote through
  `wslrelay.exe`, and never to Starknet's port. The grey page (`#DDD`, the icon, its words shown
  only on hover) is Chromium's error page for a frame.
- **WSL with NAT networking forwards a new port to Windows late.** A fresh server's first
  connection from Windows came 18–858 ms after it listened (4 runs). Inside WSL the port answers
  as it listens. So the nexus's server, the e2e's Chromium and Symbiote's window never meet the
  gap: 7 runs of the person's sequence (a restarted nexus, both Symbiotes stopped and opened
  again) all loaded.
- **Chrome does not wait for the port; curl does.** `curl.exe`, asked as the server listened, got
  through 16 times in 16, connected after 0.5 or 1.0 s by Windows' own retries. Headless Chrome
  framing a server at once loaded 0 of 5; 3 s later, 5 of 5.
- **The nexus frames at once, and never again.** A start answers once the record appears, 2 ms
  after `symbiote view` listens, and the page set the frame's address in the same render. A frame
  refused once stays on the error page: the nexus never reloads a frame (decision 521).
- **"First time" was the first load after a start.** The same Symbiote, framed later, loads. A
  restart takes a new port, and the gap comes again.
- **A browser's own request tells.** A `no-cors` fetch fails only when nothing connects; any
  answer, even a refusal by the viewer's guards, means the frame will load.
- **Windows reserves some ports.** Chrome could not take 9339 for its DevTools (`bind()`
  0x271D, Hyper-V's excluded ranges); port 0 and its `DevToolsActivePort` file instead.

**Verification**: the failing test first: `e2e/folders.spec.ts` refuses each Symbiote's address
for its first second, as Windows finds it. Before the fix the frame stayed on
`chrome-error://chromewebdata/`; after it, the Git page shows, for Open Symbiote and for Start
again. `test/reach.test.ts`, 4 tests. In Chrome on Windows (headless, a profile of its own, driven
from Windows' Node), Open Symbiote 6 times each: main loaded 1 of 6, this branch 6 of 6, the frame
committed 814–1,313 ms after the click. The frame waits on the page's own ground, dark and light,
no white flash. `pnpm check` (2,475 tests), `pnpm build`, `pnpm test:e2e`: the viewer's 352
specs in 5.1 min, then the nexus's 19 in 18.0 s (Symbiote's window under Xvfb included).

Not verified: WSL's mirrored networking; Edge or Firefox on Windows; the person's own Chrome;
`symbiote view --browser` and `symbiote-nexus --browser` opening a Windows browser on a new port.
The same gap applies there in principle, but it was not seen: a browser starts slower than WSL
forwards a port.
