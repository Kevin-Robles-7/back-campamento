import {
  ChangeDetectionStrategy,
  Component,
  type OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  type AbstractControl,
  FormArray,
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
  type ValidationErrors,
} from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { ApiService, mensajeDeError } from '../../../core/services/api.service';
import { DescarteService } from '../../../core/services/descarte.service';
import type {
  DocumentoConsentimiento,
  PersonaInput,
  TipoDocumento,
  Transporte,
} from '../../../core/models/campamento.models';
import { IconComponent } from '../../../shared/ui/icon.component';
import { FirmaComponent } from '../../../shared/ui/firma.component';
import { PesosPipe } from '../../../shared/pipes/pesos.pipe';

/* ============================================================
   Reglas del «FORMATO DE INSCRIPCIÓN 2025»
   ============================================================ */

/** Tipos de documento con su etiqueta y la letra que usa el formato oficial. */
export const TIPOS_DOCUMENTO: {
  valor: TipoDocumento;
  letra: string;
  etiqueta: string;
  soloMenores: boolean;
  soloMayores: boolean;
  numerico: boolean;
}[] = [
  { valor: 'CC', letra: 'C', etiqueta: 'Cédula de ciudadanía', soloMenores: false, soloMayores: true, numerico: true },
  { valor: 'CE', letra: 'E', etiqueta: 'Cédula de extranjería', soloMenores: false, soloMayores: false, numerico: false },
  { valor: 'TI', letra: 'T', etiqueta: 'Tarjeta de identidad', soloMenores: true, soloMayores: false, numerico: true },
  { valor: 'PA', letra: 'P', etiqueta: 'Pasaporte', soloMenores: false, soloMayores: false, numerico: false },
  { valor: 'RC', letra: 'R', etiqueta: 'Registro civil', soloMenores: true, soloMayores: false, numerico: true },
  { valor: 'NUIP', letra: 'N', etiqueta: 'NUIP', soloMenores: true, soloMayores: false, numerico: true },
];

