/* ============================================================
   Modelos compartidos con la API
   ============================================================ */

/** Transporte de una persona. */
export type Transporte = 'bus' | 'vehiculo_propio';

/** El de la inscripción puede ser mixto si sus personas difieren. */
export type TransporteInscripcion = Transporte | 'mixto';
export type TipoPago = 'completo' | 'abono';
/** Tipos del «FORMATO DE INSCRIPCIÓN 2025»: C, E, T, P, R, N. */
export type TipoDocumento = 'CC' | 'CE' | 'TI' | 'PA' | 'RC' | 'NUIP';
export type TipoDocumentoRep = 'CC' | 'PA' | 'PPT';
export type EstadoInscripcion = 'borrador' | 'activa' | 'completada' | 'anulada';

export interface Configuracion {
  tarifaBus: number;
  tarifaVehiculoPropio: number;
  abonoMinimo: number;
  llavePago: string;
  correoDestino: string;
  llavesValidas: string[];
  validarLlave: boolean;
  fechaEvento: string;
  lugarEvento: string;
  whatsapp: string;
}

export interface Comprobante {
  id: number;
  numeroTransaccion: string | null;
  valorEnviado: number;
  bancoOrigen: string | null;
  bancoDestino: string | null;
  llaveDestino: string | null;
  fechaTransaccion: string | null;
  archivoNombre: string | null;
  archivoUrl: string | null;
  origenDatos: 'ia' | 'ocr' | 'manual';
  verificado: boolean;
}

/** Motivo por el que el servidor rechazó un comprobante. */
export interface MotivoRechazo {
  codigo:
    | 'valor_ilegible'
    | 'valor_insuficiente'
    | 'transaccion_ilegible'
    | 'transaccion_usada'
    | 'llave_ajena'
    | 'llave_ilegible'
    | 'fecha_ilegible'
    | 'fecha_futura'
    | 'fecha_vencida';
  mensaje: string;
}

/**
 * Veredicto del servidor sobre un comprobante. El cliente no puede alterar
 * los datos: solo los muestra.
 */
export interface RespuestaComprobante {
  comprobante: Comprobante;
  aceptado: boolean;
  motivos: MotivoRechazo[];
  llavesValidas: string[];
  origen: 'ia' | 'ocr' | 'manual';
  confianza: number | null;
}

export interface CapacidadTransporte {
  transporte: Transporte;
  tarifa: number;
  abonoMinimo: number;
  valorEnviado: number;
  /** Reparto pagando cupos completos primero. */
  personasCompletas: number;
  restante: number;
  personasConAbono: number;
  /** Reparto dando a todos el abono mínimo. */
  maximoConAbono: number;
  sobranteAbonos: number;
  /** Techo de personas registrables con este pago. */
  maximoPersonas: number;
}

export interface AnalisisComprobante {
  comprobante: Comprobante;
  opciones: {
    bus: CapacidadTransporte;
    vehiculoPropio: CapacidadTransporte;
  };
}

/** Documento de soporte (PDF o Word) subido para el consentimiento. */
export interface DocumentoConsentimiento {
  id: number;
  nombre: string;
  mime: string;
  tamanoBytes: number;
  url: string;
}

export interface ConsentimientoMenor {
  nombreRepresentante: string;
  tipoDocumentoRep: TipoDocumentoRep;
  documentoRepresentante: string;
  congregacion: string | null;
  destino: string | null;
  departamentoMunicipio: string | null;
  telefonoEmergencia: string;
  acepta: boolean;
  firmaBase64: string | null;
  documentoId: number | null;
}

export interface PersonaInput {
  primerNombre: string;
  primerApellido: string;
  tipoDocumento: TipoDocumento;
  documento: string;
  fechaExpedicion: string | null;
  telefono: string;
  correo: string | null;
  fechaNacimiento: string | null;
  edad: number | null;
  sexo: 'F' | 'M' | null;
  eps: string | null;
  nombreAcompanante: string | null;
  /** Cada persona viaja como quiera: define su tarifa. */
  transporte: Transporte;
  tipoPago: TipoPago;
  valorAbono: number | null;
  consentimiento: ConsentimientoMenor | null;
}

export interface Persona {
  id: number;
  primerNombre: string;
  primerApellido: string;
  nombreCompleto: string;
  tipoDocumento: TipoDocumento;
  documento: string;
  fechaExpedicion: string | null;
  nombreAcompanante: string | null;
  transporte: Transporte;
  telefono: string;
  correo: string | null;
  edad: number | null;
  sexo: 'F' | 'M' | null;
  eps: string | null;
  tipoPago: TipoPago;
  valorAsignado: number;
  valorPagado: number;
  saldoPendiente: number;
  estado: 'abono' | 'completo';
}

export interface Pago {
  id: number;
  personaId: number | null;
  valor: number;
  tipo: 'inicial' | 'abono';
  fecha: string;
}

export interface Inscripcion {
  id: number;
  codigo: string;
  transporte: TransporteInscripcion;
  valorPorPersona: number;
  totalAPagar: number;
  totalPagado: number;
  saldoPendiente: number;
  estado: EstadoInscripcion;
  creadaEn: string;
  personas: Persona[];
  comprobantes: Comprobante[];
  pagos: Pago[];
}

export interface ErrorApi {
  error: string;
  detalles?: { campo: string; mensaje: string }[];
}
