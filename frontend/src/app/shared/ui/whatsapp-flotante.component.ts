import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { IconComponent } from './icon.component';

/** Enlace flotante a WhatsApp, siempre visible en la esquina inferior. */
@Component({
  selector: 'app-whatsapp-flotante',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <a
      class="group fixed right-5 bottom-5 z-50 flex items-center gap-2.5 rounded-full
             bg-[#25d366] py-3 pr-5 pl-4 font-sans text-sm font-bold text-[#07231a]
             shadow-[0_12px_30px_rgba(37,211,102,0.35)] transition-all duration-200
             hover:-translate-y-1 hover:bg-[#3ae37a]"
      [href]="enlace()"
      target="_blank"
      rel="noopener"
      aria-label="Escribir por WhatsApp"
    >
      <app-icon name="whatsapp" [size]="20" [grosor]="2" />
      <span class="max-sm:sr-only">Escríbenos</span>
    </a>
  `,
})
export class WhatsappFlotanteComponent {
  private readonly api = inject(ApiService);

  private readonly config = toSignal(
    this.api.obtenerConfiguracion().pipe(catchError(() => of(null))),
    { initialValue: null },
  );

  protected readonly enlace = computed(() => {
    const numero = this.config()?.whatsapp ?? '573143817689';
    const texto = encodeURIComponent(
      'Hola, quiero recibir mas informacion sobre el campamento de IPUC Bosque Popular.',
    );
    return `https://wa.me/${numero}?text=${texto}`;
  });
}