const PALABRA = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{2,40}$/;
const ALFANUMERICO = /^[A-Za-z0-9]+$/;
const CORREO = /^[\w.!#$%&'*+/=?^`{|}~-]+@[\w-]+(\.[\w-]{2,})+$/;

/** Edad cumplida a una fecha de referencia. */
function edadA(nacimiento: string | null, referencia = new Date()): number | null {
  if (!nacimiento) return null;
  const nace = new Date(`${nacimiento}T12:00:00`);
  if (Number.isNaN(nace.getTime())) return null;
  let edad = referencia.getFullYear() - nace.getFullYear();
  const mes = referencia.getMonth() - nace.getMonth();
  if (mes < 0 || (mes === 0 && referencia.getDate() < nace.getDate())) edad -= 1;
  return edad >= 0 && edad < 120 ? edad : null;
}

/**
 * Validador a nivel de persona: comprueba la coherencia entre documento,
 * fecha de nacimiento y fecha de expedición.
 */
function coherenciaPersona(grupo: AbstractControl): ValidationErrors | null {
  const nacimiento = grupo.get('fechaNacimiento')?.value as string | null;
  const expedicion = grupo.get('fechaExpedicion')?.value as string | null;
  const tipo = grupo.get('tipoDocumento')?.value as TipoDocumento;
  const numero = String(grupo.get('documento')?.value ?? '');
  const errores: ValidationErrors = {};

  if (nacimiento && expedicion) {
    if (new Date(expedicion) < new Date(nacimiento)) {
      errores['expedicionAntesDeNacer'] = true;
    } else if (tipo === 'CC' && (edadA(nacimiento, new Date(`${expedicion}T12:00:00`)) ?? 0) < 18) {
      errores['cedulaAntesDe18'] = true;
    }
  }

  const edad = edadA(nacimiento);
  if (edad !== null) {
    const regla = TIPOS_DOCUMENTO.find((t) => t.valor === tipo);
    if (regla?.soloMayores && edad < 18) errores['documentoDeMayor'] = true;
    if (regla?.soloMenores && edad >= 18) errores['documentoDeMenor'] = true;
  }

  const regla = TIPOS_DOCUMENTO.find((t) => t.valor === tipo);
  if (regla?.numerico && numero && !/^\d+$/.test(numero)) {
    errores['documentoNoNumerico'] = true;
  }

  return Object.keys(errores).length ? errores : null;
}

@Component({
  selector: 'app-paso-personas',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, IconComponent, FirmaComponent, PesosPipe],
  templateUrl: './paso-personas.component.html',
})
export class PasoPersonasComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(ApiService);
  private readonly descarte = inject(DescarteService);

  readonly tarifaBus = input.required<number>();
  readonly tarifaVehiculo = input.required<number>();
  /** Transporte que se propone para las personas nuevas. */
  readonly transportePorDefecto = input<Transporte>('bus');
  readonly valorPagado = input.required<number>();
  readonly abonoMinimo = input.required<number>();
  readonly personasIniciales = input<PersonaInput[]>([]);
  readonly enviando = input<boolean>(false);
  readonly errorServidor = input<string | null>(null);
  readonly fechaEvento = input<string>('');

  readonly atras = output<void>();
  readonly confirmar = output<PersonaInput[]>();

  protected readonly tiposDocumento = TIPOS_DOCUMENTO;
  protected readonly hoy = new Date().toISOString().slice(0, 10);

  protected readonly formulario = this.fb.group({
    personas: this.fb.array<FormGroup>([]),
  });

  private readonly valores = toSignal(this.formulario.valueChanges, {
    initialValue: this.formulario.value,
  });

  protected readonly intentoEnvio = signal(false);

  protected get personas(): FormArray<FormGroup> {
    return this.formulario.controls.personas;
  }

  ngOnInit(): void {
    const iniciales = this.personasIniciales();
    const lista = iniciales.length ? iniciales : [null];
    lista.forEach((persona) => this.personas.push(this.crearGrupo(persona)));
  }

  // ---------------- Dinero ----------------

  /** Tarifa del transporte elegido por esta persona. */
  protected tarifaDe(indice: number): number {
    this.valores();
    return this.personas.at(indice).get('transporte')?.value === 'vehiculo_propio'
      ? this.tarifaVehiculo()
      : this.tarifaBus();
  }

  /** Suma de los cupos de todas las personas, cada uno con su tarifa. */
  protected readonly totalCupos = computed(() => {
    this.valores();
    return this.personas.controls.reduce(
      (suma, _g, i) => suma + this.tarifaDe(i),
      0,
    );
  });

  protected readonly totalAsignado = computed(() => {
    this.valores();
    return this.personas.controls.reduce((suma, grupo, i) => {
      const tipo = grupo.get('tipoPago')?.value;
      const abono = Number(grupo.get('valorAbono')?.value) || 0;
      return suma + (tipo === 'completo' ? this.tarifaDe(i) : abono);
    }, 0);
  });

  /** Personas que viajan en cada modo, para el resumen. */
  protected readonly porTransporte = computed(() => {
    this.valores();
    let bus = 0;
    let vehiculo = 0;
    this.personas.controls.forEach((g) =>
      g.get('transporte')?.value === 'vehiculo_propio' ? vehiculo++ : bus++,
    );
    return { bus, vehiculo };
  });

  protected readonly disponible = computed(() => this.valorPagado() - this.totalAsignado());
  protected readonly excedido = computed(() => this.disponible() < 0);

  /** Queda dinero del comprobante sin asignar a ninguna persona. */
  protected readonly sinAsignar = computed(() => Math.max(0, this.disponible()));

  /**
   * Sugerencia para repartir lo que falta: si alcanza el abono mínimo se
   * puede agregar otra persona; si no, hay que subirle el abono a alguien.
   */
  protected readonly sugerenciaReparto = computed(() => {
    const resto = this.sinAsignar();
    if (resto === 0) return null;
    const pesos = (v: number) => `$${v.toLocaleString('es-CO')}`;

    if (resto >= this.abonoMinimo()) {
      return `Puedes agregar otra persona con un abono de ${pesos(resto)}, o sumárselos al abono de alguien ya registrado.`;
    }
    // Menos del mínimo: no alcanza para inscribir a nadie más.
    return `Son menos del abono mínimo (${pesos(this.abonoMinimo())}), así que no alcanzan para una persona nueva: súmalos al abono de alguien ya registrado.`;
  });

  private disponibleSin(indice: number): number {
    const grupo = this.personas.at(indice);
    const propio =
      grupo.get('tipoPago')?.value === 'completo'
        ? this.tarifaDe(indice)
        : Number(grupo.get('valorAbono')?.value) || 0;
    return this.disponible() + propio;
  }

  protected alcanzaCompleto(indice: number): boolean {
    this.valores();
    return this.disponibleSin(indice) >= this.tarifaDe(indice);
  }

  /** Tope del abono: ni más que su cupo ni más dinero del que hay. */
  protected maximoAbono(indice: number): number {
    this.valores();
    return Math.min(this.tarifaDe(indice), this.disponibleSin(indice));
  }

  /**
   * Solo se puede agregar otra persona si queda al menos el abono mínimo:
   * nadie puede entrar con menos de eso.
   */
  protected readonly puedeAgregar = computed(() => this.sinAsignar() >= this.abonoMinimo());

  /** Suma el dinero sin asignar al abono de una persona ya registrada. */
  protected sumarResto(indice: number): void {
    const resto = this.sinAsignar();
    if (resto <= 0) return;

    const grupo = this.personas.at(indice);
    const actual = Number(grupo.get('valorAbono')?.value) || 0;
    grupo.get('valorAbono')?.setValue(Math.min(this.tarifaDe(indice), actual + resto));
  }

  /** ¿A esta persona se le puede sumar el resto sin pasarse de la tarifa? */
  protected admiteResto(indice: number): boolean {
    this.valores();
    if (this.sinAsignar() <= 0) return false;
    const grupo = this.personas.at(indice);
    if (grupo.get('tipoPago')?.value !== 'abono') return false;
    return (Number(grupo.get('valorAbono')?.value) || 0) < this.tarifaDe(indice);
  }

  // ---------------- Construcción del formulario ----------------

  private crearGrupo(datos: PersonaInput | null): FormGroup {
    const transporte = datos?.transporte ?? this.transportePorDefecto();
    const tarifa = transporte === 'vehiculo_propio' ? this.tarifaVehiculo() : this.tarifaBus();
    const alcanza = this.valorPagado() - this.totalAsignado() >= tarifa;
    const tipoPago = datos?.tipoPago ?? (alcanza ? 'completo' : 'abono');

    const grupo = this.fb.group(
      {
        primerNombre: [datos?.primerNombre ?? '', [Validators.required, Validators.pattern(PALABRA)]],
        primerApellido: [
          datos?.primerApellido ?? '',
          [Validators.required, Validators.pattern(PALABRA)],
        ],
        fechaNacimiento: [datos?.fechaNacimiento ?? '', Validators.required],
        tipoDocumento: [datos?.tipoDocumento ?? 'CC', Validators.required],
        documento: [
          datos?.documento ?? '',
          [
            Validators.required,
            Validators.minLength(4),
            Validators.maxLength(20),
            Validators.pattern(ALFANUMERICO),
          ],
        ],
        fechaExpedicion: [datos?.fechaExpedicion ?? '', Validators.required],
        sexo: [datos?.sexo ?? '', Validators.required],
        telefono: [
          datos?.telefono ?? '',
          [Validators.required, Validators.pattern(/^\d{7,10}$/)],
        ],
        eps: [datos?.eps ?? '', [Validators.required, Validators.minLength(2)]],
        correo: [datos?.correo ?? '', [Validators.pattern(CORREO)]],
        nombreAcompanante: [datos?.nombreAcompanante ?? ''],
        transporte: [transporte, Validators.required],
        tipoPago: [tipoPago, Validators.required],
        valorAbono: [datos?.valorAbono ?? (alcanza ? null : this.abonoMinimo())],
        consentimiento: this.fb.group({
          nombreRepresentante: [datos?.consentimiento?.nombreRepresentante ?? ''],
          tipoDocumentoRep: [datos?.consentimiento?.tipoDocumentoRep ?? 'CC'],
          documentoRepresentante: [datos?.consentimiento?.documentoRepresentante ?? ''],
          congregacion: [datos?.consentimiento?.congregacion ?? ''],
          departamentoMunicipio: [datos?.consentimiento?.departamentoMunicipio ?? ''],
          destino: [datos?.consentimiento?.destino ?? ''],
          telefonoEmergencia: [datos?.consentimiento?.telefonoEmergencia ?? ''],
          acepta: [datos?.consentimiento?.acepta ?? false],
          firmaBase64: [datos?.consentimiento?.firmaBase64 ?? (null as string | null)],
          documentoId: [datos?.consentimiento?.documentoId ?? (null as number | null)],
        }),
      },
      { validators: coherenciaPersona },
    );

    // Al cambiar la fecha de nacimiento se sugiere el tipo de documento.
    grupo.get('fechaNacimiento')?.valueChanges.subscribe((valor) => {
      const edad = edadA(valor ?? null);
      if (edad === null) return;

      const control = grupo.get('tipoDocumento');
      const actual = control?.value as TipoDocumento;

      // Los documentos de extranjero se respetan: no dependen de la edad.
      if (actual === 'CE' || actual === 'PA') return;

      control?.setValue(this.tipoSugerido(edad), { emitEvent: false });
      grupo.updateValueAndValidity?.({ emitEvent: false });
    });

    return grupo;
  }

  /**
   * Documento que corresponde a la edad en Colombia:
   * hasta 6 años registro civil, de 7 a 17 tarjeta de identidad,
   * desde 18 cédula de ciudadanía.
   */
  private tipoSugerido(edad: number): TipoDocumento {
    if (edad >= 18) return 'CC';
    if (edad >= 7) return 'TI';
    return 'RC';
  }

  /** ¿Este tipo de documento está permitido para la edad registrada? */
  protected tipoPermitido(indice: number, tipo: TipoDocumento): boolean {
    this.valores();
    const edad = this.edad(indice);
    if (edad === null) return true;
    const regla = TIPOS_DOCUMENTO.find((t) => t.valor === tipo);
    if (!regla) return true;
    if (regla.soloMayores && edad < 18) return false;
    if (regla.soloMenores && edad >= 18) return false;
    return true;
  }

  protected agregar(): void {
    this.personas.push(this.crearGrupo(null));
  }

  protected quitar(indice: number): void {
    if (this.personas.length <= 1) return;
    const doc = this.documentos().get(indice);
    if (doc) this.descarte.olvidarDocumento(doc.id);
    this.personas.removeAt(indice);
    this.documentos.update((mapa) => {
      const copia = new Map(mapa);
      copia.delete(indice);
      return copia;
    });
  }

  // ---------------- Lógica por persona ----------------

  protected edad(indice: number): number | null {
    this.valores();
    return edadA(this.personas.at(indice).get('fechaNacimiento')?.value ?? null);
  }

  protected esMenor(indice: number): boolean {
    const edad = this.edad(indice);
    return edad !== null && edad < 18;
  }

  protected esAbono(indice: number): boolean {
    this.valores();
    return this.personas.at(indice).get('tipoPago')?.value === 'abono';
  }

  protected valorDe(indice: number): number {
    this.valores();
    const grupo = this.personas.at(indice);
    return grupo.get('tipoPago')?.value === 'completo'
      ? this.tarifaDe(indice)
      : Number(grupo.get('valorAbono')?.value) || 0;
  }

  protected saldoDe(indice: number): number {
    return Math.max(0, this.tarifaDe(indice) - this.valorDe(indice));
  }

  protected firmaCambio(indice: number, firma: string | null): void {
    this.personas.at(indice).get('consentimiento.firmaBase64')?.setValue(firma);
  }

  protected invalido(indice: number, campo: string): boolean {
    const control = this.personas.at(indice).get(campo);
    if (!control) return false;
    return control.invalid && (control.touched || this.intentoEnvio());
  }

  /** Error de coherencia del grupo (fechas y tipo de documento). */
  protected errorGrupo(indice: number, clave: string): boolean {
    this.valores();
    const grupo = this.personas.at(indice);
    return !!grupo.errors?.[clave] && (grupo.touched || this.intentoEnvio());
  }

  // ---------------- Consentimiento: texto que se autocompleta ----------------

  /** Valor de un campo del consentimiento, o un marcador si está vacío. */
  protected campoConsentimiento(indice: number, campo: string, marcador = '__________'): string {
    this.valores();
    const valor = this.personas.at(indice).get(`consentimiento.${campo}`)?.value;
    return valor ? String(valor) : marcador;
  }

  protected nombreMenor(indice: number): string {
    this.valores();
    const grupo = this.personas.at(indice);
    const nombre = `${grupo.get('primerNombre')?.value ?? ''} ${grupo.get('primerApellido')?.value ?? ''}`.trim();
    return nombre || '__________';
  }

  protected documentoMenor(indice: number): string {
    this.valores();
    const grupo = this.personas.at(indice);
    const tipo = TIPOS_DOCUMENTO.find((t) => t.valor === grupo.get('tipoDocumento')?.value);
    const numero = grupo.get('documento')?.value;
    return numero ? `${tipo?.etiqueta ?? ''} ${numero}`.trim() : '__________';
  }

  protected readonly fechaDiligenciamiento = new Date().toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  /** El consentimiento se considera firmado con trazo o con documento adjunto. */
  protected consentimientoFirmado(indice: number): boolean {
    this.valores();
    const c = this.personas.at(indice).get('consentimiento');
    return !!c?.get('firmaBase64')?.value || !!c?.get('documentoId')?.value;
  }

  // ---------------- Documento del consentimiento ----------------

  protected readonly documentos = signal<Map<number, DocumentoConsentimiento>>(new Map());
  protected readonly subiendoDocumento = signal<number | null>(null);
  protected readonly errorDocumento = signal<string | null>(null);

  protected documentoDe(indice: number): DocumentoConsentimiento | undefined {
    return this.documentos().get(indice);
  }

  protected subirDocumento(indice: number, evento: Event): void {
    const input = evento.target as HTMLInputElement;
    const archivo = input.files?.[0];
    input.value = '';
    if (!archivo) return;

    this.errorDocumento.set(null);
    this.subiendoDocumento.set(indice);

    this.api.subirDocumentoConsentimiento(archivo).subscribe({
      next: ({ documento }) => {
        this.subiendoDocumento.set(null);
        this.descarte.registrarDocumento(documento.id);
        this.documentos.update((mapa) => new Map(mapa).set(indice, documento));
        this.personas.at(indice).get('consentimiento.documentoId')?.setValue(documento.id);
      },
      error: (error) => {
        this.subiendoDocumento.set(null);
        this.errorDocumento.set(mensajeDeError(error));
      },
    });
  }

  protected quitarDocumento(indice: number): void {
    const doc = this.documentos().get(indice);
    if (doc) this.descarte.olvidarDocumento(doc.id);
    this.documentos.update((mapa) => {
      const copia = new Map(mapa);
      copia.delete(indice);
      return copia;
    });
    this.personas.at(indice).get('consentimiento.documentoId')?.setValue(null);
  }

  // ---------------- Validación de negocio ----------------

  protected readonly problemas = computed<string[]>(() => {
    this.valores();
    const lista: string[] = [];
    const pesos = (valor: number) => `$${valor.toLocaleString('es-CO')}`;

    this.personas.controls.forEach((grupo, i) => {
      const nombre =
        `${grupo.get('primerNombre')?.value ?? ''} ${grupo.get('primerApellido')?.value ?? ''}`.trim() ||
        `Persona ${i + 1}`;

      if (grupo.get('tipoPago')?.value === 'abono') {
        const abono = Number(grupo.get('valorAbono')?.value) || 0;
        if (abono < this.abonoMinimo()) {
          lista.push(`El abono de ${nombre} debe ser de al menos ${pesos(this.abonoMinimo())}.`);
        }
      }

      if (grupo.errors?.['expedicionAntesDeNacer']) {
        lista.push(`${nombre}: la fecha de expedición es anterior a la de nacimiento.`);
      }
      if (grupo.errors?.['cedulaAntesDe18']) {
        lista.push(`${nombre}: la cédula no pudo expedirse antes de los 18 años.`);
      }
      if (grupo.errors?.['documentoDeMayor']) {
        lista.push(`${nombre} es menor de edad: no puede usar cédula de ciudadanía.`);
      }
      if (grupo.errors?.['documentoDeMenor']) {
        lista.push(`${nombre} es mayor de edad: ese documento es solo para menores.`);
      }
      if (grupo.errors?.['documentoNoNumerico']) {
        lista.push(`${nombre}: ese tipo de documento solo admite números.`);
      }

      if (this.esMenor(i)) {
        const c = grupo.get('consentimiento');
        if (!grupo.get('nombreAcompanante')?.value) {
          lista.push(`${nombre} es menor: indica el nombre del acompañante.`);
        }
        if (!c?.get('nombreRepresentante')?.value || !c?.get('documentoRepresentante')?.value) {
          lista.push(`${nombre}: completa los datos del representante legal.`);
        }
        if (!c?.get('telefonoEmergencia')?.value) {
          lista.push(`${nombre}: falta el teléfono de emergencia.`);
        }
        if (!this.consentimientoFirmado(i)) {
          lista.push(`${nombre}: firma el consentimiento o adjunta el documento firmado.`);
        }
        if (!c?.get('acepta')?.value) {
          lista.push(`${nombre}: falta aceptar el consentimiento.`);
        }
      }
    });

    const documentos = this.personas.controls
      .map((g) => String(g.get('documento')?.value ?? '').trim())
      .filter(Boolean);
    if (new Set(documentos).size !== documentos.length) {
      lista.push('Hay documentos repetidos entre las personas registradas.');
    }

    if (this.excedido()) {
      lista.push(
        `Lo asignado supera el pago por ${pesos(Math.abs(this.disponible()))}. Cambia alguna persona a «abono» o reduce el valor.`,
      );
    } else if (this.sinAsignar() > 0) {
      // No se puede dejar dinero del comprobante sin repartir.
      lista.push(
        `Faltan ${pesos(this.sinAsignar())} por asignar del pago de ${pesos(this.valorPagado())}. ${this.sugerenciaReparto()}`,
      );
    }

    return lista;
  });

  protected readonly camposFaltantes = computed<string[]>(() => {
    this.valores();
    const etiquetas: Record<string, string> = {
      primerNombre: 'primer nombre',
      primerApellido: 'primer apellido',
      documento: 'número de documento',
      fechaExpedicion: 'fecha de expedición',
      telefono: 'teléfono',
      correo: 'correo electrónico',
      fechaNacimiento: 'fecha de nacimiento',
      sexo: 'sexo',
      eps: 'EPS',
    };

    const lista: string[] = [];
    this.personas.controls.forEach((grupo, i) => {
      const faltan = Object.keys(etiquetas).filter((campo) => grupo.get(campo)?.invalid);
      if (faltan.length) {
        const nombre =
          `${grupo.get('primerNombre')?.value ?? ''} ${grupo.get('primerApellido')?.value ?? ''}`.trim() ||
          `Persona ${i + 1}`;
        lista.push(`${nombre}: revisa ${faltan.map((c) => etiquetas[c]).join(', ')}.`);
      }
    });
    return lista;
  });

  protected enviar(): void {
    this.intentoEnvio.set(true);
    this.formulario.markAllAsTouched();

    if (!this.formulario.valid || this.problemas().length) {
      queueMicrotask(() => {
        document
          .querySelector<HTMLElement>('.campo-control.invalido')
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      return;
    }

    const personas: PersonaInput[] = this.personas.controls.map((grupo, i) => {
      const v = grupo.getRawValue() as Record<string, unknown>;
      const menor = this.esMenor(i);
      const c = v['consentimiento'] as Record<string, unknown>;

      return {
        primerNombre: String(v['primerNombre']).trim(),
        primerApellido: String(v['primerApellido']).trim(),
        tipoDocumento: v['tipoDocumento'] as TipoDocumento,
        documento: String(v['documento']).trim(),
        fechaExpedicion: (v['fechaExpedicion'] as string) || null,
        telefono: String(v['telefono']).replace(/[\s-]/g, ''),
        correo: String(v['correo'] ?? '').trim() || null,
        fechaNacimiento: (v['fechaNacimiento'] as string) || null,
        edad: this.edad(i),
        sexo: (v['sexo'] as 'F' | 'M') || null,
        eps: String(v['eps'] ?? '').trim() || null,
        nombreAcompanante: menor ? String(v['nombreAcompanante'] ?? '').trim() || null : null,
        transporte: v['transporte'] as Transporte,
        tipoPago: v['tipoPago'] as PersonaInput['tipoPago'],
        valorAbono: v['tipoPago'] === 'abono' ? Number(v['valorAbono']) || 0 : null,
        consentimiento: menor
          ? {
              nombreRepresentante: String(c['nombreRepresentante']).trim(),
              tipoDocumentoRep: c['tipoDocumentoRep'] as 'CC' | 'PA' | 'PPT',
              documentoRepresentante: String(c['documentoRepresentante']).trim(),
              congregacion: String(c['congregacion'] ?? '').trim() || null,
              departamentoMunicipio: String(c['departamentoMunicipio'] ?? '').trim() || null,
              destino: String(c['destino'] ?? '').trim() || null,
              telefonoEmergencia: String(c['telefonoEmergencia'] ?? '').replace(/[\s-]/g, ''),
              acepta: Boolean(c['acepta']),
              firmaBase64: (c['firmaBase64'] as string | null) ?? null,
              documentoId: (c['documentoId'] as number | null) ?? null,
            }
          : null,
      };
    });

    this.confirmar.emit(personas);
  }
}
