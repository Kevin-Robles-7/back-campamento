/**
 * Pruebas de integración del módulo «Terminar inscripción».
 *
 * Corren contra una base PostgreSQL TEMPORAL con datos de prueba creados y
 * borrados por este mismo script (códigos TEST-*). NUNCA tocan la base real
 * de Supabase: la URL real vive en DATABASE_URL y aquí se ignora.
 *
 *   npm run test          → levanta un PostgreSQL embebido, aplica el
 *                           esquema real (database/schema.sql) y ejecuta todo.
 *   TEST_DB_URL=… npm test → usa una base PostgreSQL propia de pruebas.
 *
 * Uso directo: node src/scripts/pruebas-reparto.mjs
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { fileURLToPath } from 'node:url';

// ======================================================================
//  Base de datos TEMPORAL para las pruebas
// ======================================================================

const PUERTO = Number(process.env.TEST_DB_PORT || 54331);
const URL_EMBEDDED = `postgres://postgres:root@127.0.0.1:${PUERTO}/campamento_test`;

let embebida = null;
let carpetaDatos = null;

/** Deja lista una base temporal y devuelve su URL de conexión. */
async function preprarBase() {
  if (process.env.TEST_DB_URL) {
    console.log(`Usando base de pruebas externa: ${process.env.TEST_DB_URL.replace(/:[^:@/]+@/, ':***@')}`);
    return process.env.TEST_DB_URL;
  }

  console.log('Levantando PostgreSQL temporal (binarios embebidos)…');
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  carpetaDatos = path.join(
    await fs.realpath(process.env.TEMP ?? os.tmpdir()),
    'campamento-pruebas-pg',
  );
  // Limpieza de restos de corridas anteriores que no terminaron bien.
  await fs.rm(carpetaDatos, { recursive: true, force: true });
  embebida = new EmbeddedPostgres({
    databaseDir: carpetaDatos,
    port: PUERTO,
    user: 'postgres',
    password: 'root',
    persistent: false,
    // Silencia el$log del servidor: solo importan los resultados de las pruebas.
    onLog: () => {},
  });
  await embebida.initialise();
  await embebida.start();
  await embebida.createDatabase('campamento_test');
  return URL_EMBEDDED;
}

let respuesta = 0;
const resultados = [];

/** Marca una prueba como superada o como fallo con su razón. */
function verificar(condicion, nombre, detalleExtra) {
  if (condicion) {
    resultados.push({ nombre, ok: true });
    console.log(`  ✓ ${nombre}`);
  } else {
    resultados.push({ nombre, ok: false, detalle: detalleExtra });
    respuesta = 1;
    console.log(`  ✗ ${nombre}`);
    if (detalleExtra) console.log(`    ${detalleExtra}`);
  }
}

function esErrorNegocio(error, estadoEsperado, fragmentoMensaje) {
  return (
    error &&
    error.estado === estadoEsperado &&
    (!fragmentoMensaje || String(error.message).includes(fragmentoMensaje))
  );
}

