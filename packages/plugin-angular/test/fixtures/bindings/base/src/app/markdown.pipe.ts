import { Pipe } from '@angular/core';

@Pipe({ name: 'markdown' })
export class MarkdownPipe {
  transform(content: string): string {
    return content.trim();
  }
}
