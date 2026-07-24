// Motor de generación de la agenda diaria del inspector (Eje 2 del reto).
//
// Convierte el puntaje de riesgo (abstracto) en un plan de trabajo accionable:
//  1. Elige la localidad FOCO del día por "índice de desatención"
//     (riesgo acumulado + días sin presencia institucional).
//  2. SELECCIONA el conjunto de visitas (inspecciones de alto riesgo +
//     verificaciones rápidas de bajo riesgo cercanas) — función pura.
//  3. OPTIMIZA el orden y el trazado sobre la RED VIAL REAL usando OSRM
//     (resuelve el TSP por calles y devuelve la geometría real de la ruta).
//     Si la red falla, cae a un greedy por distancia en línea recta.
//
// La selección es determinista; solo el ruteo real depende de la red.

import type { Establecimiento, NivelRiesgo } from "@/data/inspeccion";

export const UMBRAL_PRESENCIA_DIAS = 30; // ninguna UPZ debe pasar más sin presencia

// Servidor público de OSRM (perfil "driving"). Sin API key.
const OSRM_BASE = "https://router.project-osrm.org";
const OSRM_TIMEOUT_MS = 7000;

// Días desde la última presencia institucional por localidad.
// Determinista (hash del nombre) para que la demo sea reproducible.
// En producción vendría del registro real de visitas del inspector por UPZ.
export function diasSinPresencia(localidad: string): number {
  let h = 0;
  for (let i = 0; i < localidad.length; i++) {
    h = (h * 31 + localidad.charCodeAt(i)) % 1000;
  }
  return 8 + (h % 55); // rango ~8..62 días
}

// Distancia en kilómetros entre dos coordenadas (fórmula de haversine).
export function haversineKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

const VELOCIDAD_URBANA_KMH = 18; // fallback cuando no hay red vial real

// --- Jornada laboral del inspector ---
const JORNADA_INICIO_MIN = 480; // 08:00
const JORNADA_FIN_MIN = 1020; // 17:00 (tope: no se agenda nada que termine después)
const ALMUERZO_INICIO_MIN = 720; // 12:00
const ALMUERZO_FIN_MIN = 780; // 13:00

// Categorías con inspección más larga (planta física grande, cadena de frío,
// manipulación de alimentos, población sensible).
const CATEGORIAS_COMPLEJAS = new Set([
  "Restaurante",
  "Comida rapida",
  "Supermercado",
  "Carniceria",
  "Panaderia",
  "Clinica / laboratorio",
  "Jardin infantil",
]);

// Tiempo de PERMANENCIA en el local (minutos), estimado por factores reales del
// establecimiento — no un valor plano. Auditable: cada sumando es explicable.
//  Inspección a fondo: base 60 + concepto vencido + quejas + población
//    vulnerable + complejidad de la categoría (~60–110 min).
//  Verificación rápida: base 20 + quejas (~20–30 min).
export function duracionVisita(e: Establecimiento): number {
  const esInspeccion = tipoPorRiesgo(e.nivel_riesgo) === "Inspección";
  if (esInspeccion) {
    let min = 60;
    if (e.concepto_vencido) min += 15;
    min += Math.min(e.quejas_12m * 5, 20);
    if (e.poblacion_vulnerable) min += 10;
    if (CATEGORIAS_COMPLEJAS.has(e.categoria)) min += 15;
    return min;
  }
  return 20 + Math.min(e.quejas_12m * 5, 10);
}

export type TipoVisita = "Inspección" | "Verificación rápida";

// El tipo de visita se deriva del riesgo del establecimiento (no de un patrón):
// alto riesgo => inspección a fondo; bajo riesgo => verificación rápida "de paso".
function tipoPorRiesgo(nivel: NivelRiesgo): TipoVisita {
  return nivel === "Critico" || nivel === "Alto"
    ? "Inspección"
    : "Verificación rápida";
}

export interface Parada {
  orden: number;
  establecimiento: Establecimiento;
  tipoVisita: TipoVisita;
  distanciaKm: number; // desde la parada anterior (por calles si hay ruta real)
  horaLlegada: string; // "HH:MM"
  horaSalida: string;
  duracionMin: number;
}

