import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { InscripcionStore } from '../../core/services/inscripcion.store';
import { EncabezadoComponent } from '../../shared/layout/encabezado.component';
import { PieComponent } from '../../shared/layout/pie.component';
import { IconComponent } from '../../shared/ui/icon.component';
import { WhatsappFlotanteComponent } from '../../shared/ui/whatsapp-flotante.component';
import { VisorGaleriaComponent } from '../../shared/ui/visor-galeria.component';
import { PesosPipe } from '../../shared/pipes/pesos.pipe';

interface Paso {
  numero: string;
  titulo: string;
  texto: string;
  icono: string;
}

@Component({
  selector: 'app-landing',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    EncabezadoComponent,
    PieComponent,
    IconComponent,
    WhatsappFlotanteComponent,
    VisorGaleriaComponent,
    PesosPipe,
  ],
  templateUrl: './landing.page.html',
})
export class LandingPage {
  private readonly api = inject(ApiService);
  protected readonly store = inject(InscripcionStore);

  private readonly pista = viewChild<ElementRef<HTMLElement>>('pista');

  protected readonly config = toSignal(
    this.api.obtenerConfiguracion().pipe(catchError(() => of(null))),
    { initialValue: null },
  );

  protected readonly tarifaBus = computed(() => this.config()?.tarifaBus ?? 195000);
  protected readonly tarifaVehiculo = computed(() => this.config()?.tarifaVehiculoPropio ?? 180000);
  protected readonly abonoMinimo = computed(() => this.config()?.abonoMinimo ?? 20000);

  protected readonly whatsapp = computed(() => {
    const numero = this.config()?.whatsapp ?? '573143817689';
    const texto = encodeURIComponent(
      'Hola, quiero recibir mas informacion sobre el campamento de IPUC Bosque Popular.',
    );
    return `https://wa.me/${numero}?text=${texto}`;
  });

  protected readonly pasos: Paso[] = [
    {
      numero: '01',
      titulo: 'Realiza tu pago o abono',
      texto: 'Aparta tu cupo desde el abono mínimo, o paga el valor completo de una vez.',
      icono: 'wallet',
    },
    {
      numero: '02',
      titulo: 'Carga tu comprobante',
      texto: 'Sube la imagen y la IA lee automáticamente el valor, la cuenta y la transacción.',
      icono: 'sparkles',
    },
    {
      numero: '03',
      titulo: 'Registra las personas',
      texto: 'Con un solo pago puedes inscribir a varias personas, completas o con abono.',
      icono: 'users',
    },
    {
      numero: '04',
      titulo: '¡Listo, campista!',
      texto: 'Recibes el resumen de tu inscripción y consultas tu saldo cuando quieras.',
      icono: 'check-circle',
    },
  ];

  /** Fotos reales de la finca, servidas desde `public/img/galeria/`. */
  protected readonly galeria = [
    { archivo: 'img/galeria/piscina-y-zona-exterior.jpg', alt: 'Piscina y zona exterior de la finca' },
    { archivo: 'img/galeria/zona-de-hamacas.jpg', alt: 'Zona de hamacas para descansar' },
    { archivo: 'img/galeria/zona-social.jpg', alt: 'Zona social para compartir' },
    { archivo: 'img/galeria/zona-exterior.jpg', alt: 'Zona exterior rodeada de naturaleza' },
    { archivo: 'img/galeria/terraza.jpg', alt: 'Terraza con vista al paisaje' },
    { archivo: 'img/galeria/habitacion.jpg', alt: 'Habitación del alojamiento' },
    { archivo: 'img/galeria/habitaciones.jpg', alt: 'Habitaciones compartidas' },
    { archivo: 'img/galeria/habitacion-2.jpg', alt: 'Habitación con camas individuales' },
    { archivo: 'img/galeria/habitacion-3.jpg', alt: 'Habitación iluminada' },
    { archivo: 'img/galeria/habitacion-4.jpg', alt: 'Habitación amplia' },
    { archivo: 'img/galeria/habitacion-5.jpg', alt: 'Habitación con vista al exterior' },
  ];

  protected readonly etiquetasGaleria = ['Naturaleza', 'Amistad', 'Propósito'];
  protected readonly imagenesFallidas = signal<Set<string>>(new Set());

  protected marcarFallida(archivo: string): void {
    this.imagenesFallidas.update((previas) => new Set(previas).add(archivo));
  }

  protected imagenFallida(archivo: string): boolean {
    return this.imagenesFallidas().has(archivo);
  }

  /** Desplaza el carrusel de la galería una tarjeta a cada lado. */
  protected desplazar(direccion: -1 | 1): void {
    const elemento = this.pista()?.nativeElement;
    if (!elemento) return;
    const paso = elemento.clientWidth * 0.8;
    elemento.scrollBy({ left: paso * direccion, behavior: 'smooth' });
  }

  // ---------------- Visor a pantalla completa ----------------

  /** Índice de la foto abierta en el visor, o null si está cerrado. */
  protected readonly fotoAbierta = signal<number | null>(null);

  protected abrirVisor(indice: number): void {
    this.fotoAbierta.set(indice);
    document.body.style.overflow = 'hidden';
  }

  protected cerrarVisor(): void {
    this.fotoAbierta.set(null);
    document.body.style.overflow = '';
  }
}
