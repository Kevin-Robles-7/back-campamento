export const environment = {
  // En producción Netlify hace proxy de /api hacia Render (ver netlify.toml),
  // así que el frontend llama al mismo dominio y no hace falta CORS.
  apiUrl: '/api',
  assetsBase: '',
  production: true,
};
