import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { IconComponent } from './icon.component';

export interface FotoGaleria {
  archivo: string;
  alt: string;
}

/**
 * Visor de imágenes a pantalla completa. Se cierra con Escape, con clic en el
 * fondo o con el botón; se navega con las flechas del teclado o los botones.
 */
@Component({
  selector: 'app-visor-galeria',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <!-- Diálogo modal: atrapa el foco y bloquea el scroll de fondo -->
    <div
      class="fixed inset-0 z-100 grid grid-rows-[auto_1fr_auto] gap-3 bg-dark/95 p-3
             backdrop-blur-md sm:p-5"
      role="dialog"
      aria-modal="true"
      [attr.aria-label]="foto()?.alt ?? 'Foto de la galería'"
      (click)="cerrar.emit()"
    >
      <!-- ====== Barra superior ====== -->
      <header class="flex items-center justify-between gap-3">
        <p class="text-sm text-muted">
          {{ indice() + 1 }} / {{ fotos().length }}
        </p>
        <button
          class="grid size-11 cursor-pointer place-items-center rounded-full border
                 border-white/20 text-cream transition hover:border-lime hover:text-lime"
          type="button"
          (click)="cerrar.emit(); $event.stopPropagation()"
          aria-label="Cerrar visor"
        >
          <app-icon name="x" [size]="20" />
        </button>
      </header>

      <!-- ====== Imagen ====== -->
      <div class="grid min-h-0 place-items-center" (click)="$event.stopPropagation()">
        @if (foto(); as actual) {
          <img
            class="animate-rise max-h-full max-w-full rounded-2xl object-contain shadow-deep"
            [src]="actual.archivo"
            [alt]="actual.alt"
            decoding="async"
          />
        }
      </div>

      <!-- ====== Controles ====== -->
      <footer
        class="flex items-center justify-between gap-3"
        (click)="$event.stopPropagation()"
      >
        <button
          class="grid size-12 cursor-pointer place-items-center rounded-full border
                 border-white/20 text-cream transition hover:border-lime hover:text-lime"
          type="button"
          (click)="mover(-1)"
          aria-label="Foto anterior"
        >
          <app-icon name="arrow-left" [size]="20" />
        </button>

        <p class="min-w-0 flex-1 truncate text-center text-sm text-cream-dim">
          {{ foto()?.alt }}
        </p>

        <button
          class="grid size-12 cursor-pointer place-items-center rounded-full border
                 border-white/20 text-cream transition hover:border-lime hover:text-lime"
          type="button"
          (click)="mover(1)"
          aria-label="Foto siguiente"
        >
          <app-icon name="arrow-right" [size]="20" />
        </button>
      </footer>
    </div>
  `,
})
export class VisorGaleriaComponent {
  readonly fotos = input.required<FotoGaleria[]>();
  readonly inicial = input<number>(0);

  readonly cerrar = output<void>();

  private readonly desplazamiento = signal(0);

  protected readonly indice = computed(() => {
    const total = this.fotos().length;
    if (!total) return 0;
    return (((this.inicial() + this.desplazamiento()) % total) + total) % total;
  });

  protected readonly foto = computed(() => this.fotos().at(this.indice()));

  protected mover(direccion: -1 | 1): void {
    this.desplazamiento.update((actual) => actual + direccion);
  }

  @HostListener('document:keydown', ['$event'])
  protected alPulsarTecla(evento: KeyboardEvent): void {
    if (evento.key === 'Escape') {
      this.cerrar.emit();
      return;
    }
    if (evento.key === 'ArrowLeft') {
      evento.preventDefault();
      this.mover(-1);
      return;
    }
    if (evento.key === 'ArrowRight') {
      evento.preventDefault();
      this.mover(1);
    }
  }
}
