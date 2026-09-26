import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ApiService, mensajeDeError } from '../../core/services/api.service';
import type { Inscripcion } from '../../core/models/campamento.models';
import { EncabezadoComponent } from '../../shared/layout/encabezado.component';
import { PieComponent } from '../../shared/layout/pie.component';
import { IconComponent } from '../../shared/ui/icon.component';
import { WhatsappFlotanteComponent } from '../../shared/ui/whatsapp-flotante.component';
import { PesosPipe } from '../../shared/pipes/pesos.pipe';

/**
 * Convierte lo que escribió la persona en el criterio de búsqueda:
 * si empieza por «BP-» es un código de inscripción, si no es un documento.
 */
export function aCriterio(valor: string): { documento?: string; codigo?: string } {
  const limpio = valor.trim().replace(/[\s.]/g, '');
  return /^bp-/i.test(limpio) ? { codigo: limpio.toUpperCase() } : { documento: limpio };
}

@Component({
  selector: 'app-consulta',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    ReactiveFormsModule,
    EncabezadoComponent,
    PieComponent,
    IconComponent,
    WhatsappFlotanteComponent,
    PesosPipe,
  ],
  templateUrl: './consulta.page.html',
})
export class ConsultaPage {
  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder);

  protected readonly buscando = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly inscripcion = signal<Inscripcion | null>(null);

  protected readonly formulario = this.fb.nonNullable.group({
    valor: ['', [Validators.required, Validators.minLength(4)]],
  });

  protected buscar(): void {
    if (this.formulario.invalid) {
      this.formulario.markAllAsTouched();
      return;
    }

    this.buscando.set(true);
    this.error.set(null);
    this.inscripcion.set(null);

    this.api.consultarInscripcion(aCriterio(this.formulario.controls.valor.value)).subscribe({
      next: ({ inscripcion }) => {
        this.buscando.set(false);
        this.inscripcion.set(inscripcion);
      },
      error: (error) => {
        this.buscando.set(false);
        this.error.set(mensajeDeError(error));
      },
    });
  }
}
