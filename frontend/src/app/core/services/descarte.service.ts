import { Injectable, inject } from '@angular/core';
import { environment } from '../../../environments/environment';
import { InscripcionStore } from './inscripcion.store';

/**
 * Descarta en el servidor los archivos subidos que nunca llegaron a una
 * inscripción confirmada.
 *
 * Se usa `sendBeacon` porque es la única forma fiable de avisar al servidor
 * mientras la pestaña se está cerrando o recargando: las peticiones normales
 * se cancelan en ese momento.
 */
@Injectable({ providedIn: 'root' })
export class DescarteService {
  private readonly store = inject(InscripcionStore);
  private readonly base = environment.apiUrl;

  /** Ids de documentos de consentimiento subidos y aún sin confirmar. */
  private readonly documentos = new Set<number>();

  constructor() {
    if (typeof window === 'undefined') return;

    // `pagehide` cubre recarga, cierre y navegación en todos los navegadores.
    window.addEventListener('pagehide', () => this.descartarPendientes());
  }

  registrarDocumento(id: number): void {
    this.documentos.add(id);
  }

  olvidarDocumento(id: number): void {
    this.documentos.delete(id);
  }

  /** Se llama al confirmar la inscripción: ya nada queda pendiente. */
  confirmado(): void {
    this.documentos.clear();
  }

  /** Descarta de inmediato un comprobante concreto (por ejemplo al quitarlo). */
  descartarComprobante(id: number): void {
    this.avisar(`${this.base}/comprobantes/${id}/descartar`);
  }

  private descartarPendientes(): void {
    // Si ya hay inscripción confirmada, los archivos están asociados: no se tocan.
    if (this.store.inscripcion()) return;

    const comprobante = this.store.comprobante();
    if (comprobante) this.avisar(`${this.base}/comprobantes/${comprobante.id}/descartar`);

    for (const id of this.documentos) {
      this.avisar(`${this.base}/consentimientos/documento/${id}/descartar`);
    }
  }

  private avisar(url: string): void {
    try {
      if (navigator.sendBeacon?.(url, new Blob([], { type: 'text/plain' }))) return;
    } catch {
      /* sendBeacon no disponible: se intenta con fetch */
    }
    // Respaldo: petición que el navegador mantiene aunque la página se cierre.
    void fetch(url, { method: 'POST', keepalive: true }).catch(() => undefined);
  }
}
