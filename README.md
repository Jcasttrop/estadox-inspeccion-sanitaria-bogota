# Inspección Sanitaria Inteligente

Solución para el **Hackathon EstadoX**: transformar la inspección sanitaria de un modelo
reactivo y aleatorio a uno **predictivo, focalizado y auditable**. Cada establecimiento
vigilado recibe un puntaje de riesgo dinámico para que el inspector visite primero donde
el riesgo es mayor.

> Extraída del monorepo de PereiraReporta a un proyecto autónomo. Toda la funcionalidad
> vive en la ruta `/inspeccion-sanitaria`.

## Los 4 ejes implementados

- **Eje 1 — Puntaje dinámico de riesgo** — score auditable 0–100 con desglose factor por factor.
- **Eje 2 — Agenda diaria del inspector** — ruta por proximidad, intercalado 2+1 y alerta de UPZ desatendida.
- **Eje 3 — Autovigilancia + reporte ciudadano** — autorreporte guiado del establecimiento (con fotos)
  y reporte del ciudadano sobre el mapa; ambos recalculan el score en vivo.
- **Eje 4 — Detección de clusters de brotes** — cruza SIVIGILA + urgencias + quejas ciudadanas
  y propone la fuente probable.
- **Backtest estilo Chicago** — compara el orden del modelo vs. el reactivo/aleatorio sobre un
  ground-truth simulado (≈69% de violaciones críticas detectadas a mitad de periodo vs. ≈50%).

Detalle completo, fórmulas y mapa de archivos en [`docs/propuesta-inspeccion-sanitaria.md`](docs/propuesta-inspeccion-sanitaria.md).
Contexto del reto en [`HACKATON.md`](HACKATON.md).

## Stack

- [Next.js 16](https://nextjs.org/) (App Router) + React 19 + TypeScript
- Tailwind CSS v4
- Leaflet + react-leaflet + leaflet.heat (mapa de riesgo y heatmap)
- Supabase (opcional, solo para la subida de fotos)

## Puesta en marcha

```bash
npm install
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000); la raíz redirige a `/inspeccion-sanitaria`.

### Variables de entorno (opcionales)

La subida de fotos en los reportes usa Supabase Storage. La app corre sin configurarlo;
solo fallará la carga de imágenes. Para habilitarla, copia `.env.example` a `.env.local` y completa:

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

## Scripts

| Comando         | Descripción                        |
| --------------- | ---------------------------------- |
| `npm run dev`   | Servidor de desarrollo             |
| `npm run build` | Build de producción                |
| `npm run start` | Servir el build de producción      |
| `npm run lint`  | ESLint                             |
