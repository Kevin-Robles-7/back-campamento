import { ChangeDetectionStrategy, Component, HostListener, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../ui/icon.component';

@Component({
  selector: 'app-encabezado',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent],
  templateUrl: './encabezado.component.html',
})
export class EncabezadoComponent {
  /** true cuando la página se desplazó lo suficiente para opacar la barra. */
  protected readonly fijo = signal(false);
  protected readonly menuAbierto = signal(false);

  protected readonly enlaces = [
    { texto: 'El campamento', destino: '/', ancla: 'pasos' },
    { texto: 'Galería', destino: '/', ancla: 'galeria' },
    { texto: 'Información', destino: '/', ancla: 'info' },
  ];

  @HostListener('window:scroll')
  protected alDesplazar(): void {
    this.fijo.set(window.scrollY > 24);
  }

  protected alternarMenu(): void {
    this.menuAbierto.update((abierto) => !abierto);
  }

  protected cerrarMenu(): void {
    this.menuAbierto.set(false);
  }
}
