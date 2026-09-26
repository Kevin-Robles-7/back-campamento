import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import { ApiService, mensajeDeError } from '../../core/services/api.service';
import { InscripcionStore, PRIMER_PASO } from '../../core/services/inscripcion.store';
import { DescarteService } from '../../core/services/descarte.service';
import type {
  Comprobante,
  PersonaInput,
  TransporteInscripcion,
} from '../../core/models/campamento.models';
import { IconComponent } from '../../shared/ui/icon.component';
import { StepperComponent } from '../../shared/ui/stepper.component';
import { SubirComprobanteComponent } from '../../shared/ui/subir-comprobante.component';
import { TarjetaPagoComponent } from '../../shared/ui/tarjeta-pago.component';
import { WhatsappFlotanteComponent } from '../../shared/ui/whatsapp-flotante.component';
import { PesosPipe } from '../../shared/pipes/pesos.pipe';
import { PieComponent } from '../../shared/layout/pie.component';
import { PasoPersonasComponent } from './pasos/paso-personas.component';

const TITULOS: Record<number, string> = {
  2: 'Nueva inscripción',
  3: 'Validación de pago',
  4: 'Registro de personas',
  5: 'Resumen de inscripción',
};

@Component({
  selector: 'app-inscripcion',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    IconComponent,
    StepperComponent,
    SubirComprobanteComponent,
    TarjetaPagoComponent,
    PasoPersonasComponent,
    PieComponent,
    WhatsappFlotanteComponent,
    PesosPipe,
  ],
  templateUrl: './inscripcion.page.html',
})
export class InscripcionPage {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  protected readonly store = inject(InscripcionStore);
  // Al instanciarse queda escuchando el cierre/recarga de la página.
  private readonly descarte = inject(DescarteService);
  protected readonly primerPaso = PRIMER_PASO;

  protected readonly config = toSignal(
    this.api.obtenerConfiguracion().pipe(catchError(() => of(null))),
    { initialValue: null },
  );

  protected readonly cargandoAnalisis = signal(false);
  protected readonly enviando = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly titulo = computed(() => TITULOS[this.store.paso()] ?? 'Inscripción');

  protected readonly abonoMinimo = computed(
    () => this.store.analisis()?.opciones.bus.abonoMinimo ?? this.config()?.abonoMinimo ?? 20000,
  );

  protected readonly tarifaBus = computed(
    () => this.store.analisis()?.opciones.bus.tarifa ?? this.config()?.tarifaBus ?? 195000,
  );

  protected readonly tarifaVehiculo = computed(
    () =>
      this.store.analisis()?.opciones.vehiculoPropio.tarifa ??
      this.config()?.tarifaVehiculoPropio ??
      180000,
  );

  /** Etiqueta legible del transporte de la inscripción. */
  protected etiquetaTransporte(valor: TransporteInscripcion): string {
    if (valor === 'mixto') return 'Mixto (bus y vehículo propio)';
    return valor === 'bus' ? 'Bus' : 'Vehículo propio';
  }

  // ---------------- Paso 2: comprobante ----------------

  protected comprobanteConfirmado(comprobante: Comprobante): void {
    this.store.definirComprobante(comprobante);
    this.cargarAnalisis(comprobante.id);
  }

  private cargarAnalisis(comprobanteId: number): void {
    this.cargandoAnalisis.set(true);
    this.error.set(null);

    this.api.analizarComprobante(comprobanteId).subscribe({
      next: (analisis) => {
        this.cargandoAnalisis.set(false);
        this.store.definirAnalisis(analisis);
        this.store.irA(3);
      },
      error: (error) => {
        this.cargandoAnalisis.set(false);
        this.error.set(mensajeDeError(error));
      },
    });
  }

  // ---------------- Paso 3: tarifas ----------------

  protected continuarDesdeValidacion(): void {
    this.error.set(null);
    this.store.irA(4);
  }

  // ---------------- Paso 4: personas ----------------

  protected registrar(personas: PersonaInput[]): void {
    const comprobante = this.store.comprobante();
    if (!comprobante) return;

    this.enviando.set(true);
    this.error.set(null);

    this.api
      .crearInscripcion({ comprobanteId: comprobante.id, personas })
      .subscribe({
        next: ({ inscripcion }) => {
          this.enviando.set(false);
          this.descarte.confirmado();
          this.store.definirInscripcion(inscripcion);
          this.store.paso.set(5);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        },
        error: (error) => {
          this.enviando.set(false);
          this.error.set(mensajeDeError(error));
        },
      });
  }

  // ---------------- Navegación ----------------

  protected atras(): void {
    if (this.store.paso() <= PRIMER_PASO) {
      this.router.navigate(['/']);
      return;
    }
    this.error.set(null);
    this.store.anterior();
  }

  protected nuevaInscripcion(): void {
    this.store.reiniciar();
    this.error.set(null);
  }
}