async function main() {
  const url = await preprarBase();

  // La config del backend se lee al importar: hay que fijar la URL de la base
  // TEMPORAL antes de importar cualquier módulo del servicio.
  process.env.DATABASE_URL = url;
  process.env.DIRECT_URL = url;
  process.env.STORAGE_DRIVER = 'local';
  // El servidor temporal no habla SSL: hay que desactivarlo en el pool.
  process.env.DB_SSL = '0';

  const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const moduloServicio = await import('../services/inscripciones.service.js');
  const { registrarAbono, registrarReparto, buscarPersonaPorDocumento, ErrorNegocio } = moduloServicio;
  const moduloValidadores = await import('../validators.js');
  const { esquemaReparto, validar } = moduloValidadores;

  // ------------------------------------------------------------------
  //  Esquema real del proyecto (idempotente, solo en la base temporal)
  // ------------------------------------------------------------------
  const clienteSetup = new pg.Client({ connectionString: url });
  await clienteSetup.connect();
  await clienteSetup.query(await fs.readFile(path.join(raiz, 'database', 'schema.sql'), 'utf8'));

  // Limpieza de restos de corridas anteriores (solo datos TEST-*)
  await limpiarDatos(clienteSetup);

  try {
  const queryOne = async (sql, params) => {
    const { rows } = await clienteSetup.query(sql, params);
    return rows[0] ?? null;
  };
  const query = async (sql, params) => {
    const { rows } = await clienteSetup.query(sql, params);
    return rows;
  };

  // ------------------------------------------------------------------
  //  Ayudas para crear datos de prueba (TODO queda bajo codigos TEST-)
  // ------------------------------------------------------------------

  let proximaPrueba = 1;
  const transaccionLibre = () => `TEST-${Date.now().toString(36)}-${proximaPrueba++}`;

  /** Id del comprobante del escenario 5, reusado luego en el escenario 10. */
  let comprobanteEscenario5 = null;

  async function crearInscripcionPrueba({ codigo, personas }) {
    const total = personas.reduce((s, p) => s + p.valorAsignado, 0);
    const { rows } = await clienteSetup.query(
      `INSERT INTO inscripciones (codigo, transporte, valor_por_persona, total_a_pagar,
                                  total_pagado, saldo_pendiente, estado, paso_actual)
       VALUES ($1, 'bus', 195000, $2, 0, $2, 'activa', 5) RETURNING id`,
      [codigo, total],
    );
    const inscripcionId = rows[0].id;
    const ids = {};
    for (const persona of personas) {
      const { rows: filas } = await clienteSetup.query(
        `INSERT INTO personas (inscripcion_id, primer_nombre, primer_apellido, nombre_completo,
                               tipo_documento, documento, telefono, transporte, tipo_pago,
                               valor_asignado, valor_pagado, saldo_pendiente, estado)
         VALUES ($1, $2, $3, $4, 'CC', $5, '3000000000', 'bus', 'abono',
                 $6, 0, $6, 'abono') RETURNING id`,
        [
          inscripcionId,
          persona.nombre.split(' ')[0],
          persona.nombre.split(' ')[1] ?? 'Prueba',
          persona.nombre,
          persona.documento,
          persona.valorAsignado,
        ],
      );
      ids[persona.nombre] = filas[0].id;
    }
    return { id: inscripcionId, ids };
  }

  /** Comprobante ya verificado, como llega tras la verificación automática. */
  async function crearComprobantePrueba(valor) {
    const { rows } = await clienteSetup.query(
      `INSERT INTO comprobantes (numero_transaccion, valor_enviado, banco_origen, banco_destino,
                                 llave_destino, fecha_transaccion, verificado)
       VALUES ($1, $2, 'Nequi', 'Bancolombia', '@Plata3143817689', NOW(), true)
       RETURNING id`,
      [transaccionLibre(), valor],
    );
    return { id: rows[0].id };
  }

  const saldo = async (idPersona) =>
    Number((await queryOne('SELECT saldo_pendiente, valor_pagado, estado FROM personas WHERE id = $1', [idPersona])).saldo_pendiente);
  const inscripcionDe = async (idInscripcion) => await queryOne('SELECT * FROM inscripciones WHERE id = $1', [idInscripcion]);
  const pagosDe = (idComprobante) =>
    query('SELECT persona_id, inscripcion_id, comprobante_id, valor, tipo FROM pagos WHERE comprobante_id = $1 ORDER BY id', [idComprobante]);

  // ==================================================================
  //  Escenario 1 · una persona paga su saldo completo (abono viejo)
  // ==================================================================
  {
    console.log('\n1 · Una persona con saldo pendiente realiza un pago completo');
    const ins = await crearInscripcionPrueba({
      codigo: `TEST-S1`,
      personas: [{ nombre: 'Ana Total', documento: '1000000001', valorAsignado: 195000 }],
    });
    const comprobante = await crearComprobantePrueba(195000);
    const inscripcion = await registrarAbono({
      inscripcionId: ins.id,
      personaId: ins.ids['Ana Total'],
      comprobanteId: comprobante.id,
      soloPersona: false,
    });
    verificar((await saldo(ins.ids['Ana Total'])) === 0, 'El saldo de la persona queda en 0');
    verificar(inscripcion.estado === 'completada', 'La inscripción queda completada');
    verificar(
      (await pagosDe(comprobante.id)).length === 1,
      'El pago queda registrado en el historial',
    );
  }

  // ==================================================================
  //  Escenario 2 · una persona paga un abono parcial
  // ==================================================================
  {
    console.log('\n2 · Una persona con saldo pendiente realiza un abono parcial');
    const ins = await crearInscripcionPrueba({
      codigo: `TEST-S2`,
      personas: [{ nombre: 'Beto Parcial', documento: '1000000002', valorAsignado: 195000 }],
    });
    const comprobante = await crearComprobantePrueba(50000);
    const inscripcion = await registrarAbono({
      inscripcionId: ins.id,
      personaId: ins.ids['Beto Parcial'],
      comprobanteId: comprobante.id,
      soloPersona: true,
    });
    verificar((await saldo(ins.ids['Beto Parcial'])) === 145000, 'El saldo queda en 145.000');
    verificar(inscripcion.estado === 'activa', 'La inscripción sigue activa');
    verificar(
      (await queryOne('SELECT estado FROM personas WHERE id = $1', [ins.ids['Beto Parcial']])).estado === 'abono',
      'La persona queda en estado «abono»',
    );
  }

  // ==================================================================
  //  Escenario 3 · varias personas de una MISMA inscripción comparten pago
  // ==================================================================
  {
    console.log('\n3 · Varias personas de una misma inscripción comparten un pago');
    const ins = await crearInscripcionPrueba({
      codigo: `TEST-S3`,
      personas: [
        { nombre: 'Carla Prima', documento: '1000000003', valorAsignado: 195000 },
        { nombre: 'David Segundo', documento: '1000000004', valorAsignado: 195000 },
      ],
    });
    // Deben 390.000 entre las dos y llegan 390.000.
    const comprobante = await crearComprobantePrueba(390000);
    await registrarAbono({
      inscripcionId: ins.id,
      personaId: ins.ids['Carla Prima'],
      comprobanteId: comprobante.id,
      soloPersona: false, // el excedente se reparte
    });
    verificar((await saldo(ins.ids['Carla Prima'])) === 0, 'Carla queda con saldo 0');
    verificar((await saldo(ins.ids['David Segundo'])) === 0, 'David queda con saldo 0');
    verificar((await inscripcionDe(ins.id)).estado === 'completada', 'La inscripción queda completada');
    const filasAbono = await pagosDe(comprobante.id);
    verificar(
      filasAbono.length === 1 &&
        String(filasAbono[0].persona_id) === String(ins.ids['Carla Prima']) &&
        Number(filasAbono[0].valor) === 390000,
      'La fila del abono queda con la persona elegida y el valor total del pago',
    );
  }

  // ==================================================================
  //  Escenario 4 · buscar personas de otras inscripciones por documento
  // ==================================================================
  {
    console.log('\n4 · Se buscan personas de otras inscripciones por documento');
    const insA = await crearInscripcionPrueba({
      codigo: `TEST-S4A`,
      personas: [{ nombre: 'Elena Puente', documento: '1000000005', valorAsignado: 195000 }],
    });
    const insB = await crearInscripcionPrueba({
      codigo: `TEST-S4B`,
      personas: [{ nombre: 'Fabio Ajeno', documento: '1000000006', valorAsignado: 180000 }],
    });
    const elena = await buscarPersonaPorDocumento('1000000005');
    const fabio = await buscarPersonaPorDocumento('1000000006');
    verificar(elena && elena.inscripcionCodigo === 'TEST-S4A', 'Elena aparece con su código BP-TEST-S4A');
    verificar(fabio && fabio.inscripcionCodigo === 'TEST-S4B', 'Fabio aparece con su código BP-TEST-S4B');
    verificar(elena.saldoPendiente === 195000, 'La búsqueda devuelve el saldo pendiente');
    verificar(elena.nombreCompleto === 'Elena Puente', 'La búsqueda devuelve los datos para verificar');

    // El documento de una persona nunca aparece en dos inscripciones:
    // UNIQUE en la base ⇒ no hay duplicados.
    const duplicados = await query('SELECT COUNT(*)::int AS n FROM personas WHERE documento = $1', [
      '1000000005',
    ]);
    verificar(duplicados[0].n === 1, 'No se crean registros duplicados de la persona');
  }

  // ==================================================================
  //  Escenario 5 · repartir un pago entre 3 códigos de inscripción
  //  Ejemplo del requerimiento: $350.000 entre Juan (100k), María
  //  (150k) y Pedro (debe 200k, le entran 100k y sigue debiendo 100k).
  // ==================================================================
  {
    console.log('\n5 · Se distribuye dinero entre personas de diferentes códigos');
    const insA = await crearInscripcionPrueba({
      codigo: `TEST-S5A`,
      personas: [{ nombre: 'Juan Único', documento: '1000000007', valorAsignado: 100000 }],
    });
    const insB = await crearInscripcionPrueba({
      codigo: `TEST-S5B`,
      personas: [{ nombre: 'María Aparte', documento: '1000000008', valorAsignado: 150000 }],
    });
    const insC = await crearInscripcionPrueba({
      codigo: `TEST-S5C`,
      personas: [{ nombre: 'Pedro Tercero', documento: '1000000009', valorAsignado: 200000 }],
    });

    const comprobante = await crearComprobantePrueba(350000);
    comprobanteEscenario5 = comprobante.id;
    const { inscripciones } = await registrarReparto({
      comprobanteId: comprobante.id,
      asignaciones: [
        { personaId: insA.ids['Juan Único'], valor: 100000 },
        { personaId: insB.ids['María Aparte'], valor: 150000 },
        { personaId: insC.ids['Pedro Tercero'], valor: 100000 },
      ],
    });

    verificar((await saldo(insA.ids['Juan Único'])) === 0, 'Juan queda con saldo 0');
    verificar((await saldo(insB.ids['María Aparte'])) === 0, 'María queda con saldo 0');
    verificar(
      (await saldo(insC.ids['Pedro Tercero'])) === 100000,
      'Pedro queda debiendo 100.000 (asignación parcial)',
    );

    const filasPagos = await pagosDe(comprobante.id);
    verificar(filasPagos.length === 3, 'Cada asignación generó su fila en el historial de pagos');
    verificar(
      filasPagos.every((p) => p.tipo === 'abono' && p.comprobante_id === comprobante.id),
      'Los pagos quedaron vinculados al comprobante',
    );
    verificar(
      filasPagos.every((p) => p.inscripcion_id !== null && p.persona_id !== null),
      'Cada fila de pago quedó amarrada a su persona y a su inscripción',
    );
    verificar(
      inscripciones.find((i) => i.id === insA.id).estado === 'completada' &&
        inscripciones.find((i) => i.id === insB.id).estado === 'completada' &&
        inscripciones.find((i) => i.id === insC.id).estado === 'activa',
      'Cada inscripción conservó su estado correcto (completadas las cerradas, activa la parcial)',
    );
    verificar(
      (await inscripcionDe(insA.id)).total_pagado === 100000 &&
        (await inscripcionDe(insC.id)).total_pagado === 100000 &&
        (await inscripcionDe(insC.id)).saldo_pendiente === 100000,
      'Los totales de cada inscripción se recalcularon bien',
    );
  }

  // ==================================================================
  //  Escenario 6 · finalizar dejando dinero sin asignar (bloqueado)
  // ==================================================================
  {
    console.log('\n6 · Se intenta finalizar dejando dinero sin asignar');
    const ins = await crearInscripcionPrueba({
      codigo: `TEST-S6`,
      personas: [{ nombre: 'Gabriela Uno', documento: '1000000010', valorAsignado: 195000 }],
    });
    const comprobante = await crearComprobantePrueba(350000);
    try {
      await registrarReparto({
        comprobanteId: comprobante.id,
        asignaciones: [{ personaId: ins.ids['Gabriela Uno'], valor: 300000 }],
      });
      verificar(false, 'El reparto con faltante debió bloquearse');
    } catch (error) {
      verificar(
        esErrorNegocio(error, 422) && String(error.message).includes('por asignar'),
        'Bloquea la finalización con mensaje de lo pendiente por asignar',
        `Recibido: ${error?.estado} · ${error?.message}`,
      );
    }
    verificar((await pagosDe(comprobante.id)).length === 0, 'No se guardó ningún pago (todo se revirtió)');
  }

  // ==================================================================
  //  Escenario 7 · asignar más dinero del saldo pendiente (bloqueado)
  // ==================================================================
  {
    console.log('\n7 · Se intenta asignar más dinero del saldo pendiente');
    const ins = await crearInscripcionPrueba({
      codigo: `TEST-S7`,
      personas: [{ nombre: 'Hugo Corto', documento: '1000000011', valorAsignado: 195000 }],
    });
    const comprobante = await crearComprobantePrueba(350000);
    try {
      // Suma exacta, pero supera el saldo de la persona.
      await registrarReparto({
        comprobanteId: comprobante.id,
        asignaciones: [
          { personaId: ins.ids['Hugo Corto'], valor: 350000 },
        ],
      });
      verificar(false, 'Debió bloquearse la asignación superior al saldo');
    } catch (error) {
      verificar(
        esErrorNegocio(error, 422, 'solo le queda un saldo'),
        'Rechaza asignar más que el saldo pendiente de la persona',
        `${error?.estado} · ${error?.message}`,
      );
    }

    // Asignar en total MÁS que el dinero recibido también se bloquea.
    try {
      await registrarReparto({
        comprobanteId: comprobante.id,
        asignaciones: [{ personaId: ins.ids['Hugo Corto'], valor: 500000 }],
      });
      verificar(false, 'Debió bloquearse asignar más que lo recibido');
    } catch (error) {
      verificar(
        esErrorNegocio(error, 422, 'no puedes asignar mas dinero del recibido'),
        'Rechaza asignar más dinero que el recibido',
        `${error?.estado} · ${error?.message}`,
      );
    }
    verificar((await pagosDe(comprobante.id)).length === 0, 'Sin escrituras parciales en la base');
  }

  // ==================================================================
  //  Escenario 8 · documento que no existe
  // ==================================================================
  {
    console.log('\n8 · Se busca un documento que no existe');
    const resultado = await buscarPersonaPorDocumento('9999999999');
    verificar(resultado === null, 'Devuelve vacío (persona no encontrada) sin error');
  }

  // ==================================================================
  //  Escenario 9 · misma persona dos veces
  // ==================================================================
  {
    console.log('\n9 · Se intenta agregar dos veces a la misma persona');
    const ins = await crearInscripcionPrueba({
      codigo: `TEST-S9`,
      personas: [{ nombre: 'Iván Doble', documento: '1000000012', valorAsignado: 195000 }],
    });
    const comprobante = await crearComprobantePrueba(350000);
    try {
      await registrarReparto({
        comprobanteId: comprobante.id,
        asignaciones: [
          { personaId: ins.ids['Iván Doble'], valor: 100000 },
          { personaId: ins.ids['Iván Doble'], valor: 250000 },
        ],
      });
      verificar(false, 'Debió rechazarse la persona repetida');
    } catch (error) {
      verificar(
        esErrorNegocio(error, 422, 'personas repetidas'),
        'Rechaza duplicar a la misma persona en la distribución',
        `${error?.estado} · ${error?.message}`,
      );
    }
  }

  // ==================================================================
  //  Escenario 10 · saldos, historial y reglas de oro al final
  // ==================================================================
  {
    console.log('\n10 · Verificación de saldos, historial y reglas de oro');

    // 10a. El comprobante del escenario 5 quedó marcado como usado
    // (inscripción vinculada) y además ya tiene pagos: no debe reutilizarse.
    const usado = await queryOne(
      'SELECT inscripcion_id FROM comprobantes WHERE id = $1',
      [comprobanteEscenario5],
    );
    verificar(
      usado && usado.inscripcion_id !== null,
      'El comprobante usado quedó marcado (no reutilizable)',
    );

    // 10b. Los valores negativos o sin sentido los rechaza la validación.
    const ins = await crearInscripcionPrueba({
      codigo: `TEST-S10`,
      personas: [{ nombre: 'Julia Fina', documento: '1000000013', valorAsignado: 195000 }],
    });
    const comprobante = await crearComprobantePrueba(100000);
    const casosInvalidos = [
      { personaId: ins.ids['Julia Fina'], valor: 0 },
      { personaId: ins.ids['Julia Fina'], valor: -5000 },
      { personaId: ins.ids['Julia Fina'], valor: 1000.5 },
    ];
    let rechazados = 0;
    for (const caso of casosInvalidos) {
      try {
        validar(esquemaReparto, { comprobanteId: comprobante.id, asignaciones: [caso] });
      } catch {
        rechazados++;
      }
    }
    verificar(rechazados === casosInvalidos.length, 'La validación rechaza 0, negativos y decimales');

    // 10c. Persona inexistente en las asignaciones.
    try {
      await registrarReparto({
        comprobanteId: comprobante.id,
        asignaciones: [{ personaId: 999999999, valor: 100000 }],
      });
      verificar(false, 'Debió rechazarse una persona inexistente');
    } catch (error) {
      verificar(
        esErrorNegocio(error, 422, 'no existe'),
        'Rechaza asignar dinero a una persona que no existe',
        `${error?.estado} · ${error?.message}`,
      );
    }

    // 10d. Cortesía: no admite cobros.
    const idCortesia = (
      await clienteSetup.query(
        `INSERT INTO personas (inscripcion_id, primer_nombre, primer_apellido, nombre_completo,
                               documento, telefono, tipo_pago, valor_asignado, valor_pagado,
                               saldo_pendiente, estado, es_cortesia)
         VALUES ($1, 'Karla', 'Cortesia', 'Karla Cortesia', '1000000014', '3000000000',
                 'abono', 195000, 0, 195000, 'abono', true) RETURNING id`,
        [ins.id],
      )
    ).rows[0].id;
    try {
      await registrarReparto({
        comprobanteId: comprobante.id,
        asignaciones: [{ personaId: idCortesia, valor: 100000 }],
      });
      verificar(false, 'Debió rechazarse cobrar a una cortesía');
    } catch (error) {
      verificar(esErrorNegocio(error, 422, 'cortesía'), 'Rechaza asignar dinero a una cortesía');
    }

    // 10e Coherencia contable global: saldos de personas == saldo de la inscripción.
    const incoherentes = await query(
      `SELECT i.codigo, i.saldo_pendiente, COALESCE(SUM(p.saldo_pendiente), 0) AS saldos
         FROM inscripciones i JOIN personas p ON p.inscripcion_id = i.id
        WHERE i.codigo LIKE 'TEST-%' AND NOT p.es_cortesia
        GROUP BY i.id, i.codigo, i.saldo_pendiente
          HAVING ABS(i.saldo_pendiente - COALESCE(SUM(p.saldo_pendiente), 0)) > 0`,
    );
    verificar(incoherentes.length === 0, 'Los saldos de inscripción cuadran con las personas');

    // 10f. despues de los rechazos, el comprobante de esta prueba sigue sin usar.
    verificar((await pagosDe(comprobante.id)).length === 0, 'Los rechazos no dejaron huella de pagos');
  }

  // ------------------------------------------------------------------
  //  Cierre: resumen y limpieza
  // ------------------------------------------------------------------
  const superadas = resultados.filter((r) => r.ok).length;
  console.log(`\nResultado: ${superadas}/${resultados.length} verificaciones correctas`);
  if (respuesta) {
    console.log('FALLOS:');
    for (const r of resultados.filter((x) => !x.ok)) {
      console.log(`  ✗ ${r.nombre}${r.detalle ? ` — ${r.detalle}` : ''}`);
    }
  }
  } finally {
    await clienteSetup.end().catch(() => {});
  }
}

