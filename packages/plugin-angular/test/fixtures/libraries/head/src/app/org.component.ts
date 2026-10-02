import { Component } from '@angular/core';
import { UiAwaitPipe, UiModule, type Stream } from '@acme/ui';
import { OldFormsModule } from '@old/forms';
import type { Organization, User } from './org';

@Component({
  selector: 'app-org',
  templateUrl: './org.component.html',
  imports: [UiModule, UiAwaitPipe, OldFormsModule],
})
export class OrgComponent {
  org$!: Stream<Organization>;
  user$!: Stream<User>;
  count = 0;
  title = '';

  onPress(count: number): void {
    this.count = count;
  }

  onSubmit(): void {
    this.count = 0;
  }

  rename(title: string): void {
    this.title = title;
  }
}
