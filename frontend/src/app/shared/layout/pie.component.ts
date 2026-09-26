import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { IconComponent } from '../ui/icon.component';

@Component({
  selector: 'app-pie',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent],
  template: `
    <footer class="border-t border-white/10 bg-dark-soft py-7 text-sm">
      <div class="shell flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-center">
        <p class="text-muted">
          IPUC Bosque Popular · Campamento
          <span class="text-lime">{{ config()?.fechaEvento ?? '7 y 8 de noviembre' }}</span>
        </p>

        <nav class="flex flex-wrap gap-x-6 gap-y-2" aria-label="Enlaces del pie">
          <a class="text-cream-dim transition hover:text-lime" routerLink="/inscripcion">
            Inscribirme
          </a>
          <a class="text-cream-dim transition hover:text-lime" routerLink="/consultar">
            Consultar inscripción
          </a>
          <a class="text-cream-dim transition hover:text-lime" routerLink="/terminar">
            Terminar inscripción
          </a>
        </nav>

        <a
          class="inline-flex items-center gap-2 font-semibold text-lime transition hover:text-lime-soft"
          [href]="whatsapp()"
          target="_blank"
          rel="noopener"
        >
          <app-icon name="whatsapp" [size]="16" />
          Preguntar por WhatsApp
        </a>
      </div>
    </footer>
  `,
})
export class PieComponent {
  private readonly api = inject(ApiService);

  protected readonly config = toSignal(
    this.api.obtenerConfiguracion().pipe(catchError(() => of(null))),
    { initialValue: null },
  );

  protected readonly whatsapp = computed(() => {
    const numero = this.config()?.whatsapp ?? '573143817689';
    const texto = encodeURIComponent(
      'Hola, quiero información sobre el campamento de IPUC Bosque Popular.',
    );
    return `https://wa.me/${numero}?text=${texto}`;
  });
}
