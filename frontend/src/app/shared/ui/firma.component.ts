import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { IconComponent } from './icon.component';

/**
 * Pad de firma con puntero (dedo o mouse). Emite la firma en base64 PNG
 * cada vez que el trazo termina, o null cuando se limpia.
 */
@Component({
  selector: 'app-firma',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <div class="relative grid justify-items-end gap-2">
      <canvas
        #lienzo
        class="h-[150px] w-full cursor-crosshair rounded-xl border border-white/20 bg-[#fdfdfb]"
        style="touch-action: none"
        role="img"
        aria-label="Área para firmar con el dedo o el mouse"
        (pointerdown)="iniciar($event)"
        (pointermove)="mover($event)"
        (pointerup)="terminar()"
        (pointerleave)="terminar()"
        (pointercancel)="terminar()"
      ></canvas>

      @if (vacio()) {
        <p
          class="pointer-events-none absolute inset-x-0 top-0 grid h-[150px] place-items-center
                 text-sm text-[#9aa0a6]"
          aria-hidden="true"
        >
          Firma aquí con el dedo o el mouse
        </p>
      }

      <button
        class="inline-flex cursor-pointer items-center gap-2 text-xs text-muted transition hover:text-lime"
        type="button"
        (click)="limpiar()"
      >
        <app-icon name="refresh" [size]="14" />
        Limpiar firma
      </button>
    </div>
  `,
})
export class FirmaComponent {
  private readonly lienzo = viewChild.required<ElementRef<HTMLCanvasElement>>('lienzo');
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly cambio = output<string | null>();

  protected readonly vacio = signal(true);
  private dibujando = false;
  private ctx: CanvasRenderingContext2D | null = null;

  constructor() {
    afterNextRender(() => {
      this.ajustarTamano();
      window.addEventListener('resize', this.ajustarTamano, { passive: true });
    });
  }

  /** Escala el canvas al ancho real teniendo en cuenta el devicePixelRatio. */
  private readonly ajustarTamano = (): void => {
    const canvas = this.lienzo().nativeElement;
    const ratio = window.devicePixelRatio || 1;
    const ancho = canvas.clientWidth || this.host.nativeElement.clientWidth || 300;
    const alto = canvas.clientHeight || 150;

    const datos = this.vacio() ? null : canvas.toDataURL('image/png');

    canvas.width = Math.round(ancho * ratio);
    canvas.height = Math.round(alto * ratio);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1b1c1e';
    this.ctx = ctx;

    if (datos) {
      const imagen = new Image();
      imagen.onload = () => ctx.drawImage(imagen, 0, 0, ancho, alto);
      imagen.src = datos;
    }
  };

  private posicion(evento: PointerEvent): { x: number; y: number } {
    const rect = this.lienzo().nativeElement.getBoundingClientRect();
    return { x: evento.clientX - rect.left, y: evento.clientY - rect.top };
  }

  protected iniciar(evento: PointerEvent): void {
    if (!this.ctx) return;
    evento.preventDefault();
    this.lienzo().nativeElement.setPointerCapture(evento.pointerId);
    this.dibujando = true;
    this.vacio.set(false);
    const { x, y } = this.posicion(evento);
    this.ctx.beginPath();
    this.ctx.moveTo(x, y);
  }

  protected mover(evento: PointerEvent): void {
    if (!this.dibujando || !this.ctx) return;
    evento.preventDefault();
    const { x, y } = this.posicion(evento);
    this.ctx.lineTo(x, y);
    this.ctx.stroke();
  }

  protected terminar(): void {
    if (!this.dibujando) return;
    this.dibujando = false;
    this.cambio.emit(this.lienzo().nativeElement.toDataURL('image/png'));
  }

  protected limpiar(): void {
    const canvas = this.lienzo().nativeElement;
    this.ctx?.clearRect(0, 0, canvas.width, canvas.height);
    this.vacio.set(true);
    this.cambio.emit(null);
  }
}
