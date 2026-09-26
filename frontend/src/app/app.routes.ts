import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./features/landing/landing.page').then((m) => m.LandingPage),
    title: 'Campamento IPUC Bosque Popular · Noviembre 7 y 8',
  },
  {
    path: 'inscripcion',
    loadComponent: () =>
      import('./features/inscripcion/inscripcion.page').then((m) => m.InscripcionPage),
    title: 'Nueva inscripción · Campamento BP',
  },
  {
    path: 'consultar',
    loadComponent: () => import('./features/consulta/consulta.page').then((m) => m.ConsultaPage),
    title: 'Consultar inscripción · Campamento BP',
  },
  {
    path: 'terminar',
    loadComponent: () => import('./features/terminar/terminar.page').then((m) => m.TerminarPage),
    title: 'Terminar inscripción · Campamento BP',
  },
  { path: '**', redirectTo: '' },
];