export interface Agenda {
  localidadFoco: string;
  diasSinPresencia: number;
  superaUmbral: boolean;
  base: { lat: number; lon: number };
  paradas: Parada[];
  // Trazado de la ruta como lista de [lat, lon]. Con ruta real sigue las calles;
  // en fallback son segmentos rectos entre paradas.
  geometria: [number, number][];
  rutaReal: boolean; // true = optimizada por OSRM sobre calles reales
  resumen: {
    totalVisitas: number;
    criticos: number;
    inspecciones: number;
    verificaciones: number;
    distanciaTotalKm: number;
    horaInicio: string;
    horaFin: string;
    // Visitas seleccionadas que NO alcanzan a hacerse hoy (superan la jornada).
    omitidas: number;
    // Bloque de almuerzo efectivamente tomado, si la jornada lo cruzó.
    almuerzo: { inicio: string; fin: string } | null;
  };
}

export interface OpcionesAgenda {
  maxVisitas?: number;
  horaInicioMin?: number; // minutos desde medianoche (480 = 08:00)
  localidadFoco?: string; // forzar una localidad (ej. si el usuario filtró)
  // Día de la rotación (0 = hoy, 1 = mañana…). Sin localidadFoco, rota entre las
  // UPZ más desatendidas para que la agenda no sea siempre la misma.
  diaOffset?: number;
}

