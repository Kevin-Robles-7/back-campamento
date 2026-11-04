import { insert, query, queryOne, withTransaction } from '../db.js';
import * as almacenamiento from './almacenamiento.service.js';
import {
  analizarCapacidad,
  obtenerConfiguracion,
  tarifaDe,
  validarFechaComprobante,
  validarLlaveDestino,
} from './configuracion.service.js';

export class ErrorNegocio extends Error {
  constructor(mensaje, estado = 400, detalles = null) {
    super(mensaje);
    this.estado = estado;
    this.detalles = detalles;
  }
}

function generarCodigo() {
  const aleatorio = Math.floor(Math.random() * 46_656)
    .toString(36)
    .toUpperCase()
    .padStart(3, '0');
  return `BP-${Date.now().toString(36).toUpperCase().slice(-5)}${aleatorio}`;
}

function edadDesde(fechaNacimiento) {
  if (!fechaNacimiento) return null;
  const nacimiento = new Date(fechaNacimiento);
  if (Number.isNaN(nacimiento.getTime())) return null;
  const hoy = new Date();
  let edad = hoy.getFullYear() - nacimiento.getFullYear();
  const mes = hoy.getMonth() - nacimiento.getMonth();
  if (mes < 0 || (mes === 0 && hoy.getDate() < nacimiento.getDate())) edad -= 1;
  return edad >= 0 && edad < 120 ? edad : null;
}

// ------------------------------------------------------------
//  Comprobantes
// ------------------------------------------------------------

/** MySQL no acepta `undefined` como parametro: todo se normaliza a null. */
function normalizarComprobante(datos) {
  return {
    numeroTransaccion: datos.numeroTransaccion ?? null,
    valorEnviado: Number(datos.valorEnviado) || 0,
    bancoOrigen: datos.bancoOrigen ?? null,
    bancoDestino: datos.bancoDestino ?? null,
    llaveDestino: datos.llaveDestino ?? null,
    fechaTransaccion: datos.fechaTransaccion ? new Date(datos.fechaTransaccion) : null,
  };
}

