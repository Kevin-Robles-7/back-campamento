import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet],
  template: `
    <a
      class="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[999]
             focus:rounded-xl focus:bg-lime focus:px-4 focus:py-2.5 focus:text-sm
             focus:font-bold focus:text-dark"
      href="#contenido"
    >
      Ir al contenido principal
    </a>
    <router-outlet />
  `,
})
export class App {}
