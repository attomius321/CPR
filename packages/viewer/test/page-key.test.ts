// SC1 (decision 930): the open token an address carries in its fragment, taken out of it.
import { describe, expect, it } from 'vitest';
import { isKeyRefusal, splitToken } from '../src/ui/page-key.js';

describe('splitToken', () => {
  it('takes the token out of the fragment, and keeps whatever else it holds', () => {
    expect(splitToken('#k=abc_-9')).toEqual({ token: 'abc_-9', hash: '' });
    expect(splitToken('#k=abc&x=1')).toEqual({ token: 'abc', hash: '#x=1' });
    expect(splitToken('#x=1&k=abc')).toEqual({ token: 'abc', hash: '#x=1' });
  });

  it('finds none in a fragment without one, which stays as it is', () => {
    expect(splitToken('')).toEqual({ token: null, hash: '' });
    expect(splitToken('#section')).toEqual({ token: null, hash: '#section' });
    expect(splitToken('#k=')).toEqual({ token: null, hash: '' });
  });
});

describe('isKeyRefusal', () => {
  it('knows a refusal for want of the page key by its header', () => {
    const refused = (status: number, header?: string) =>
      ({
        status,
        headers: new Headers(header ? { 'x-symbiote-refused': header } : {}),
      }) as Response;
    expect(isKeyRefusal(refused(403, 'key'))).toBe(true);
    expect(isKeyRefusal(refused(403))).toBe(false);
    expect(isKeyRefusal(refused(200, 'key'))).toBe(false);
  });
});
