import { Component, OnInit, OnDestroy } from '@angular/core';
@Component({
  selector: 'app-clock',
  standalone: true,
  template: `<p>Clock: {{ now }} / {{ heavy }}</p>`,
})
export class ClockComponent implements OnInit, OnDestroy {
  now = Date.now();
  private t: any;
  ngOnInit() { this.t = setInterval(() => { this.now = Date.now(); }, 100); }
  ngOnDestroy() { clearInterval(this.t); }
  // Heavy getter evaluated on every change-detection pass (classic NG problem).
  get heavy() {
    let s = 0;
    for (let i = 0; i < 700000; i++) s += Math.sqrt((i * this.now) % 7);
    return Math.round(s);
  }
}