/** Borra SOLO los datos creados por las pruebas (códigos TEST-*). */
async function limpiarDatos(cliente) {
  await cliente.query(`DELETE FROM comprobantes WHERE numero_transaccion LIKE 'TEST-%'`);
  await cliente.query(`DELETE FROM inscripciones WHERE codigo LIKE 'TEST-%'`);
}

main()
  .then(async () => {
    await cerrarBase();
    process.exit(respuesta);
  })
  .catch(async (error) => {
    console.error('ERROR FATAL EN LAS PRUEBAS:', error);
    respuesta = 1;
    await cerrarBase();
    process.exit(1);
  });

/** Detiene el PostgreSQL temporal y borra sus archivos. Nunca falla: el
 *  resultado del test ya quedó en la consola. */
async function cerrarBase() {
  if (embebida) {
    await embebida.stop().catch(() => {});
  }
  if (carpetaDatos) {
    // Windows tarda un poco en soltar LOS archivos tras el stop: se reintenta.
    for (let intento = 0; intento < 10; intento++) {
      try {
        await fs.rm(carpetaDatos, { recursive: true, force: true });
        break;
      } catch (error) {
        if (intento === 9) break; // se deja la carpeta: no afecta el resultado
        await new Promise((resolver) => setTimeout(resolver, 500));
      }
    }
  }
}
