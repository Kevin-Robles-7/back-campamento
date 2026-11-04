import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ApiService, mensajeDeError } from '../../core/services/api.service';
import type {
  AsignacionManual,
  Comprobante,
  Inscripcion,
  Persona,
  PersonaReparto,
} from '../../core/models/campamento.models';
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

/** Persona que quedó completa tras un reparto manual, con su inscripción. */
interface CierreReparto {
  nombreCompleto: string;
  inscripcionCodigo: string;
  valor: number;
}

/**
 * Flujo «Terminar inscripción»: busca por documento o código, deja elegir a
 * quién se aplica el pago, muestra el reparto antes de confirmarlo y reporta
 * qué personas quedaron cerradas.
 *
 * Además permite distribuir el pago entre personas de OTRAS inscripciones:
 * se buscan por documento, se les asigna una suma exacta y todo se registra
 * en un solo reparto donde el dinero recibido y el asignado cuadran a $0.
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

  // ---------------- Añadir persona de otra inscripción ----------------

  /** Personas añadidas a la distribución: persona + cuanto le entra. */
  protected readonly asignadas = signal<AsignacionManual[]>([]);

  protected readonly busquedaPersona = this.fb.nonNullable.group({
    documento: [
      '',
      [
        Validators.required,
        Validators.minLength(4),
        Validators.maxLength(20),
        Validators.pattern(/^[A-Za-z0-9]+$/),
      ],
    ],
  });

  protected readonly buscandoPersona = signal(false);
  protected readonly personaBuscada = signal<PersonaReparto | null>(null);

  /** Mensaje cuando la búsqueda por documento no encontró a nadie. */
  protected readonly sinResultados = signal(false);

  /** Cuanto se le va a asignar a la persona recién buscada (texto del input). */
  protected readonly valorNueva = signal('');

  /** Inscripciones actualizadas por el último reparto registrado. */
  protected readonly inscripcionesAfectadas = signal<Inscripcion[]>([]);

  /** Personas de otras inscripciones que quedaron completas. */
  protected readonly cierresReparto = signal<CierreReparto[]>([]);

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

  // ---------------- Distribución manual (resumen en vivo) ----------------

  /** Con personas añadidas, la distribución se hace a mano y suma exacta. */
  protected readonly usaManual = computed(() => this.asignadas().length > 0);

  /** Dinero recibido por el comprobante. */
  protected readonly recibido = computed(() => this.comprobante()?.valorEnviado ?? 0);

  /** Dinero ya asignado en la distribución manual. */
  protected readonly asignado = computed(() =>
    this.asignadas().reduce((suma, linea) => suma + linea.valor, 0),
  );

  /** Dinero que falta por asignar (o negativo si se pasa). */
  protected readonly restante = computed(() => this.recibido() - this.asignado());

  /** Asignaciones que no son válidas: 0, negativas o superiores a la deuda. */
  protected readonly hayInvalidas = computed(() =>
    this.asignadas().some((linea) => linea.valor < 1 || linea.valor > linea.persona.saldoPendiente),
  );

  /** Cuanto puede recibir una persona NUEVA: su saldo y, si ya hay un
   *  comprobante verificado, lo que queda del dinero recibido. */
  protected readonly maximoNueva = computed(() => {
    const persona = this.personaBuscada();
    if (!persona) return 0;
    // Sin comprobante todavía no se sabe cuánto llega: el tope es la deuda.
    const tope = this.comprobante() ? Math.max(0, this.restante()) : Infinity;
    return Math.min(persona.saldoPendiente, tope);
  });

  protected readonly yaAgregada = computed(
    () => !!this.personaBuscada() && this.asignadas().some((l) => l.persona.id === this.personaBuscada()!.id),
  );

  /** El botón de registro se bloquea si la distribución no cuadra a $0. */
  protected readonly puedeRegistrar = computed(() => {
    if (!this.comprobante()) return false;
    if (!this.usaManual()) return true;
    return this.restante() === 0 && !this.hayInvalidas();
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
    this.limpiarDistribucion();
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

  /** Busca una persona por documento en todas las inscripciones. */
  protected buscarPersona(): void {
    if (this.busquedaPersona.invalid) {
      this.busquedaPersona.markAllAsTouched();
      return;
    }

    this.buscandoPersona.set(true);
    this.sinResultados.set(false);
    this.personaBuscada.set(null);
    this.valorNueva.set('');

    this.api.buscarPersona(this.busquedaPersona.controls.documento.value).subscribe({
      next: ({ persona }) => {
        this.buscandoPersona.set(false);
        this.personaBuscada.set(persona);
        this.sinResultados.set(persona === null);
      },
      error: (error) => {
        this.buscandoPersona.set(false);
        this.error.set(mensajeDeError(error));
      },
    });
  }

  protected escribirValorNueva(texto: string): void {
    this.valorNueva.set(texto.replace(/[^\d]/g, ''));
  }

  protected valorNuevaValida(): boolean {
    const persona = this.personaBuscada();
    if (!persona) return false;
    const valor = Number(this.valorNueva());
    return valor >= 1 && valor <= this.maximoNueva();
  }

  /** Añade a la persona buscada a la distribución con la suma indicada. */
  protected agregarPersona(): void {
    const persona = this.personaBuscada();
    if (!persona || this.yaAgregada() || !this.valorNuevaValida()) return;

    const valor = Number(this.valorNueva());
    this.asignadas.update((lista) => [
      ...lista,
      { persona, valor, cierra: valor === persona.saldoPendiente },
    ]);
    this.personaBuscada.set(null);
    this.sinResultados.set(false);
    this.valorNueva.set('');
    this.busquedaPersona.controls.documento.reset();
  }

  /** Edita en vivo cuánto dinero recibe una persona ya asignada. */
  protected editarValor(personaId: number, texto: string): void {
    const valor = Number(texto.replace(/[^\d]/g, '')) || 0;
    this.asignadas.update((lista) =>
      lista.map((linea) => {
        if (linea.persona.id !== personaId) return linea;
        return {
          ...linea,
          valor,
          cierra: valor === linea.persona.saldoPendiente,
        };
      }),
    );
  }

  /** Retira a una persona de la distribución antes de confirmar. */
  protected quitarPersona(personaId: number): void {
    this.asignadas.update((lista) => lista.filter((linea) => linea.persona.id !== personaId));
  }

  /** Rótulos para el badge de una línea: cierra, abono parcial o inválida. */
  protected tipoLinea(linea: AsignacionManual): 'cierra' | 'abono' | 'invalida' | 'cero' {
    if (linea.valor > linea.persona.saldoPendiente) return 'invalida';
    if (linea.cierra) return 'cierra';
    if (linea.valor >= 1) return 'abono';
    return 'cero';
  }

  protected registrarPago(): void {
    const inscripcion = this.inscripcion();
    const comprobante = this.comprobante();
    if (!inscripcion || !comprobante) return;

    this.saldosPrevios.set(new Map(inscripcion.personas.map((p) => [p.id, p.saldoPendiente])));
    this.registrando.set(true);
    this.error.set(null);

    // Con personas añadidas, el reparto es manual y suma exacta.
    if (this.usaManual()) {
      // Guarda quién cierra para mostrarlo en el resultado (antes de limpiar).
      this.cierresReparto.set(
        this.asignadas()
          .filter(
            (linea) => linea.cierra && linea.persona.inscripcionId !== inscripcion.id,
          )
          .map((linea) => ({
            nombreCompleto: linea.persona.nombreCompleto,
            inscripcionCodigo: linea.persona.inscripcionCodigo,
            valor: linea.valor,
          })),
      );

      this.api
        .registrarReparto({
          comprobanteId: comprobante.id,
          asignaciones: this.asignadas().map((linea) => ({
            personaId: linea.persona.id,
            valor: linea.valor,
          })),
        })
        .subscribe({
          next: ({ inscripciones }) => {
            this.registrando.set(false);
            this.inscripcionesAfectadas.set(inscripciones);
            // Si la inscripción buscada fue tocada, se muestra actualizada;
            // si no, se conserva como estaba (su saldo no cambió).
            const original = inscripciones.find((i) => i.id === inscripcion.id);
            if (original) this.inscripcion.set(original);
            this.limpiarDistribucion();
            this.etapa.set('listo');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          },
          error: (error) => {
            this.registrando.set(false);
            this.cierresReparto.set([]);
            this.error.set(mensajeDeError(error));
          },
        });
      return;
    }

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
    this.limpiarDistribucion();
    this.inscripcionesAfectadas.set([]);
    this.cierresReparto.set([]);
    this.formulario.reset();
  }

  /** Vacía la búsqueda y la lista de personas añadidas. */
  private limpiarDistribucion(): void {
    this.asignadas.set([]);
    this.personaBuscada.set(null);
    this.sinResultados.set(false);
    this.valorNueva.set('');
    this.busquedaPersona.controls.documento.reset();
  }
}
