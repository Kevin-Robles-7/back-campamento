import { z } from 'zod';

/* ============================================================
   Reglas de validación
   Alineadas con «FORMATO DE INSCRIPCIÓN 2025.xlsx»:
   - documento sin puntos, guiones ni espacios
   - primer nombre y primer apellido en una sola palabra
   - sexo solo F o M
   - teléfono sin espacios ni guiones

   Todos los mensajes van en español: el frontend los muestra tal cual.
   ============================================================ */

/** Tipos de documento del formato oficial. */
export const TIPOS_DOCUMENTO = ['CC', 'CE', 'TI', 'PA', 'RC', 'NUIP'];

/** Documentos que en Colombia son exclusivamente numéricos. */
const DOCUMENTOS_NUMERICOS = new Set(['CC', 'TI', 'RC', 'NUIP']);

const ALFANUMERICO = /^[A-Za-z0-9]+$/;
const PALABRA = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{2,40}$/;

/**
 * Texto obligatorio con mensaje propio. Trata null, undefined y cadena
 * vacía como «falta este dato», en lugar del genérico "Required".
 */
function textoObligatorio(etiqueta, extra = {}) {
  return z
    .string({
      required_error: `Falta ${etiqueta}`,
      invalid_type_error: `Falta ${etiqueta}`,
    })
    .trim()
    .min(extra.min ?? 1, `Falta ${etiqueta}`)
    .max(extra.max ?? 200, `${etiqueta} es demasiado largo`);
}

/** Texto opcional: null, undefined y '' se normalizan a null. */
function textoOpcional(max = 200) {
  return z
    .union([z.string().trim().max(max), z.null(), z.undefined()])
    .transform((valor) => (valor ? valor : null));
}

const documento = textoObligatorio('el número de documento', { min: 4, max: 20 }).regex(
  ALFANUMERICO,
  'El documento va sin puntos, guiones ni espacios',
);

const telefono = textoObligatorio('el teléfono', { min: 7, max: 20 })
  .transform((valor) => valor.replace(/[\s()-]/g, ''))
  .refine((valor) => /^\d{7,10}$/.test(valor), 'El teléfono debe tener entre 7 y 10 dígitos');

