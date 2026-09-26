import { Injectable, computed, signal } from '@angular/core';
import type {
  AnalisisComprobante,
  Comprobante,
  Inscripcion,
  PersonaInput,
  Transporte,
} from '../models/campamento.models';

/** El paso 1 (elegir qué hacer) vive en la landing; el asistente va del 2 al 5. */
export const PRIMER_PASO = 2;
export const ULTIMO_PASO = 5;

export function personaVacia(): PersonaInput {
  return {
    primerNombre: '',
    primerApellido: '',
    tipoDocumento: 'CC',
    documento: '',
    fechaExpedicion: null,
    telefono: '',
    correo: null,
    fechaNacimiento: null,
    edad: null,
    sexo: null,
    eps: null,
    nombreAcompanante: null,
    transporte: 'bus',
    tipoPago: 'completo',
    valorAbono: null,
    consentimiento: null,
  };
}

/**
 * Estado del asistente de inscripción.
 *
 * A propósito NO se persiste en el navegador: si la persona recarga o cierra
 * la página, el pago y los datos a medio diligenciar se descartan. Solo lo que
 * se confirma en el paso final queda guardado en la base de datos.
 */
@Injectable({ providedIn: 'root' })
export class InscripcionStore {
  readonly paso = signal(PRIMER_PASO);
  readonly comprobante = signal<Comprobante | null>(null);
  readonly analisis = signal<AnalisisComprobante | null>(null);
  readonly transporte = signal<Transporte | null>(null);
  readonly personas = signal<PersonaInput[]>([personaVacia()]);
  readonly inscripcion = signal<Inscripcion | null>(null);

  readonly totalPasos = ULTIMO_PASO;

  readonly valorPagado = computed(() => this.comprobante()?.valorEnviado ?? 0);

  /** Capacidad informativa: el transporte real se elige por persona. */
  readonly capacidad = computed(() => this.analisis()?.opciones.bus ?? null);

  /** Hay un comprobante cargado pero la inscripción aún no se confirmó. */
  readonly hayBorrador = computed(() => !!this.comprobante() && !this.inscripcion());

  irA(paso: number): void {
    this.paso.set(Math.min(Math.max(paso, PRIMER_PASO), ULTIMO_PASO));
  }

  siguiente(): void {
    this.irA(this.paso() + 1);
  }

  anterior(): void {
    this.irA(this.paso() - 1);
  }

  definirComprobante(comprobante: Comprobante | null): void {
    this.comprobante.set(comprobante);
  }

  definirAnalisis(analisis: AnalisisComprobante | null): void {
    this.analisis.set(analisis);
  }

  definirTransporte(transporte: Transporte): void {
    this.transporte.set(transporte);
  }

  agregarPersona(): void {
    this.personas.update((lista) => [...lista, personaVacia()]);
  }

  quitarPersona(indice: number): void {
    this.personas.update((lista) =>
      lista.length <= 1 ? lista : lista.filter((_, i) => i !== indice),
    );
  }

  actualizarPersona(indice: number, cambios: Partial<PersonaInput>): void {
    this.personas.update((lista) =>
      lista.map((persona, i) => (i === indice ? { ...persona, ...cambios } : persona)),
    );
  }

  definirInscripcion(inscripcion: Inscripcion): void {
    this.inscripcion.set(inscripcion);
  }

  reiniciar(): void {
    this.paso.set(PRIMER_PASO);
    this.comprobante.set(null);
    this.analisis.set(null);
    this.transporte.set(null);
    this.personas.set([personaVacia()]);
    this.inscripcion.set(null);
  }
}
