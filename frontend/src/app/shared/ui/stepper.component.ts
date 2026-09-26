import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Indicador de progreso del asistente (puntos + líneas). */
@Component({
  selector: 'app-stepper',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block px-1.5' },
  template: `
    <div
      class="flex w-full items-center"
      role="progressbar"
      [attr.aria-valuenow]="actual()"
      [attr.aria-valuemin]="desde()"
      [attr.aria-valuemax]="total()"
      [attr.aria-label]="'Paso ' + actual() + ' de ' + total()"
    >
      @for (paso of pasos(); track paso; let ultimo = $last) {
        <span
          class="relative size-3 shrink-0 rounded-full transition-colors duration-300"
          [class]="paso <= actual() ? 'bg-lime' : 'bg-white/15'"
        >
          @if (paso === actual()) {
            <span class="absolute -inset-1.5 rounded-full border-2 border-lime/35"></span>
          }
        </span>
        @if (!ultimo) {
          <span
            class="h-0.5 flex-1 transition-colors duration-300"
            [class]="paso < actual() ? 'bg-lime' : 'bg-white/15'"
          ></span>
        }
      }
    </div>
  `,
})
export class StepperComponent {
  readonly actual = input.required<number>();
  readonly total = input<number>(5);
  readonly desde = input<number>(1);

  protected readonly pasos = computed(() => {
    const inicio = this.desde();
    const cantidad = this.total() - inicio + 1;
    return Array.from({ length: cantidad }, (_, i) => inicio + i);
  });
}
