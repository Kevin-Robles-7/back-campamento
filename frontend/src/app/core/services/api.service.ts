import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, shareReplay, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import type {
  AnalisisComprobante,
  Configuracion,
  DocumentoConsentimiento,
  Inscripcion,
  PersonaInput,
  RespuestaComprobante,
} from '../models/campamento.models';

/** Mensaje legible a partir de una respuesta de error de la API. */
export function mensajeDeError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const cuerpo = error.error as { error?: string; detalles?: { mensaje: string }[] } | null;
    if (cuerpo?.detalles?.length) {
      return cuerpo.detalles.map((d) => d.mensaje).join('. ');
    }
    if (cuerpo?.error) return cuerpo.error;
    if (error.status === 0) return 'No pudimos conectarnos con el servidor. Revisa tu conexión.';
  }
  return 'Ocurrió un error inesperado. Intenta de nuevo.';
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;
  private configuracion$?: Observable<Configuracion>;

  /** Configuración pública del campamento (cacheada en memoria). */
  obtenerConfiguracion(): Observable<Configuracion> {
    this.configuracion$ ??= this.http
      .get<Configuracion>(`${this.base}/configuracion`)
      .pipe(shareReplay({ bufferSize: 1, refCount: false }), catchError(this.fallar));
    return this.configuracion$;
  }

  /**
   * Sube el comprobante. El servidor lo lee, valida la cuenta destino y
   * devuelve su veredicto. No hay endpoint para editar los datos leídos.
   */
  subirComprobante(archivo: File): Observable<RespuestaComprobante> {
    const cuerpo = new FormData();
    cuerpo.append('comprobante', archivo);
    return this.http
      .post<RespuestaComprobante>(`${this.base}/comprobantes`, cuerpo)
      .pipe(catchError(this.fallar));
  }

  /** Cuántas personas se pueden inscribir con el valor pagado. */
  analizarComprobante(id: number): Observable<AnalisisComprobante> {
    return this.http
      .get<AnalisisComprobante>(`${this.base}/comprobantes/${id}/analisis`)
      .pipe(catchError(this.fallar));
  }

  /** Sube el PDF o Word del consentimiento de un menor de edad. */
  subirDocumentoConsentimiento(
    archivo: File,
  ): Observable<{ documento: DocumentoConsentimiento }> {
    const cuerpo = new FormData();
    cuerpo.append('documento', archivo);
    return this.http
      .post<{ documento: DocumentoConsentimiento }>(
        `${this.base}/consentimientos/documento`,
        cuerpo,
      )
      .pipe(catchError(this.fallar));
  }

  crearInscripcion(datos: {
    comprobanteId: number;
    personas: PersonaInput[];
  }): Observable<{ inscripcion: Inscripcion }> {
    return this.http
      .post<{ inscripcion: Inscripcion }>(`${this.base}/inscripciones`, datos)
      .pipe(catchError(this.fallar));
  }

  consultarInscripcion(criterio: {
    documento?: string;
    transaccion?: string;
  }): Observable<{ inscripcion: Inscripcion }> {
    return this.http
      .get<{ inscripcion: Inscripcion }>(`${this.base}/inscripciones/consultar`, {
        params: criterio,
      })
      .pipe(catchError(this.fallar));
  }

  /**
   * Registra un abono. `soloPersona` evita que el excedente se reparta entre
   * las demás personas de la inscripción.
   */
  registrarAbono(datos: {
    inscripcionId: number;
    personaId?: number | null;
    comprobanteId: number;
    soloPersona?: boolean;
  }): Observable<{ inscripcion: Inscripcion }> {
    return this.http
      .post<{ inscripcion: Inscripcion }>(`${this.base}/pagos`, datos)
      .pipe(catchError(this.fallar));
  }

  /** URL absoluta de un archivo servido por la API. */
  urlArchivo(ruta: string | null): string | null {
    return ruta ? `${environment.assetsBase}${ruta}` : null;
  }

  private readonly fallar = (error: unknown) => throwError(() => error);
}
