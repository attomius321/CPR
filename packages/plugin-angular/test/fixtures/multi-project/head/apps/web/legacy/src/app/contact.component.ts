import { Component, NgModule } from '@angular/core';
import { BadgeComponent } from '@acme/badge';
import { Account } from 'app/core/account';

@Component({ selector: 'app-contact', templateUrl: './contact.component.html' })
export class ContactComponent {
  account: Account = new Account();

  clear(): void {
    this.account = new Account();
  }
}

@NgModule({ declarations: [ContactComponent], imports: [BadgeComponent] })
export class ContactModule {}