function minutosAHora(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = Math.round(min % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function centroide(items: Establecimiento[]): { lat: number; lon: number } {
  const lat = items.reduce((s, e) => s + e.lat, 0) / items.length;
  const lon = items.reduce((s, e) => s + e.lon, 0) / items.length;
  return { lat, lon };
}

// Cuántas de las UPZ más desatendidas entran en la rotación diaria.
// El inspector no puede cubrir todas en un día: recorre las más urgentes en
// jornadas sucesivas, garantizando que ninguna supere el umbral de presencia.
const POOL_ROTACION = 5;

// Rankea las localidades por índice de desatención (mayor primero).
// Determinista: el mismo dataset siempre produce el mismo orden.
export function rankearLocalidades(data: Establecimiento[]): string[] {
  const porLoc = new Map<string, Establecimiento[]>();
  for (const e of data) {
    if (!porLoc.has(e.localidad)) porLoc.set(e.localidad, []);
    porLoc.get(e.localidad)!.push(e);
  }
  const rankeadas: { loc: string; indice: number }[] = [];
  for (const [loc, items] of porLoc) {
    if (items.length < 6) continue; // evitar localidades con muy pocos puntos
    const scorePromedio =
      items.reduce((s, e) => s + e.score, 0) / items.length;
    const dias = diasSinPresencia(loc);
    // Índice = riesgo (0..1) * 0.6 + desatención temporal (0..1) * 0.4
    const indice =
      (scorePromedio / 100) * 0.6 + Math.min(dias / 62, 1) * 0.4;
    rankeadas.push({ loc, indice });
  }
  rankeadas.sort((a, b) => b.indice - a.indice);
  return rankeadas.map((r) => r.loc);
}

// Elige la localidad foco. Por defecto la más desatendida (diaOffset=0); en
// jornadas sucesivas rota entre las POOL_ROTACION más urgentes para que la
// cobertura no se estanque en una sola UPZ.
function elegirLocalidadFoco(data: Establecimiento[], diaOffset = 0): string {
  const ranking = rankearLocalidades(data);
  if (ranking.length === 0) return "";
  const pool = Math.min(POOL_ROTACION, ranking.length);
  const idx = ((diaOffset % pool) + pool) % pool; // seguro ante offsets negativos
  return ranking[idx];
}

interface Seleccion {
  localidadFoco: string;
  base: { lat: number; lon: number };
  visitas: Establecimiento[]; // conjunto SIN ordenar (el orden lo decide el ruteo)
}

// PASO 1 — Selección determinista del conjunto de visitas del día.
// No decide orden ni horas: solo QUÉ establecimientos se visitan y desde dónde.
export function seleccionarParadas(
  data: Establecimiento[],
  opts: OpcionesAgenda = {}
): Seleccion | null {
  const localidadFoco =
    opts.localidadFoco ?? elegirLocalidadFoco(data, opts.diaOffset ?? 0);
  if (!localidadFoco) return null;

  const candidatos = data.filter((e) => e.localidad === localidadFoco);
  if (candidatos.length === 0) return null;

  const altos = candidatos
    .filter((e) => e.nivel_riesgo === "Critico" || e.nivel_riesgo === "Alto")
    .sort((a, b) => b.score - a.score);

  // Base del inspector: centroide de las anclas de alto riesgo del día.
  const anclas = altos.length ? altos.slice(0, 8) : candidatos.slice(0, 8);
  const base = centroide(anclas);

  // Verificaciones rápidas: bajo/medio riesgo más cercanas a la base (de paso).
  const rapidos = candidatos
    .filter((e) => e.nivel_riesgo === "Medio" || e.nivel_riesgo === "Bajo")
    .sort((a, b) => haversineKm(base, a) - haversineKm(base, b));

  // Dimensionar la selección a la jornada REAL: primero se llenan las
  // inspecciones de alto riesgo por prioridad (nunca se sacrifica un crítico por
  // una verificación de bajo riesgo), reservando espacio para un par de
  // verificaciones rápidas de paso. El presupuesto es el tiempo útil del día.
  const PRESUPUESTO_MIN =
    JORNADA_FIN_MIN -
    JORNADA_INICIO_MIN -
    (ALMUERZO_FIN_MIN - ALMUERZO_INICIO_MIN); // 480 min
  const VIAJE_ESTIMADO_MIN = 6; // por parada, para dimensionar (el real lo da OSRM)
  const maxVisitas = opts.maxVisitas ?? 12; // tope duro de seguridad

  const verifs = rapidos.slice(0, 2);
  const reservaVerif = verifs.reduce(
    (s, e) => s + duracionVisita(e) + VIAJE_ESTIMADO_MIN,
    0
  );

  let restante = PRESUPUESTO_MIN - reservaVerif;
  const inspecciones: Establecimiento[] = [];
  for (const e of altos) {
    if (inspecciones.length >= maxVisitas - verifs.length) break;
    const costo = duracionVisita(e) + VIAJE_ESTIMADO_MIN;
    if (inspecciones.length > 0 && restante - costo < 0) break; // al menos 1
    restante -= costo;
    inspecciones.push(e);
  }

  // Si la localidad no tiene alto riesgo, se agenda con las de menor riesgo.
  const visitas = inspecciones.length
    ? [...inspecciones, ...verifs]
    : rapidos.slice(0, 6);
  if (visitas.length === 0) return null;

  return { localidadFoco, base, visitas };
}

// Resultado del ruteo: orden final, tramos y trazado.
interface RutaOptimizada {
  orden: Establecimiento[]; // visitas en el orden de recorrido
  tramosKm: number[]; // distancia de cada tramo (base->1, 1->2, ...)
  tramosMin: number[]; // tiempo de viaje de cada tramo en minutos
  // Geometría de cada tramo por separado (base->1, 1->2, ...), para poder
  // recortar el trazado exactamente hasta la última parada que sí se agenda.
  tramosGeom: [number, number][][];
  rutaReal: boolean;
}

// PASO 2 — Ruteo real por calles con OSRM (/trip resuelve el TSP y devuelve
// la geometría). Lanza si la red falla, para que el orquestador use el fallback.
async function optimizarRutaReal(
  base: { lat: number; lon: number },
  visitas: Establecimiento[]
): Promise<RutaOptimizada> {
  const puntos = [base, ...visitas.map((e) => ({ lat: e.lat, lon: e.lon }))];
  const coords = puntos.map((p) => `${p.lon},${p.lat}`).join(";");
  const url =
    `${OSRM_BASE}/trip/v1/driving/${coords}` +
    `?source=first&roundtrip=false&steps=true&geometries=geojson&annotations=distance,duration`;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), OSRM_TIMEOUT_MS);
  let json: OsrmTripResponse;
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
    json = (await res.json()) as OsrmTripResponse;
  } finally {
    clearTimeout(t);
  }

  if (json.code !== "Ok" || !json.trips?.length || !json.waypoints?.length) {
    throw new Error(`OSRM code ${json.code}`);
  }

  const trip = json.trips[0];

  // waypoints[i] corresponde al punto de entrada i (0 = base, 1..N = visitas).
  // waypoint_index es su posición dentro del recorrido optimizado.
  const orden: Establecimiento[] = [];
  json.waypoints.forEach((w, i) => {
    if (i === 0) return; // la base ocupa la posición 0 y no es una parada
    orden[w.waypoint_index - 1] = visitas[i - 1];
  });
  const ordenLimpio = orden.filter(Boolean);

  // legs[k] = tramo entre la parada optimizada k y k+1 (empezando en la base).
  const tramosKm = trip.legs.map((l) => Math.round((l.distance / 1000) * 100) / 100);
  const tramosMin = trip.legs.map((l) => l.duration / 60);

  // Geometría por tramo: se concatenan los "steps" de cada leg (coordenadas de
  // OSRM vienen como [lon, lat]; Leaflet las quiere como [lat, lon]).
  const tramosGeom: [number, number][][] = trip.legs.map((l) => {
    const pts: [number, number][] = [];
    for (const s of l.steps) {
      for (const [lon, lat] of s.geometry.coordinates) pts.push([lat, lon]);
    }
    return pts;
  });

  return { orden: ordenLimpio, tramosKm, tramosMin, tramosGeom, rutaReal: true };
}