/** Correo opcional: vacío o null se guardan como null. */
const correoOpcional = z
  .union([z.string().trim().toLowerCase(), z.null(), z.undefined()])
  .transform((valor) => (valor ? valor : null))
  .refine(
    (valor) => valor === null || /^[\w.!#$%&'*+/=?^`{|}~-]+@[\w-]+(\.[\w-]{2,})+$/.test(valor),
    'Escribe un correo válido, como nombre@dominio.com',
  );

function fechaObligatoria(etiqueta) {
  return z
    .string({
      required_error: `Falta ${etiqueta}`,
      invalid_type_error: `Falta ${etiqueta}`,
    })
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${etiqueta} tiene un formato inválido`)
    .refine((valor) => !Number.isNaN(new Date(valor).getTime()), `${etiqueta} no existe`)
    .refine(
      (valor) => new Date(`${valor}T12:00:00`).getTime() <= Date.now(),
      `${etiqueta} no puede ser posterior a hoy`,
    );
}

/** Calcula la edad cumplida a una fecha dada. */
function edadA(nacimiento, referencia = new Date()) {
  const nace = new Date(`${nacimiento}T12:00:00`);
  let edad = referencia.getFullYear() - nace.getFullYear();
  const mes = referencia.getMonth() - nace.getMonth();
  if (mes < 0 || (mes === 0 && referencia.getDate() < nace.getDate())) edad -= 1;
  return edad;
}

// ------------------------------------------------------------
//  Consentimiento del menor
// ------------------------------------------------------------

const esquemaConsentimiento = z.object({
  nombreRepresentante: textoObligatorio('el nombre del representante', { min: 5, max: 160 }),
  tipoDocumentoRep: z.enum(['CC', 'PA', 'PPT']).default('CC'),
  documentoRepresentante: documento,
  congregacion: textoOpcional(160),
  departamentoMunicipio: textoOpcional(160),
  destino: textoOpcional(160),
  telefonoEmergencia: telefono,
  acepta: z.literal(true, {
    errorMap: () => ({ message: 'Falta aceptar el consentimiento del menor' }),
  }),
  firmaBase64: z.union([z.string().max(400_000), z.null(), z.undefined()]).transform((v) => v ?? null),
  documentoId: z
    .union([z.coerce.number().int().positive(), z.null(), z.undefined()])
    .transform((v) => v ?? null),
});

// ------------------------------------------------------------
//  Persona
// ------------------------------------------------------------

export const esquemaPersona = z
  .object({
    primerNombre: textoObligatorio('el primer nombre', { min: 2, max: 40 }).regex(
      PALABRA,
      'El primer nombre va en una sola palabra, sin puntos ni guiones',
    ),
    primerApellido: textoObligatorio('el primer apellido', { min: 2, max: 40 }).regex(
      PALABRA,
      'El primer apellido va en una sola palabra, sin puntos ni guiones',
    ),
    tipoDocumento: z.enum(TIPOS_DOCUMENTO, {
      errorMap: () => ({ message: 'Selecciona el tipo de documento' }),
    }),
    documento,
    fechaExpedicion: fechaObligatoria('la fecha de expedición'),
    telefono,
    correo: correoOpcional,
    fechaNacimiento: fechaObligatoria('la fecha de nacimiento'),
    edad: z
      .union([z.coerce.number().int().min(0).max(110), z.null(), z.undefined()])
      .transform((v) => v ?? null),
    sexo: z.enum(['F', 'M'], {
      errorMap: () => ({ message: 'Selecciona el sexo (F o M)' }),
    }),
    eps: textoObligatorio('la EPS', { min: 2, max: 120 }),
    nombreAcompanante: textoOpcional(160),
    /** Cada persona elige su transporte: define su tarifa. */
    transporte: z.enum(['bus', 'vehiculo_propio'], {
      errorMap: () => ({ message: 'Selecciona el transporte de esta persona' }),
    }),
    tipoPago: z.enum(['completo', 'abono'], {
      errorMap: () => ({ message: 'Selecciona el tipo de pago' }),
    }),
    valorAbono: z
      .union([z.coerce.number().int().nonnegative(), z.null(), z.undefined()])
      .transform((v) => v ?? null),
    consentimiento: z
      .union([esquemaConsentimiento, z.null(), z.undefined()])
      .transform((v) => v ?? null),
  })
  // --- Coherencia del documento con su tipo ---
  .refine(
    (p) => !DOCUMENTOS_NUMERICOS.has(p.tipoDocumento) || /^\d+$/.test(p.documento),
    { message: 'Ese tipo de documento solo admite números', path: ['documento'] },
  )
  // --- La expedición nunca puede ser anterior al nacimiento ---
  .refine((p) => new Date(p.fechaExpedicion) >= new Date(p.fechaNacimiento), {
    message: 'La fecha de expedición no puede ser anterior a la fecha de nacimiento',
    path: ['fechaExpedicion'],
  })
  // --- La cédula se expide a partir de los 18 años ---
  .refine(
    (p) => p.tipoDocumento !== 'CC' || edadA(p.fechaNacimiento, new Date(p.fechaExpedicion)) >= 18,
    {
      message: 'La cédula de ciudadanía se expide a partir de los 18 años',
      path: ['fechaExpedicion'],
    },
  )
  // --- Un menor de edad no puede tener cédula de ciudadanía ---
  .refine((p) => p.tipoDocumento !== 'CC' || edadA(p.fechaNacimiento) >= 18, {
    message: 'Un menor de edad no puede registrarse con cédula de ciudadanía',
    path: ['tipoDocumento'],
  })
  // --- Registro civil y NUIP son para menores ---
  .refine((p) => !['RC', 'NUIP'].includes(p.tipoDocumento) || edadA(p.fechaNacimiento) < 18, {
    message: 'El registro civil y el NUIP son documentos de menores de edad',
    path: ['tipoDocumento'],
  })
  // --- Abono con valor ---
  .refine((p) => p.tipoPago === 'completo' || (p.valorAbono ?? 0) > 0, {
    message: 'Indica el valor del abono',
    path: ['valorAbono'],
  })
  // --- Los menores requieren consentimiento y acompañante ---
  .refine((p) => edadA(p.fechaNacimiento) >= 18 || !!p.consentimiento, {
    message: 'Los menores de edad requieren el consentimiento del representante',
    path: ['consentimiento'],
  })
  .refine((p) => edadA(p.fechaNacimiento) >= 18 || !!p.nombreAcompanante, {
    message: 'Indica el nombre del acompañante del menor de edad',
    path: ['nombreAcompanante'],
  });

// ------------------------------------------------------------
//  Inscripción y consultas
// ------------------------------------------------------------

/** El transporte ya no va en la inscripción: lo trae cada persona. */
export const esquemaCrearInscripcion = z.object({
  comprobanteId: z.coerce.number().int().positive(),
  personas: z.array(esquemaPersona).min(1, 'Registra al menos una persona').max(20),
});

/**
 * Consulta por número de documento o por código de inscripción.
 * El código tiene la forma BP-XXXXXXXX.
 */
export const esquemaConsulta = z
  .object({
    documento: z.string().trim().min(4).max(20).regex(ALFANUMERICO).optional(),
    codigo: z
      .string()
      .trim()
      .toUpperCase()
      .min(5)
      .max(20)
      .regex(/^BP-[A-Z0-9]+$/, 'El código tiene la forma BP-XXXXXXXX')
      .optional(),
  })
  .refine((v) => v.documento || v.codigo, {
    message: 'Escribe un número de documento o un código de inscripción',
  });

export const esquemaAbono = z.object({
  inscripcionId: z.coerce.number().int().positive(),
  personaId: z
    .union([z.coerce.number().int().positive(), z.null(), z.undefined()])
    .transform((v) => v ?? null),
  comprobanteId: z.coerce.number().int().positive(),
  /** true = el abono no se reparte: solo cubre a la persona elegida. */
  soloPersona: z
    .union([z.boolean(), z.null(), z.undefined()])
    .transform((v) => v === true),
});

/** Valida el cuerpo y responde 422 con los errores en caso de fallo. */
export function validar(esquema, datos) {
  const resultado = esquema.safeParse(datos);
  if (!resultado.success) {
    const error = new Error('Datos invalidos');
    error.estado = 422;
    error.detalles = resultado.error.issues.map((issue) => ({
      campo: issue.path.join('.'),
      mensaje: issue.message,
    }));
    throw error;
  }
  return resultado.data;
}

export { edadA };
