/**
 * Git, or Symbiote before running it, refused a change to the repository (V66): nothing changed.
 * The message is git's own words, or what Symbiote checked.
 */
export class GitRefused extends Error {
  override name = 'GitRefused';
}
