import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ApiService, mensajeDeError } from '../../core/services/api.service';
import type { Comprobante, Inscripcion, Persona } from '../../core/models/campamento.models';
import { EncabezadoComponent } from '../../shared/layout/encabezado.component';
import { PieComponent } from '../../shared/layout/pie.component';
import { IconComponent } from '../../shared/ui/icon.component';
import { WhatsappFlotanteComponent } from '../../shared/ui/whatsapp-flotante.component';
import { SubirComprobanteComponent } from '../../shared/ui/subir-comprobante.component';
import { TarjetaPagoComponent } from '../../shared/ui/tarjeta-pago.component';
import { PesosPipe } from '../../shared/pipes/pesos.pipe';
import { aCriterio } from '../consulta/consulta.page';

type Etapa = 'buscar' | 'encontrada' | 'pagar' | 'confirmar' | 'listo';

/** Cómo se aplica el dinero del comprobante. */
type Modo = 'solo' | 'repartir';

/** Una línea del reparto simulado antes de registrar el pago. */
export interface LineaReparto {
  persona: Persona;
  aplicado: number;
  saldoFinal: number;
  cierra: boolean;
}

/**
 * Flujo «Terminar inscripción»: busca por documento o código, deja elegir a
 * quién se aplica el pago, muestra el reparto antes de confirmarlo y reporta
 * qué personas quedaron cerradas.
 */
@Component({
  selector: 'app-terminar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    ReactiveFormsModule,
    EncabezadoComponent,
    PieComponent,
    IconComponent,
    SubirComprobanteComponent,
    TarjetaPagoComponent,
    WhatsappFlotanteComponent,
    PesosPipe,
  ],
  templateUrl: './terminar.page.html',
})
export class TerminarPage {
  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder);

  protected readonly etapa = signal<Etapa>('buscar');
  protected readonly buscando = signal(false);
  protected readonly registrando = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly inscripcion = signal<Inscripcion | null>(null);

  /** A quién se aplica primero el dinero. */
  protected readonly personaId = signal<number | null>(null);
  /** «solo» no reparte el excedente; «repartir» cierra a los demás. */
  protected readonly modo = signal<Modo>('repartir');
  /** Comprobante ya verificado, a la espera de confirmación. */
  protected readonly comprobante = signal<Comprobante | null>(null);

  private readonly saldosPrevios = signal<Map<number, number>>(new Map());

  protected readonly formulario = this.fb.nonNullable.group({
    valor: ['', [Validators.required, Validators.minLength(4)]],
  });

  protected readonly conSaldo = computed(
    () => this.inscripcion()?.personas.filter((p) => p.saldoPendiente > 0) ?? [],
  );

  protected readonly faltaTotal = computed(() => this.inscripcion()?.saldoPendiente ?? 0);

  protected readonly personaElegida = computed(
    () => this.conSaldo().find((p) => p.id === this.personaId()) ?? null,
  );

  /**
   * Simula el reparto del pago con las mismas reglas del servidor:
   * primero la persona elegida y, si el modo lo permite, el excedente pasa
   * a las demás con saldo pendiente.
   */
  protected readonly reparto = computed<LineaReparto[]>(() => {
    const valor = this.comprobante()?.valorEnviado ?? 0;
    const elegida = this.personaId();

    const orden = [...this.conSaldo()].sort((a, b) => {
      if (a.id === elegida) return -1;
      if (b.id === elegida) return 1;
      return a.id - b.id;
    });

    const objetivo = this.modo() === 'solo' && elegida ? orden.filter((p) => p.id === elegida) : orden;

    let restante = valor;
    return objetivo.map((persona) => {
      const aplicado = Math.min(persona.saldoPendiente, restante);
      restante -= aplicado;
      const saldoFinal = persona.saldoPendiente - aplicado;
      return { persona, aplicado, saldoFinal, cierra: saldoFinal === 0 && aplicado > 0 };
    });
  });

  /** Dinero que no alcanza a cubrir ningún saldo y queda a favor. */
  protected readonly sobrante = computed(() => {
    const valor = this.comprobante()?.valorEnviado ?? 0;
    const aplicado = this.reparto().reduce((suma, linea) => suma + linea.aplicado, 0);
    return Math.max(0, valor - aplicado);
  });

  protected readonly cerrara = computed(() => this.reparto().filter((l) => l.cierra).length);

  protected readonly cerradasAhora = computed<Persona[]>(() => {
    const previos = this.saldosPrevios();
    return (
      this.inscripcion()?.personas.filter(
        (p) => p.saldoPendiente === 0 && (previos.get(p.id) ?? 0) > 0,
      ) ?? []
    );
  });

  // ---------------- Búsqueda ----------------

  protected buscar(): void {
    if (this.formulario.invalid) {
      this.formulario.markAllAsTouched();
      return;
    }

    this.buscando.set(true);
    this.error.set(null);

    this.api.consultarInscripcion(aCriterio(this.formulario.controls.valor.value)).subscribe({
      next: ({ inscripcion }) => {
        this.buscando.set(false);
        this.inscripcion.set(inscripcion);
        this.personaId.set(inscripcion.personas.find((p) => p.saldoPendiente > 0)?.id ?? null);
        this.etapa.set('encontrada');
      },
      error: (error) => {
        this.buscando.set(false);
        this.error.set(mensajeDeError(error));
      },
    });
  }

  // ---------------- Pago ----------------

  protected irAPagar(): void {
    this.error.set(null);
    this.comprobante.set(null);
    this.etapa.set('pagar');
  }

  protected elegirPersona(id: string): void {
    this.personaId.set(id ? Number(id) : null);
  }

  protected elegirModo(modo: Modo): void {
    this.modo.set(modo);
  }

  /** El comprobante ya fue verificado: se muestra el reparto para confirmar. */
  protected comprobanteConfirmado(comprobante: Comprobante): void {
    this.comprobante.set(comprobante);
    this.etapa.set('confirmar');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  protected registrarPago(): void {
    const inscripcion = this.inscripcion();
    const comprobante = this.comprobante();
    if (!inscripcion || !comprobante) return;

    this.saldosPrevios.set(new Map(inscripcion.personas.map((p) => [p.id, p.saldoPendiente])));
    this.registrando.set(true);
    this.error.set(null);

    this.api
      .registrarAbono({
        inscripcionId: inscripcion.id,
        personaId: this.personaId(),
        comprobanteId: comprobante.id,
        soloPersona: this.modo() === 'solo',
      })
      .subscribe({
        next: ({ inscripcion: actualizada }) => {
          this.registrando.set(false);
          this.inscripcion.set(actualizada);
          this.etapa.set('listo');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        },
        error: (error) => {
          this.registrando.set(false);
          this.error.set(mensajeDeError(error));
        },
      });
  }

  protected volverAlPago(): void {
    this.comprobante.set(null);
    this.etapa.set('pagar');
  }

  protected volverABuscar(): void {
    this.etapa.set('buscar');
    this.inscripcion.set(null);
    this.personaId.set(null);
    this.comprobante.set(null);
    this.modo.set('repartir');
    this.error.set(null);
    this.saldosPrevios.set(new Map());
    this.formulario.reset();
  }
}
