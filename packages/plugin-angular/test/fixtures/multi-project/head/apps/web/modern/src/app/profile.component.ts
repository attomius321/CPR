import { Component } from '@angular/core';
import { BadgeComponent } from '@acme/badge';
import { Account } from '@app/core/account';

@Component({
  selector: 'app-profile',
  templateUrl: './profile.component.html',
  imports: [BadgeComponent],
})
export class ProfileComponent {
  account: Account = new Account();
}
