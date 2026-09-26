import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { IconComponent } from './icon.component';
import { PesosPipe } from '../pipes/pesos.pipe';

/**
 * Tarjeta de pago: QR, llave Bre-B con botón de copiar e instrucciones.
 *
 * El QR se genera con `npm run qr` a partir del payload EMV de Bre-B y se
 * sirve desde `public/img/pago/qr-pago.svg`. Si el archivo falta se muestra
 * un marcador y la llave sigue siendo utilizable.
 */
@Component({
  selector: 'app-tarjeta-pago',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, PesosPipe],
  template: `
    <section class="card-flush">
      <header class="card-head">
        <h3 class="card-title">
          <app-icon name="wallet" [size]="17" />
          Realiza tu pago
        </h3>
        <span class="badge badge-lime">Desde {{ abonoMinimo() | pesos }}</span>
      </header>

      <div class="grid gap-5 p-5 lg:grid-cols-[auto_minmax(0,1fr)]">
        <!-- ====== QR ====== -->
        <figure class="grid justify-items-center gap-2 lg:sticky lg:top-24">
          @if (qrDisponible()) {
            <!-- 260 px como mínimo: por debajo de eso los lectores fallan
                 con un QR de esta densidad (73x73 módulos). -->
            <img
              class="size-[260px] rounded-2xl bg-white p-2 shadow-soft sm:size-[300px]"
              src="img/pago/qr-pago.svg"
              alt="Código QR para pagar el campamento a la llave @plata3143817689"
              width="300"
              height="300"
              decoding="async"
              (error)="qrDisponible.set(false)"
            />
          } @else {
            <div
              class="grid size-[260px] place-items-center gap-2 rounded-2xl border border-dashed
                     border-white/25 bg-green-dark p-4 text-center sm:size-[300px]"
              role="img"
              aria-label="Código QR no disponible"
            >
              <app-icon name="target" [size]="26" />
              <span class="text-xs text-muted">
                No se pudo cargar el QR.<br />
                Usa la llave de al lado.
              </span>
            </div>
          }
          <figcaption class="text-xs tracking-wider text-muted uppercase">
            Escanea para pagar
          </figcaption>
        </figure>

        <!-- ====== Llave e instrucciones ====== -->
        <div class="grid content-start gap-4">
          <div class="grid gap-2">
            <span class="text-xs font-semibold tracking-wide text-muted uppercase">
              O usa la llave
            </span>
            <div
              class="flex flex-wrap items-center gap-3 rounded-xl border border-lime/40
                     bg-lime/10 px-4 py-3"
            >
              <strong class="min-w-0 flex-1 break-all font-display text-lg text-lime">
                {{ llave() }}
              </strong>
              <button
                class="btn btn-outline btn-sm shrink-0"
                type="button"
                (click)="copiar()"
                [attr.aria-label]="'Copiar la llave ' + llave()"
              >
                <app-icon [name]="copiada() ? 'check' : 'copy'" [size]="15" />
                {{ copiada() ? 'Copiada' : 'Copiar' }}
              </button>
            </div>
          </div>

          <ol class="grid gap-1.5 text-sm text-cream-dim">
            <li class="flex gap-2">
              <span class="font-bold text-lime">1.</span>
              Abre tu aplicación de pagos (Nequi, Daviplata, Bancolombia…).
            </li>
            <li class="flex gap-2">
              <span class="font-bold text-lime">2.</span>
              Escanea el QR o pega la llave como destino.
            </li>
            <li class="flex gap-2">
              <span class="font-bold text-lime">3.</span>
              Envía desde {{ abonoMinimo() | pesos }}.
            </li>
            <li class="flex gap-2">
              <span class="font-bold text-lime">4.</span>
              Guarda la captura del comprobante y súbela abajo.
            </li>
          </ol>

          <p class="alerta alerta-warn text-xs">
            <app-icon class="mt-0.5 shrink-0" name="alert" [size]="16" />
            <span>
              <strong>El pago debe llegar a esta llave.</strong>
              Verificamos automáticamente la cuenta destino del comprobante; si el dinero se envió a
              otra cuenta, no podremos validarlo.
            </span>
          </p>
        </div>
      </div>
    </section>
  `,
})
export class TarjetaPagoComponent {
  private readonly api = inject(ApiService);

  protected readonly qrDisponible = signal(true);
  protected readonly copiada = signal(false);

  private readonly config = toSignal(
    this.api.obtenerConfiguracion().pipe(catchError(() => of(null))),
    { initialValue: null },
  );

  protected readonly llave = computed(() => this.config()?.llavePago ?? '@Plata3143817689');
  protected readonly abonoMinimo = computed(() => this.config()?.abonoMinimo ?? 20000);

  protected async copiar(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.llave());
    } catch {
      // Navegadores sin permiso de portapapeles: se selecciona el texto.
      const rango = document.createRange();
      const nodo = document.querySelector('app-tarjeta-pago strong');
      if (nodo) {
        rango.selectNodeContents(nodo);
        getSelection()?.removeAllRanges();
        getSelection()?.addRange(rango);
      }
    }
    this.copiada.set(true);
    setTimeout(() => this.copiada.set(false), 2000);
  }
}
