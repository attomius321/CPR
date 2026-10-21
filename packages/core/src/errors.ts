/** An error caused by user input or environment. The CLI prints its message without a stack trace.
 * */
export class SymbioteError extends Error {
  override name = 'SymbioteError';
}