export async function guardarComprobante(entrada, archivo, origen, datosCrudos) {
  const datos = normalizarComprobante(entrada);
  // El archivo va al almacenamiento externo: en Render el disco es efímero.
  const guardado = archivo ? await almacenamiento.guardar(archivo) : null;

  return insert(
    `INSERT INTO comprobantes
       (numero_transaccion, valor_enviado, banco_origen, banco_destino, llave_destino,
        fecha_transaccion, archivo_nombre, archivo_ruta, archivo_mime, origen_datos, datos_crudos)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [
      datos.numeroTransaccion,
      datos.valorEnviado,
      datos.bancoOrigen,
      datos.bancoDestino,
      datos.llaveDestino,
      datos.fechaTransaccion,
      guardado?.nombre ?? null,
      guardado?.clave ?? null,
      guardado?.mime ?? null,
      origen,
      datosCrudos ? JSON.stringify(datosCrudos) : null,
    ],
  );
}

/**
 * Verifica un comprobante recién analizado. Todo se decide en el servidor a
 * partir de lo que se leyó de la imagen: el usuario no puede editar los datos.
 *
 * @returns {{ aceptado: boolean, motivos: {codigo: string, mensaje: string}[] }}
 */
export async function verificarComprobante(id) {
  const cfg = await obtenerConfiguracion();
  const comprobante = await queryOne('SELECT * FROM comprobantes WHERE id = $1', [id]);
  if (!comprobante) throw new ErrorNegocio('Comprobante no encontrado.', 404);

  const motivos = [];
  const pesos = (valor) => `$${Number(valor).toLocaleString('es-CO')}`;

  // 1) ¿Se pudo leer el valor?
  const valor = Number(comprobante.valor_enviado) || 0;
  if (!valor) {
    motivos.push({
      codigo: 'valor_ilegible',
      mensaje: 'No pudimos leer el valor del pago en la imagen.',
    });
  } else if (valor < cfg.abonoMinimo) {
    motivos.push({
      codigo: 'valor_insuficiente',
      mensaje: `El pago es de ${pesos(valor)} y el mínimo permitido es ${pesos(cfg.abonoMinimo)}.`,
    });
  }

  // 2) ¿Se pudo leer el número de transacción?
  if (!comprobante.numero_transaccion) {
    motivos.push({
      codigo: 'transaccion_ilegible',
      mensaje: 'No pudimos leer el número de transacción en la imagen.',
    });
  } else {
    // Solo se rechaza si esa transacción ya pagó otra inscripción.
    const usado = await queryOne(
      `SELECT c.id, i.codigo
         FROM comprobantes c
         JOIN inscripciones i ON i.id = c.inscripcion_id
        WHERE c.numero_transaccion = $1 AND c.id <> $2
        LIMIT 1`,
      [comprobante.numero_transaccion, id],
    );
    if (usado) {
      motivos.push({
        codigo: 'transaccion_usada',
        mensaje: `La transacción ${comprobante.numero_transaccion} ya fue usada en la inscripción ${usado.codigo}.`,
      });
    }
  }

  // 3) ¿El dinero llegó a la cuenta del campamento?
  const llave = await validarLlaveDestino(comprobante.llave_destino);
  if (!llave.valida) {
    motivos.push({
      codigo: comprobante.llave_destino ? 'llave_ajena' : 'llave_ilegible',
      mensaje: comprobante.llave_destino
        ? `El pago fue enviado a «${comprobante.llave_destino}», que no es la cuenta del campamento.`
        : 'No pudimos leer la cuenta destino del pago en la imagen.',
    });
  }

  // 4) ¿La fecha es legible y está vigente?
  const fecha = await validarFechaComprobante(comprobante.fecha_transaccion);
  if (!fecha.valida) {
    const mensajes = {
      fecha_ilegible: 'No pudimos leer la fecha de la transacción en la imagen.',
      fecha_futura: 'La fecha del comprobante es posterior a hoy.',
      fecha_vencida: `El comprobante tiene más de ${fecha.diasVigencia} días. Solo aceptamos pagos recientes.`,
    };
    motivos.push({
      codigo: fecha.codigo,
      mensaje: mensajes[fecha.codigo] ?? 'La fecha del comprobante no es válida.',
    });
  }

  const aceptado = motivos.length === 0;
  await query('UPDATE comprobantes SET verificado = $1 WHERE id = $2', [aceptado, id]);

  return {
    aceptado,
    motivos,
    llavesValidas: llave.llavesValidas,
    comprobante: await queryOne('SELECT * FROM comprobantes WHERE id = $1', [id]),
  };
}

// ------------------------------------------------------------
//  Documentos de soporte del consentimiento (PDF / Word)
// ------------------------------------------------------------

export async function guardarDocumentoConsentimiento(archivo) {
  const guardado = await almacenamiento.guardar(archivo);

  const id = await insert(
    `INSERT INTO documentos_consentimiento
       (archivo_nombre, archivo_ruta, archivo_mime, tamano_bytes)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [guardado.nombre, guardado.clave, guardado.mime, guardado.tamanoBytes],
  );

  return {
    id,
    nombre: guardado.nombre,
    mime: guardado.mime,
    tamanoBytes: guardado.tamanoBytes,
    url: await almacenamiento.urlDe(guardado.clave),
  };
}

// ------------------------------------------------------------
//  Inscripciones
// ------------------------------------------------------------

/**
 * Crea la inscripcion con su comprobante y las personas indicadas.
 *
 * El transporte es POR PERSONA: en una misma inscripcion unos pueden ir en bus
 * y otros en vehiculo propio, y cada uno paga la tarifa que le corresponde.
 *
 * Regla central: todo el dinero del comprobante debe quedar repartido.
 */
