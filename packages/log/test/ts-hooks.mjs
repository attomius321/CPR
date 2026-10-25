// Lets a test's child process run this package's TypeScript sources with Node's type stripping:
// a relative `./x.js` import that has no file is tried as `./x.ts`, as TypeScript resolves it.
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (!specifier.startsWith('.') || !specifier.endsWith('.js')) throw error;
      return nextResolve(`${specifier.slice(0, -'.js'.length)}.ts`, context);
    }
  },
});
