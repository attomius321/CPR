// The page key of every symbiote view the e2e harness starts (SC1, decision 930): set as the
// server's `SYMBIOTE_PAGE_KEY` and sent by every spec's page (`playwright.config.ts`), so a spec
// opens any address and writes. The specs of the key itself pass none, and open what Symbiote
// prints or opens.
export const E2E_PAGE_KEY = 'e2e-page-key';

/**
 * Nucleus's key of every symbiote view the harness starts (SC1, decision 931): a spec that plays
 * Nucleus's bridge runs it with this `SYMBIOTE_NUCLEUS_KEY`, as Symbiote's MCP file sets it.
 */
export const E2E_NUCLEUS_KEY = 'e2e-nucleus-key';