export async function crearInscripcion({ comprobanteId, personas }) {
  const cfg = await obtenerConfiguracion();
  const tarifas = {
    bus: cfg.tarifaBus,
    vehiculo_propio: cfg.tarifaVehiculoPropio,
  };

  const comprobante = await queryOne('SELECT * FROM comprobantes WHERE id = $1', [comprobanteId]);
  if (!comprobante) throw new ErrorNegocio('Comprobante no encontrado.', 404);
  if (comprobante.inscripcion_id) {
    throw new ErrorNegocio('Este comprobante ya fue usado en otra inscripcion.', 409);
  }

  const valorPagado = Number(comprobante.valor_enviado) || 0;
  if (valorPagado < cfg.abonoMinimo) {
    throw new ErrorNegocio(
      `El valor del comprobante debe ser de al menos $${cfg.abonoMinimo.toLocaleString('es-CO')}.`,
      422,
    );
  }

  // Doble verificación: solo se aceptan comprobantes ya validados por el servidor.
  if (!comprobante.verificado) {
    throw new ErrorNegocio(
      'Este comprobante no pasó la verificación automática. Sube una imagen más clara.',
      422,
    );
  }

  const llave = await validarLlaveDestino(comprobante.llave_destino);
  if (!llave.valida) {
    throw new ErrorNegocio(
      `El pago no fue enviado a una cuenta del campamento. Debe enviarse a: ${llave.llavesValidas.join(' o ')}.`,
      422,
    );
  }

  if (!personas?.length) throw new ErrorNegocio('Debes registrar al menos una persona.', 422);

  // 1) Validaciones de identidad: dan mensajes mas utiles que las de dinero.
  const documentos = personas.map((p) => String(p.documento ?? '').trim());
  if (new Set(documentos).size !== documentos.length) {
    throw new ErrorNegocio('Hay documentos repetidos en la lista de personas.', 422);
  }

  const yaInscritos = await query(
    `SELECT documento FROM personas WHERE documento IN (${documentos
      .map((_d, i) => `$${i + 1}`)
      .join(', ')})`,
    documentos,
  );
  if (yaInscritos.length) {
    throw new ErrorNegocio(
      `Ya existe una inscripcion con el documento ${yaInscritos.map((p) => p.documento).join(', ')}.`,
      409,
    );
  }

  // 2) Reparte el dinero. Cada persona paga la tarifa de SU transporte.
  let disponible = valorPagado;
  const preparadas = personas.map((persona) => {
    const transportePersona = persona.transporte ?? 'bus';
    const tarifa = tarifas[transportePersona];
    const esCompleto = persona.tipoPago === 'completo';
    const solicitado = esCompleto ? tarifa : Number(persona.valorAbono) || 0;
    const nombre = `${persona.primerNombre} ${persona.primerApellido}`;

    if (!esCompleto && solicitado < cfg.abonoMinimo) {
      throw new ErrorNegocio(
        `El abono de ${nombre} debe ser de al menos $${cfg.abonoMinimo.toLocaleString('es-CO')}.`,
        422,
      );
    }
    if (solicitado > tarifa) {
      throw new ErrorNegocio(
        `El abono de ${nombre} ($${solicitado.toLocaleString('es-CO')}) supera su cupo de $${tarifa.toLocaleString('es-CO')}.`,
        422,
      );
    }
    if (solicitado > disponible) {
      throw new ErrorNegocio(
        `El pago no alcanza para cubrir a ${nombre}: se necesitan $${solicitado.toLocaleString('es-CO')} y quedan $${disponible.toLocaleString('es-CO')}.`,
        422,
      );
    }
    disponible -= solicitado;

    const edad = persona.edad ?? edadDesde(persona.fechaNacimiento);
    return {
      ...persona,
      transporte: transportePersona,
      tarifa,
      edad,
      valorPagado: solicitado,
      saldoPendiente: Math.max(0, tarifa - solicitado),
      estado: solicitado >= tarifa ? 'completo' : 'abono',
    };
  });

  const totalAPagar = preparadas.reduce((suma, p) => suma + p.tarifa, 0);
  const totalAsignado = preparadas.reduce((suma, p) => suma + p.valorPagado, 0);

  // El transporte de la inscripcion es informativo: 'mixto' si no coinciden.
  const transportes = new Set(preparadas.map((p) => p.transporte));
  const transporte = transportes.size === 1 ? [...transportes][0] : 'mixto';
  const valorPorPersona = transportes.size === 1 ? preparadas[0].tarifa : 0;

  // Regla clave: todo el dinero del comprobante debe quedar repartido, ya sea
  // en una sola persona o entre varias. No se admite dinero sin asignar.
  if (totalAsignado !== valorPagado) {
    const sinAsignar = valorPagado - totalAsignado;
    throw new ErrorNegocio(
      `Quedan $${sinAsignar.toLocaleString('es-CO')} sin asignar del pago de $${valorPagado.toLocaleString('es-CO')}. Reparte el monto completo entre las personas.`,
      422,
      { valorPagado, totalAsignado, sinAsignar },
    );
  }

  // La lectura final se hace despues del commit para que los datos ya esten visibles.
  const inscripcionId = await withTransaction(async (cx) => {
    const codigo = generarCodigo();
    const inscripcionId = await cx.insert(
      `INSERT INTO inscripciones
         (codigo, transporte, valor_por_persona, total_a_pagar, total_pagado, saldo_pendiente, estado, paso_actual)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 5)
       RETURNING id`,
      [
        codigo,
        transporte,
        valorPorPersona,
        totalAPagar,
        totalAsignado,
        Math.max(0, totalAPagar - totalAsignado),
        totalAsignado >= totalAPagar ? 'completada' : 'activa',
      ],
    );

    await cx.query('UPDATE comprobantes SET inscripcion_id = $1 WHERE id = $2', [
      inscripcionId,
      comprobanteId,
    ]);

    for (const persona of preparadas) {
      const nombreCompleto = `${persona.primerNombre} ${persona.primerApellido}`.trim();
      const personaId = await cx.insert(
        `INSERT INTO personas
           (inscripcion_id, primer_nombre, primer_apellido, nombre_completo, tipo_documento,
            documento, fecha_expedicion, telefono, correo, fecha_nacimiento, edad, sexo, eps,
            nombre_acompanante, transporte, tipo_pago, valor_asignado, valor_pagado,
            saldo_pendiente, estado)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
         RETURNING id`,
        [
          inscripcionId,
          persona.primerNombre,
          persona.primerApellido,
          nombreCompleto,
          persona.tipoDocumento ?? 'CC',
          persona.documento,
          persona.fechaExpedicion ?? null,
          persona.telefono,
          persona.correo ?? null,
          persona.fechaNacimiento ?? null,
          persona.edad ?? null,
          persona.sexo ?? null,
          persona.eps ?? null,
          persona.nombreAcompanante ?? null,
          persona.transporte,
          persona.tipoPago,
          persona.tarifa,
          persona.valorPagado,
          persona.saldoPendiente,
          persona.estado,
        ],
      );

      await cx.query(
        `INSERT INTO pagos (inscripcion_id, persona_id, comprobante_id, valor, tipo)
         VALUES ($1, $2, $3, $4, 'inicial')`,
        [inscripcionId, personaId, comprobanteId, persona.valorPagado],
      );

      if (persona.consentimiento) {
        const c = persona.consentimiento;
        await cx.query(
          `INSERT INTO consentimientos_menores
             (persona_id, documento_id, departamento_municipio, nombre_representante,
              tipo_documento_rep, documento_representante, congregacion, destino,
              telefono_emergencia, acepta_consentimiento, firma_base64)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            personaId,
            c.documentoId ?? null,
            c.departamentoMunicipio ?? null,
            c.nombreRepresentante,
            c.tipoDocumentoRep ?? 'CC',
            c.documentoRepresentante,
            c.congregacion ?? null,
            c.destino ?? null,
            c.telefonoEmergencia,
            c.acepta === true,
            c.firmaBase64 ?? null,
          ],
        );
      }
    }

    return inscripcionId;
  });

  return obtenerInscripcion(inscripcionId);
}

export async function obtenerInscripcion(id) {
  const inscripcion = await queryOne('SELECT * FROM inscripciones WHERE id = $1', [id]);
  if (!inscripcion) return null;

  const [personas, comprobantes, pagos] = await Promise.all([
    query('SELECT * FROM personas WHERE inscripcion_id = $1 ORDER BY id', [id]),
    query('SELECT * FROM comprobantes WHERE inscripcion_id = $1 ORDER BY id', [id]),
    query('SELECT * FROM pagos WHERE inscripcion_id = $1 ORDER BY id', [id]),
  ]);

  return mapearInscripcion(inscripcion, personas, comprobantes, pagos);
}

/**
 * Busca una inscripción por el documento de cualquiera de sus personas
 * o por el código que se entrega al confirmar (BP-XXXXXXXX).
 */
export async function consultarInscripcion({ documento, codigo }) {
  let inscripcionId = null;

  if (codigo) {
    const inscripcion = await queryOne('SELECT id FROM inscripciones WHERE codigo = $1', [codigo]);
    inscripcionId = inscripcion?.id ?? null;
  }

  if (!inscripcionId && documento) {
    const persona = await queryOne('SELECT inscripcion_id FROM personas WHERE documento = $1', [
      documento,
    ]);
    inscripcionId = persona?.inscripcion_id ?? null;
  }

  if (!inscripcionId) return null;
  return obtenerInscripcion(inscripcionId);
}

/**
 * Registra un abono sobre una inscripcion existente.
 *
 * `personaId`   a quien se aplica primero el dinero.
 * `soloPersona` si es true el pago NO se reparte: cubre como maximo el saldo
 *               de esa persona y el excedente queda como saldo a favor de la
 *               inscripcion. Si es false el excedente cierra a los demas.
 */
export async function registrarAbono({ inscripcionId, personaId, comprobanteId, soloPersona }) {
  const cfg = await obtenerConfiguracion();
  const inscripcion = await queryOne('SELECT * FROM inscripciones WHERE id = $1', [inscripcionId]);
  if (!inscripcion) throw new ErrorNegocio('Inscripcion no encontrada.', 404);

  const comprobante = await queryOne('SELECT * FROM comprobantes WHERE id = $1', [comprobanteId]);
  if (!comprobante) throw new ErrorNegocio('Comprobante no encontrado.', 404);
  if (comprobante.inscripcion_id && comprobante.inscripcion_id !== Number(inscripcionId)) {
    throw new ErrorNegocio('Este comprobante ya fue usado en otra inscripcion.', 409);
  }
  if (!comprobante.verificado) {
    throw new ErrorNegocio(
      'Este comprobante no pasó la verificación automática. Sube una imagen más clara.',
      422,
    );
  }

  const llave = await validarLlaveDestino(comprobante.llave_destino);
  if (!llave.valida) {
    throw new ErrorNegocio(
      `El pago no fue enviado a una cuenta del campamento. Debe enviarse a: ${llave.llavesValidas.join(' o ')}.`,
      422,
    );
  }

  const valor = Number(comprobante.valor_enviado) || 0;
  if (valor < cfg.abonoMinimo) {
    throw new ErrorNegocio(
      `El abono debe ser de al menos $${cfg.abonoMinimo.toLocaleString('es-CO')}.`,
      422,
    );
  }

  // Todo el dinero debe quedar aplicado: no se aceptan pagos que excedan
  // lo que realmente se puede cubrir.
  const objetivoPrevio = personaId
    ? await queryOne('SELECT saldo_pendiente, es_cortesia FROM personas WHERE id = $1 AND inscripcion_id = $2', [
        personaId,
        inscripcionId,
      ])
    : null;

  if (personaId && !objetivoPrevio) {
    throw new ErrorNegocio('La persona no pertenece a esta inscripcion.', 422);
  }

  if (objetivoPrevio?.es_cortesia) {
    throw new ErrorNegocio('Esta persona tiene una inscripción de cortesía y no admite cobros.', 422);
  }

  const maximoAplicable = soloPersona && objetivoPrevio
    ? Number(objetivoPrevio.saldo_pendiente) || 0
    : Number(inscripcion.saldo_pendiente) || 0;

  if (maximoAplicable <= 0) {
    throw new ErrorNegocio('Esta inscripcion ya no tiene saldo pendiente.', 422);
  }

  if (valor > maximoAplicable) {
    throw new ErrorNegocio(
      soloPersona
        ? `El pago de $${valor.toLocaleString('es-CO')} excede el saldo de esa persona ($${maximoAplicable.toLocaleString('es-CO')}). Cambia a «repartir entre los demas» o paga el valor exacto.`
        : `El pago de $${valor.toLocaleString('es-CO')} excede el saldo pendiente de la inscripcion ($${maximoAplicable.toLocaleString('es-CO')}).`,
      422,
      { maximoAplicable, valor },
    );
  }

  await withTransaction(async (cx) => {
    await cx.query('UPDATE comprobantes SET inscripcion_id = $1 WHERE id = $2', [
      inscripcionId,
      comprobanteId,
    ]);

    // Todas las lecturas usan la conexion de la transaccion.
    let objetivo = null;
    if (personaId) {
      objetivo = await cx.queryOne(
        'SELECT * FROM personas WHERE id = $1 AND inscripcion_id = $2',
        [personaId, inscripcionId],
      );
      if (!objetivo) throw new ErrorNegocio('La persona no pertenece a esta inscripcion.', 422);
      if (objetivo.es_cortesia) {
        throw new ErrorNegocio('Esta persona tiene una inscripción de cortesía y no admite cobros.', 422);
      }
    } else {
      objetivo = await cx.queryOne(
        `SELECT * FROM personas
          WHERE inscripcion_id = $1 AND saldo_pendiente > 0 AND NOT es_cortesia
          ORDER BY saldo_pendiente DESC LIMIT 1`,
        [inscripcionId],
      );
    }

    await cx.query(
      `INSERT INTO pagos (inscripcion_id, persona_id, comprobante_id, valor, tipo)
       VALUES ($1, $2, $3, $4, 'abono')`,
      [inscripcionId, objetivo?.id ?? null, comprobanteId, valor],
    );

    // Distribuye el abono empezando por la persona objetivo.
    let restante = valor;
    const todas = await cx.query(
      `SELECT * FROM personas WHERE inscripcion_id = $1 AND NOT es_cortesia ORDER BY (id = $2) DESC, id`,
      [inscripcionId, objetivo?.id ?? 0],
    );

    // Con `soloPersona` el reparto se limita a la persona elegida.
    const personas = soloPersona && objetivo ? todas.filter((p) => p.id === objetivo.id) : todas;

    for (const persona of personas) {
      if (restante <= 0) break;
      const pendiente = Number(persona.saldo_pendiente) || 0;
      if (pendiente <= 0) continue;
      const aplicado = Math.min(pendiente, restante);
      restante -= aplicado;
      const nuevoPagado = Number(persona.valor_pagado) + aplicado;
      const nuevoSaldo = pendiente - aplicado;
      await cx.query(
        `UPDATE personas
            SET valor_pagado = $1, saldo_pendiente = $2, estado = $3, tipo_pago = $4
          WHERE id = $5`,
        [
          nuevoPagado,
          nuevoSaldo,
          nuevoSaldo === 0 ? 'completo' : 'abono',
          nuevoSaldo === 0 ? 'completo' : 'abono',
          persona.id,
        ],
      );
    }

    const totales = await cx.queryOne(
      `SELECT COALESCE(SUM(valor_pagado) FILTER (WHERE NOT es_cortesia), 0) AS pagado,
              COALESCE(SUM(saldo_pendiente) FILTER (WHERE NOT es_cortesia), 0) AS pendiente
         FROM personas WHERE inscripcion_id = $1`,
      [inscripcionId],
    );

    // Con las validaciones previas `restante` siempre debe quedar en 0:
    // no existe dinero sin aplicar. Se deja la suma por seguridad contable.
    const totalPagado = Number(totales.pagado) + restante;
    const saldoPendiente = Number(totales.pendiente);

    await cx.query(
      `UPDATE inscripciones
          SET total_pagado = $1, saldo_pendiente = $2, estado = $3
        WHERE id = $4`,
      [totalPagado, saldoPendiente, saldoPendiente === 0 ? 'completada' : 'activa', inscripcionId],
    );
  });

  return obtenerInscripcion(inscripcionId);
}

// ------------------------------------------------------------
//  Reparto entre inscripciones distintas
// ------------------------------------------------------------

const aPesos = (valor) => `$${Number(valor).toLocaleString('es-CO')}`;

/**
 * Busca una persona por documento en TODAS las inscripciones.
 * `personas.documento` es UNIQUE en la base, asi que devuelve como maximo
 * una persona: su registro existente, nunca un duplicado.
 */
export async function buscarPersonaPorDocumento(documento) {
  const persona = await queryOne(
    `SELECT p.*, i.codigo AS inscripcion_codigo, i.estado AS inscripcion_estado,
            i.saldo_pendiente AS inscripcion_saldo
       FROM personas p
       JOIN inscripciones i ON i.id = p.inscripcion_id
      WHERE p.documento = $1`,
    [documento],
  );
  if (!persona) return null;
  return mapearPersonaReparto(persona);
}

function mapearPersonaReparto(p) {
  return {
    id: p.id,
    inscripcionId: p.inscripcion_id,
    inscripcionCodigo: p.inscripcion_codigo,
    inscripcionEstado: p.inscripcion_estado,
    inscripcionSaldo: Number(p.inscripcion_saldo),
    nombreCompleto: p.nombre_completo,
    tipoDocumento: p.tipo_documento,
    documento: p.documento,
    telefono: p.telefono,
    valorAsignado: Number(p.valor_asignado),
    valorPagado: Number(p.valor_pagado),
    saldoPendiente: Number(p.saldo_pendiente),
    esCortesia: Boolean(p.es_cortesia),
    estado: p.estado,
  };
}

/**
 * Reparte el dinero de un comprobante entre personas de CUALQUIER
 * inscripcion, indicando exactamente cuanto recibe cada una.
 *
 * Reglas duras:
 *  - La suma de las asignaciones debe ser EXACTAMENTE el valor del
 *    comprobante: no queda dinero sin asignar ni de mas.
 *  - Ninguna asignacion supera el saldo pendiente de su persona.
 *  - Las personas conservan su inscripcion original y su codigo: solo se
 *    aplica dinero sobre su saldo. Cada asignacion genera su propia fila
 *    en `pagos` vinculada a la persona, su inscripcion y el comprobante.
 *  - El comprobante queda marcado como usado y ya no se puede reutilizar.
 *
 * Todo dentro de una transaccion: si algo falla, no se guarda nada.
 */
export async function registrarReparto({ comprobanteId, asignaciones }) {
  const cfg = await obtenerConfiguracion();

  const comprobante = await queryOne('SELECT * FROM comprobantes WHERE id = $1', [comprobanteId]);
  if (!comprobante) throw new ErrorNegocio('Comprobante no encontrado.', 404);
  if (comprobante.inscripcion_id) {
    throw new ErrorNegocio('Este comprobante ya fue usado en otra inscripcion.', 409);
  }
  if (!comprobante.verificado) {
    throw new ErrorNegocio(
      'Este comprobante no pasó la verificación automática. Sube una imagen más clara.',
      422,
    );
  }

  const llave = await validarLlaveDestino(comprobante.llave_destino);
  if (!llave.valida) {
    throw new ErrorNegocio(
      `El pago no fue enviado a una cuenta del campamento. Debe enviarse a: ${llave.llavesValidas.join(' o ')}.`,
      422,
    );
  }

  const valor = Number(comprobante.valor_enviado) || 0;
  if (valor < cfg.abonoMinimo) {
    throw new ErrorNegocio(
      `El abono debe ser de al menos ${aPesos(cfg.abonoMinimo)}.`,
      422,
    );
  }

  // Una persona aparece una sola vez en la distribucion.
  const idsUnicos = new Set(asignaciones.map((a) => a.personaId));
  if (idsUnicos.size !== asignaciones.length) {
    throw new ErrorNegocio(
      'Hay personas repetidas en la distribucion. El dinero de una persona se asigna en una sola linea.',
      422,
    );
  }

  // El dinero recibido y el dinero asignado deben cuadrar exactamente:
  // ni faltante ni sobrante.
  const asignado = asignaciones.reduce((suma, a) => suma + (Number(a.valor) || 0), 0);
  if (asignado !== valor) {
    const diferencia = valor - asignado;
    throw new ErrorNegocio(
      diferencia > 0
        ? `No puedes finalizar el proceso. Recibiste ${aPesos(valor)} y asignaste ${aPesos(asignado)}: te faltan ${aPesos(diferencia)} por asignar.`
        : `Las asignaciones suman ${aPesos(asignado)} y el comprobante es de ${aPesos(valor)}: no puedes asignar mas dinero del recibido.`,
      422,
      { recibido: valor, asignado, diferencia },
    );
  }

  await withTransaction(async (cx) => {
    // Bloquea el comprobante: dos repartos concurrentes con el mismo
    // comprobante se serializan aqui, y el segundo ve que ya fue usado.
    const bloqueado = await cx.queryOne(
      'SELECT * FROM comprobantes WHERE id = $1 FOR UPDATE',
      [comprobanteId],
    );
    if (!bloqueado) throw new ErrorNegocio('Comprobante no encontrado.', 404);
    if (bloqueado.inscripcion_id) {
      throw new ErrorNegocio('Este comprobante ya fue usado en otra inscripcion.', 409);
    }
    const yaPagado = await cx.queryOne(
      'SELECT id FROM pagos WHERE comprobante_id = $1 LIMIT 1',
      [comprobanteId],
    );
    if (yaPagado) {
      throw new ErrorNegocio('Este comprobante ya tiene pagos registrados.', 409);
    }

    // Valida y bloquea cada persona con su saldo real y actual:
    // ni cortesias, ni asignar de mas, ni personas inexistentes.
    const asignadas = [];
    for (const linea of asignaciones) {
      const persona = await cx.queryOne(
        `SELECT p.*, i.codigo AS inscripcion_codigo
           FROM personas p
           JOIN inscripciones i ON i.id = p.inscripcion_id
          WHERE p.id = $1
          FOR UPDATE OF p`,
        [linea.personaId],
      );
      if (!persona) {
        throw new ErrorNegocio('Una de las personas asignadas no existe.', 422, {
          personaId: linea.personaId,
        });
      }
      if (persona.es_cortesia) {
        throw new ErrorNegocio(
          `${persona.nombre_completo} tiene una inscripción de cortesía y no admite cobros.`,
          422,
          { personaId: persona.id },
        );
      }
      const saldo = Number(persona.saldo_pendiente) || 0;
      if (linea.valor > saldo) {
        throw new ErrorNegocio(
          `A ${persona.nombre_completo} solo le queda un saldo de ${aPesos(saldo)}; no puedes asignarle ${aPesos(linea.valor)}.`,
          422,
          { personaId: persona.id, saldo, valor: linea.valor },
        );
      }
      asignadas.push({ persona, valor: linea.valor });
    }

    // Marca el comprobante como usado, vinculado a la inscripcion de la
    // primera persona asignada. Asi el chequeo «transaccion_usada» rechaza
    // capturas repetidas y la limpieza de borradores no lo elimina.
    await cx.query('UPDATE comprobantes SET inscripcion_id = $1 WHERE id = $2', [
      asignadas[0].persona.inscripcion_id,
      comprobanteId,
    ]);

    for (const { persona, valor: parte } of asignadas) {
      // Historial: una fila por asignacion, amarrada a la persona, su
      // inscripcion original y el comprobante.
      await cx.query(
        `INSERT INTO pagos (inscripcion_id, persona_id, comprobante_id, valor, tipo)
         VALUES ($1, $2, $3, $4, 'abono')`,
        [persona.inscripcion_id, persona.id, comprobanteId, parte],
      );

      const nuevoPagado = Number(persona.valor_pagado) + parte;
      const nuevoSaldo = Number(persona.saldo_pendiente) - parte;
      await cx.query(
        `UPDATE personas
            SET valor_pagado = $1, saldo_pendiente = $2, estado = $3, tipo_pago = $4
          WHERE id = $5`,
        [
          nuevoPagado,
          nuevoSaldo,
          nuevoSaldo === 0 ? 'completo' : 'abono',
          nuevoSaldo === 0 ? 'completo' : 'abono',
          persona.id,
        ],
      );
    }

    // Recalcula los totales de cada inscripcion afectada. Las personas ajenas
    // conservan sus cifras: solo cambia lo de las personas asignadas.
    const idsInscripciones = [...new Set(asignadas.map((a) => a.persona.inscripcion_id))];
    for (const idInscripcion of idsInscripciones) {
      const totales = await cx.queryOne(
        `SELECT COALESCE(SUM(valor_pagado) FILTER (WHERE NOT es_cortesia), 0) AS pagado,
                COALESCE(SUM(saldo_pendiente) FILTER (WHERE NOT es_cortesia), 0) AS pendiente
           FROM personas WHERE inscripcion_id = $1`,
        [idInscripcion],
      );
      const saldoPendiente = Number(totales.pendiente);
      await cx.query(
        `UPDATE inscripciones
            SET total_pagado = $1, saldo_pendiente = $2, estado = $3
          WHERE id = $4`,
        [
          Number(totales.pagado),
          saldoPendiente,
          saldoPendiente === 0 ? 'completada' : 'activa',
          idInscripcion,
        ],
      );
    }
  });

  // Devuelve el estado final de cada inscripcion tocada, en el orden en que
  // fueron asignadas por primera vez.
  const idsInscripciones = [];
  for (const { personaId } of asignaciones) {
    const persona = await queryOne(
      'SELECT inscripcion_id FROM personas WHERE id = $1',
      [personaId],
    );
    if (persona && !idsInscripciones.includes(persona.inscripcion_id)) {
      idsInscripciones.push(persona.inscripcion_id);
    }
  }

  const inscripciones = [];
  for (const idInscripcion of idsInscripciones) {
    inscripciones.push(await obtenerInscripcion(idInscripcion));
  }
  return { inscripciones };
}

// ------------------------------------------------------------
//  Mapeo a formato de API (camelCase)
// ------------------------------------------------------------

export function mapearComprobante(fila) {
  if (!fila) return null;
  return {
    id: fila.id,
    numeroTransaccion: fila.numero_transaccion,
    valorEnviado: Number(fila.valor_enviado),
    bancoOrigen: fila.banco_origen,
    bancoDestino: fila.banco_destino,
    llaveDestino: fila.llave_destino,
    fechaTransaccion: fila.fecha_transaccion,
    archivoNombre: fila.archivo_nombre,
    archivoClave: fila.archivo_ruta,
    origenDatos: fila.origen_datos,
    verificado: Boolean(fila.verificado),
  };
}

/**
 * Agrega el enlace temporal al comprobante. Se hace aparte porque firmar la
 * URL es una llamada asíncrona al almacenamiento.
 */
export async function conEnlace(comprobante) {
  if (!comprobante) return null;
  return { ...comprobante, archivoUrl: await almacenamiento.urlDe(comprobante.archivoClave) };
}

function mapearInscripcion(inscripcion, personas, comprobantes, pagos) {
  return {
    id: inscripcion.id,
    codigo: inscripcion.codigo,
    transporte: inscripcion.transporte,
    valorPorPersona: Number(inscripcion.valor_por_persona),
    totalAPagar: Number(inscripcion.total_a_pagar),
    totalPagado: Number(inscripcion.total_pagado),
    totalIngresosCortesia: personas.reduce(
      (suma, persona) => suma + (persona.es_cortesia ? Number(persona.valor_pagado) || 0 : 0),
      0,
    ),
    saldoPendiente: Number(inscripcion.saldo_pendiente),
    estado: inscripcion.estado,
    creadaEn: inscripcion.created_at,
    personas: personas.map((p) => ({
      id: p.id,
      primerNombre: p.primer_nombre,
      primerApellido: p.primer_apellido,
      nombreCompleto: p.nombre_completo,
      tipoDocumento: p.tipo_documento,
      documento: p.documento,
      fechaExpedicion: p.fecha_expedicion,
      nombreAcompanante: p.nombre_acompanante,
      transporte: p.transporte,
      telefono: p.telefono,
      correo: p.correo,
      edad: p.edad,
      sexo: p.sexo,
      eps: p.eps,
      tipoPago: p.tipo_pago,
      valorAsignado: Number(p.valor_asignado),
      valorPagado: Number(p.valor_pagado),
      saldoPendiente: Number(p.saldo_pendiente),
      esCortesia: Boolean(p.es_cortesia),
      estado: p.estado,
    })),
    comprobantes: comprobantes.map(mapearComprobante),
    pagos: pagos.map((pago) => ({
      id: pago.id,
      personaId: pago.persona_id,
      valor: Number(pago.valor),
      tipo: pago.tipo,
      fecha: pago.created_at,
    })),
  };
}

export { analizarCapacidad };