// Fallback — greedy nearest-neighbor por distancia en línea recta (haversine).
// Sin dependencia de red; trazado de segmentos rectos.
function optimizarRutaFallback(
  base: { lat: number; lon: number },
  visitas: Establecimiento[]
): RutaOptimizada {
  const pendientes = [...visitas];
  const orden: Establecimiento[] = [];
  const tramosKm: number[] = [];
  const tramosMin: number[] = [];
  const tramosGeom: [number, number][][] = [];
  let actual = base;

  while (pendientes.length) {
    let mejorIdx = 0;
    let mejorDist = Infinity;
    pendientes.forEach((e, i) => {
      const d = haversineKm(actual, e);
      if (d < mejorDist) {
        mejorDist = d;
        mejorIdx = i;
      }
    });
    const elegido = pendientes.splice(mejorIdx, 1)[0];
    orden.push(elegido);
    tramosKm.push(Math.round(mejorDist * 100) / 100);
    tramosMin.push((mejorDist / VELOCIDAD_URBANA_KMH) * 60);
    // Tramo recto entre el punto anterior y la parada elegida.
    tramosGeom.push([
      [actual.lat, actual.lon],
      [elegido.lat, elegido.lon],
    ]);
    actual = { lat: elegido.lat, lon: elegido.lon };
  }

  return { orden, tramosKm, tramosMin, tramosGeom, rutaReal: false };
}

