import { Pipe, type PipeTransform } from '@angular/core';

const formato = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

/** Formatea un número como pesos colombianos: 195000 -> $ 195.000 */
@Pipe({ name: 'pesos' })
export class PesosPipe implements PipeTransform {
  transform(valor: number | null | undefined): string {
    if (valor === null || valor === undefined || Number.isNaN(valor)) return '—';
    return formato.format(valor).replace(/\s/g, ' ');
  }
}
