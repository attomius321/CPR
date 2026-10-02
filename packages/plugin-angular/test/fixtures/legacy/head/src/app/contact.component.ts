import { Component, OnInit } from '@angular/core';

@Component({
  selector: 'app-contact',
  templateUrl: './contact.component.html',
})
export class ContactComponent implements OnInit {
  title = 'Contact us';

  ngOnInit(): void {
    this.title = this.title.trim();
  }
}
