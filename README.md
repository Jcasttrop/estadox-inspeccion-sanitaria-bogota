# Inspección Sanitaria Inteligente — Bogotá

**Priorización de inspección sanitaria basada en riesgo: de un modelo reactivo y aleatorio a uno predictivo, focalizado y auditable.**

🔗 **Demo en producción:** https://estadox-inspeccion-sanitaria-bogota.vercel.app
📄 Documento maestro (contexto, fórmulas y arquitectura): [`docs/propuesta-inspeccion-sanitaria.md`](docs/propuesta-inspeccion-sanitaria.md)
🩺 Reto original: [`HACKATON.md`](HACKATON.md)

---

## El marco

Proyecto construido para el **Hackathon EstadoX**, cuyo reto fue: *"diseñar una solución que use
inteligencia artificial para transformar la inspección sanitaria de un modelo reactivo y aleatorio
a uno predictivo y focalizado"* para los establecimientos vigilados de **Bogotá**.

Se montó reutilizando la infraestructura cívica de **Pereira Reporta** (plataforma de reportes
ciudadanos que ya opera en Colombia); de ahí se extrajo luego a este repositorio autónomo. Toda la
funcionalidad vive en la ruta [`/inspeccion-sanitaria`](https://estadox-inspeccion-sanitaria-bogota.vercel.app/inspeccion-sanitaria).

## El problema que se quería resolver

Bogotá tiene **~400.000 establecimientos sujetos a vigilancia sanitaria** (restaurantes, panaderías,
tiendas, consultorios médicos y odontológicos, laboratorios, droguerías, jardines infantiles, plantas
de procesamiento…) y la Secretaría de Salud cuenta con apenas **unos cientos de técnicos de saneamiento**.
La cuenta no da: a 5 visitas/día × 250 días laborales no se cubre ni una fracción del universo.

El sistema actual funciona **por inercia y por petición**: se visita al que alguien denunció, al que
toca por programación anual sin criterio, o al que ya causó un brote. El restaurante de alta rotación
en zona escolar sin quejas formales pero con prácticas riesgosas pasa años invisible; el consultorio
que esteriliza mal no aparece en el radar hasta que hay un evento adverso. Mientras tanto el inspector
gasta horas en establecimientos de bajo riesgo que ya cumplen.

**No existía un modelo de priorización basado en riesgo real** ni un cruce sistemático de las fuentes
que la ciudad ya tiene: quejas (SDQS), reportes de intoxicación (SIVIGILA), resultados de visitas
previas, vigencia del concepto sanitario, población atendida, densidad por zona y señales digitales.

### El antecedente que prueba que funciona: Chicago (2015)

Mismo punto de partida (~15.000 restaurantes, 32 inspectores). En vez de contratar más, la ciudad
construyó un modelo de riesgo con datos públicos y **ordenó las visitas por probabilidad de violación
crítica**: identificó tempranamente el **69% de las violaciones críticas** frente al **55%** del método
tradicional — las mismas violaciones descubiertas en promedio **7 días antes**, con los mismos
inspectores y sin gastar más. *(Matiz honesto: es velocidad de detección en un piloto, no una reducción
de intoxicaciones probada.)*

## La solución: cómo se hizo

Un **único motor de riesgo** alimentado por 4 flujos de señal que produce tres salidas para el
inspector (mapa priorizado, agenda diaria y alerta de brotes), todo en un solo mapa Leaflet con un
toggle de 4 modos. El ciclo se retroalimenta: cada denuncia, autorreporte y resultado de visita
recalcula el score → reordena la agenda → enfoca al inspector → y su resultado vuelve a alimentar el score.

Los **4 ejes del reto**, todos implementados:

- **Eje 1 — Puntaje dinámico de riesgo** — cada establecimiento recibe un score auditable 0–100 con
  desglose factor por factor (tipo, antigüedad del concepto, historial, población, quejas). 3.543
  establecimientos reales de OpenStreetMap. → `src/components/inspeccion/RiesgoMap.tsx`, `src/data/inspeccion.ts`
- **Eje 2 — Agenda diaria del inspector** — ruteo por proximidad (TSP sobre calles vía OSRM, con
  fallback greedy haversine), jornada 08–17 con almuerzo, intercalado 2+1 (alto riesgo + verificación
  rápida cercana), índice de desatención por UPZ y cierre del ciclo con reporte de visita
  *predicho-vs-encontrado*. → `src/lib/agenda.ts`, `src/lib/visita.ts`
- **Eje 3 — Autovigilancia + reporte ciudadano** —
  - *(a)* Autorreporte del establecimiento: encuesta guiada por tipo (módulos A–G) con fotos; los
    hallazgos recalculan el score en vivo. → `src/lib/autorreporte.ts`, `src/components/inspeccion/EncuestaAutovigilancia.tsx`
  - *(b)* Reporte ciudadano: cualquiera toca un establecimiento en el mapa y reporta con foto + comentario;
    suma a `quejas_ciudadanas` y se inyecta como caso en el Eje 4. → `src/components/inspeccion/ReporteCiudadano.tsx`
- **Eje 4 — Detección de clusters de brotes** — DBSCAN simplificado (radio 400 m, ventana 72 h, mínimo
  4 casos) que cruza SIVIGILA + urgencias + quejas ciudadanas y propone la fuente probable. → `src/lib/brotes.ts`
- **Cierre — Backtest estilo Chicago** — sobre un ground-truth simulado, determinista y auditable,
  compara el orden del modelo vs. el reactivo/aleatorio y grafica que el modelo detecta ≈69% de las
  violaciones críticas a mitad de periodo (vs. ≈50%), replicando el resultado de Chicago. KPIs
  computados, nunca hardcodeados. → `src/lib/backtest.ts`, `src/components/inspeccion/Backtest.tsx`

> **Datos:** los establecimientos y su geolocalización son reales (OpenStreetMap); los scores,
> historiales y casos epidemiológicos son simulados con fórmulas transparentes y auditables para la
> demo. El detalle exacto de qué es real y qué simulado está en el documento maestro.

## Stack

- [Next.js 16](https://nextjs.org/) (App Router) + React 19 + TypeScript
- Tailwind CSS v4
- Leaflet + react-leaflet + leaflet.heat (mapa de riesgo y heatmap)
- OSRM (ruteo por calles para la agenda)
- Supabase (opcional, solo para la subida de fotos)
- Desplegado en Vercel

## Puesta en marcha

```bash
npm install
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000); la raíz redirige a `/inspeccion-sanitaria`.

### Variables de entorno (opcionales)

La subida de fotos en los reportes usa Supabase Storage. La app corre sin configurarlo; solo fallará
la carga de imágenes. Para habilitarla, copia `.env.example` a `.env.local` y completa:

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
