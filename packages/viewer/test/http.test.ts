import { describe, expect, it } from 'vitest';
import { serverWords } from '../src/ui/http.js';

describe('serverWords', () => {
  it("reads a refusal's words: its { error }, else its text", () => {
    expect(serverWords('{"error":"no workspace feature/x"}')).toBe('no workspace feature/x');
    expect(serverWords("branch: a workspace's branch")).toBe("branch: a workspace's branch");
    expect(serverWords('{"other":1}')).toBe('{"other":1}');
    expect(serverWords('null')).toBe('null');
  });
});