// PASO 3 — Arma el itinerario final a partir de la ruta ya optimizada,
// respetando la jornada laboral: hora de inicio, bloque de almuerzo y tope de
// las 17:00. Las visitas que no alcancen se reportan como "omitidas".
function construirAgenda(
  sel: Seleccion,
  ruta: RutaOptimizada,
  horaInicioMin: number
): Agenda {
  const paradas: Parada[] = [];
  const geometria: [number, number][] = [];
  let reloj = horaInicioMin;
  let distanciaTotal = 0;
  let almuerzoTomado = false;
  let almuerzo: { inicio: string; fin: string } | null = null;
  let omitidas = 0;

  for (let i = 0; i < ruta.orden.length; i++) {
    const e = ruta.orden[i];
    const distKm = ruta.tramosKm[i] ?? 0;
    const viajeMin = ruta.tramosMin[i] ?? 0;
    let llegada = reloj + viajeMin;

    // Almuerzo: si la llegada cae en/después de las 12:00 y aún no se almorzó,
    // se toma el bloque (empujando la llegada a las 13:00 si cae dentro).
    if (!almuerzoTomado && llegada >= ALMUERZO_INICIO_MIN) {
      almuerzoTomado = true;
      almuerzo = {
        inicio: minutosAHora(ALMUERZO_INICIO_MIN),
        fin: minutosAHora(ALMUERZO_FIN_MIN),
      };
      if (llegada < ALMUERZO_FIN_MIN) llegada = ALMUERZO_FIN_MIN;
    }

    const dur = duracionVisita(e);
    // Tope de jornada: si la visita no termina antes de las 17:00, no se agenda
    // (ni ella ni las siguientes de la ruta).
    if (llegada + dur > JORNADA_FIN_MIN) {
      omitidas = ruta.orden.length - i;
      break;
    }

    distanciaTotal += distKm;
    // Trazado: se acumula solo el tramo de las paradas que sí se agendan.
    for (const p of ruta.tramosGeom[i] ?? []) geometria.push(p);

    reloj = llegada + dur;
    paradas.push({
      orden: paradas.length + 1,
      establecimiento: e,
      tipoVisita: tipoPorRiesgo(e.nivel_riesgo),
      distanciaKm: distKm,
      horaLlegada: minutosAHora(llegada),
      horaSalida: minutosAHora(reloj),
      duracionMin: dur,
    });
  }

  // Cada tramo ya empieza en el punto anterior, así que la geometría arranca en
  // la base; si no se agendó ninguna parada, al menos ancla la base.
  if (geometria.length === 0) geometria.push([sel.base.lat, sel.base.lon]);

  const dias = diasSinPresencia(sel.localidadFoco);
  return {
    localidadFoco: sel.localidadFoco,
    diasSinPresencia: dias,
    superaUmbral: dias > UMBRAL_PRESENCIA_DIAS,
    base: sel.base,
    paradas,
    geometria,
    rutaReal: ruta.rutaReal,
    resumen: {
      totalVisitas: paradas.length,
      criticos: paradas.filter((p) => p.establecimiento.nivel_riesgo === "Critico")
        .length,
      inspecciones: paradas.filter((p) => p.tipoVisita === "Inspección").length,
      verificaciones: paradas.filter((p) => p.tipoVisita === "Verificación rápida")
        .length,
      distanciaTotalKm: Math.round(distanciaTotal * 10) / 10,
      horaInicio: minutosAHora(horaInicioMin),
      horaFin: paradas.length
        ? paradas[paradas.length - 1].horaSalida
        : minutosAHora(horaInicioMin),
      omitidas,
      almuerzo,
    },
  };
}

// Orquestador — selección determinista + ruteo real (con fallback).
export async function generarAgenda(
  data: Establecimiento[],
  opts: OpcionesAgenda = {}
): Promise<Agenda | null> {
  const sel = seleccionarParadas(data, opts);
  if (!sel) return null;

  const horaInicioMin = opts.horaInicioMin ?? 480; // 08:00

  let ruta: RutaOptimizada;
  try {
    ruta = await optimizarRutaReal(sel.base, sel.visitas);
    // Si OSRM no devolvió todas las paradas, el itinerario quedaría incompleto:
    // preferimos el fallback consistente.
    if (ruta.orden.length !== sel.visitas.length) {
      throw new Error("OSRM devolvió paradas incompletas");
    }
  } catch {
    ruta = optimizarRutaFallback(sel.base, sel.visitas);
  }

  return construirAgenda(sel, ruta, horaInicioMin);
}

// --- Tipos mínimos de la respuesta de OSRM /trip que consumimos ---
interface OsrmTripResponse {
  code: string;
  waypoints?: { waypoint_index: number; trips_index: number }[];
  trips?: {
    legs: {
      distance: number;
      duration: number;
      steps: { geometry: { coordinates: [number, number][] } }[];
    }[];
  }[];
}
