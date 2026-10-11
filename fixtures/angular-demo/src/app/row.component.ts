import { Component, Input } from '@angular/core';
@Component({ selector: 'app-row', standalone: true, template: `<li>{{ item.label }}</li>` })
export class RowComponent { @Input() item: any; }
