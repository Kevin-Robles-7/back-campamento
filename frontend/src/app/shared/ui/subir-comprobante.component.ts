import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import { ApiService, mensajeDeError } from '../../core/services/api.service';
import { DescarteService } from '../../core/services/descarte.service';
import type { Comprobante, MotivoRechazo } from '../../core/models/campamento.models';
import { IconComponent } from './icon.component';
import { PesosPipe } from '../pipes/pesos.pipe';

const MAX_MB = 8;
const TIPOS = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

/**
 * Sube el comprobante de pago. El servidor lo lee, valida que el dinero haya
 * llegado a una cuenta del campamento y decide si lo acepta.
 *
 * Los datos NO son editables: se muestran tal como se leyeron de la imagen.
 * Así no es posible declarar un pago distinto al realmente hecho.
 */
@Component({
  selector: 'app-subir-comprobante',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, PesosPipe],
  templateUrl: './subir-comprobante.component.html',
})
export class SubirComprobanteComponent {
  private readonly api = inject(ApiService);
  private readonly descarte = inject(DescarteService);

  /** Se emite cuando el comprobante fue aceptado por el servidor. */
  readonly confirmado = output<Comprobante>();

  protected readonly archivo = signal<File | null>(null);
  protected readonly vistaPrevia = signal<string | null>(null);
  protected readonly comprobante = signal<Comprobante | null>(null);
  protected readonly aceptado = signal(false);
  protected readonly motivos = signal<MotivoRechazo[]>([]);
  protected readonly llavesValidas = signal<string[]>([]);
  protected readonly origen = signal<'ia' | 'ocr' | 'manual'>('manual');
  protected readonly confianza = signal<number | null>(null);
  protected readonly analizando = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly arrastrando = signal(false);

  private readonly config = toSignal(
    this.api.obtenerConfiguracion().pipe(catchError(() => of(null))),
    { initialValue: null },
  );

  /** Ya hubo respuesta del servidor para el archivo actual. */
  protected readonly analizado = computed(() => !!this.comprobante() && !this.analizando());

  protected readonly cuentasCampamento = computed(() =>
    this.llavesValidas().length ? this.llavesValidas() : (this.config()?.llavesValidas ?? []),
  );

  protected readonly whatsapp = computed(() => {
    const numero = this.config()?.whatsapp ?? '573143817689';
    const texto = encodeURIComponent(
      'Hola, tuve un problema al validar mi comprobante de pago del campamento.',
    );
    return `https://wa.me/${numero}?text=${texto}`;
  });

  // ---------------- Selección de archivo ----------------

  protected alSoltar(evento: DragEvent): void {
    evento.preventDefault();
    this.arrastrando.set(false);
    const archivo = evento.dataTransfer?.files?.[0];
    if (archivo) this.recibirArchivo(archivo);
  }

  protected alArrastrar(evento: DragEvent, dentro: boolean): void {
    evento.preventDefault();
    this.arrastrando.set(dentro);
  }

  protected alSeleccionar(evento: Event): void {
    const input = evento.target as HTMLInputElement;
    const archivo = input.files?.[0];
    if (archivo) this.recibirArchivo(archivo);
    input.value = '';
  }

  private recibirArchivo(archivo: File): void {
    this.reiniciarEstado();

    if (!TIPOS.includes(archivo.type)) {
      this.error.set('Formato no permitido. Sube una captura en JPG, PNG o WEBP.');
      return;
    }
    if (archivo.size > MAX_MB * 1024 * 1024) {
      this.error.set(`El archivo supera los ${MAX_MB} MB. Intenta con una imagen más liviana.`);
      return;
    }

    this.archivo.set(archivo);
    this.vistaPrevia.set(URL.createObjectURL(archivo));
    this.analizar(archivo);
  }

  protected quitar(): void {
    // El comprobante descartado se borra del servidor: no debe quedar basura.
    const anterior = this.comprobante();
    if (anterior) this.descarte.descartarComprobante(anterior.id);

    const url = this.vistaPrevia();
    if (url) URL.revokeObjectURL(url);
    this.archivo.set(null);
    this.vistaPrevia.set(null);
    this.reiniciarEstado();
  }

  private reiniciarEstado(): void {
    this.comprobante.set(null);
    this.aceptado.set(false);
    this.motivos.set([]);
    this.confianza.set(null);
    this.error.set(null);
  }

  // ---------------- Análisis en el servidor ----------------

  private analizar(archivo: File): void {
    this.analizando.set(true);

    this.api.subirComprobante(archivo).subscribe({
      next: (respuesta) => {
        this.analizando.set(false);
        this.comprobante.set(respuesta.comprobante);
        this.aceptado.set(respuesta.aceptado);
        this.motivos.set(respuesta.motivos);
        this.llavesValidas.set(respuesta.llavesValidas);
        this.origen.set(respuesta.origen);
        this.confianza.set(respuesta.confianza);
      },
      error: (error) => {
        this.analizando.set(false);
        this.error.set(mensajeDeError(error));
      },
    });
  }

  protected continuar(): void {
    const comprobante = this.comprobante();
    if (comprobante && this.aceptado()) this.confirmado.emit(comprobante);
  }
}
