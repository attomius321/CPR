import { Component } from '@angular/core';
import { ArticleComponent } from './article.component';

// Test hosts are rarely exported: their templates are skipped without a warning.
@Component({ selector: 'app-host', template: '<app-article />', imports: [ArticleComponent] })
class TestHostComponent {}

export const host = TestHostComponent;
