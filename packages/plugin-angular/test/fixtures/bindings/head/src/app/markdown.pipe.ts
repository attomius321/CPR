import { Pipe } from '@angular/core';

@Pipe({ name: 'markdown' })
export class MarkdownPipe {
  async transform(content: string): Promise<string> {
    return content.trim();
  }
}
