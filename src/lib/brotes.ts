// Motor de detección de clusters de brotes (Eje 4 del reto).
//
// Cruza tres fuentes de señal epidemiológica georreferenciada —SIVIGILA (ETA),
// urgencias por síntoma gastrointestinal y quejas ciudadanas— para detectar
// concentraciones geográficas anómalas ANTES de que el brote escale, y proponer
// el establecimiento de mayor riesgo dentro del foco como "fuente probable".
//
// Todo es determinista (mismos datos -> mismos casos y clusters): la demo es
// reproducible y el resultado es defendible/auditable. Los casos están
// simulados alrededor de los establecimientos de mayor riesgo; en producción
// vendrían de los reportes reales de SIVIGILA, urgencias y `/reportar`.

import type { Establecimiento } from "@/data/inspeccion";
import { haversineKm } from "@/lib/agenda";

export const VENTANA_HORAS = 72; // ventana de vigilancia del brote
export const RADIO_CLUSTER_KM = 0.4; // radio de agrupamiento espacial
export const MIN_CASOS = 4; // casos mínimos para declarar un cluster
const RADIO_FUENTE_KM = 0.4; // radio para buscar la fuente probable
const RADIO_DISPERSION_KM = 0.3; // dispersión de los casos alrededor del foco

export type FuenteCaso = "SIVIGILA" | "Urgencias" | "Queja ciudadana";

export const FUENTES_CASO: FuenteCaso[] = [
  "SIVIGILA",
  "Urgencias",
  "Queja ciudadana",
];

export const FUENTE_CASO_CONFIG: Record<FuenteCaso, { color: string; label: string }> =
  {
    SIVIGILA: { color: "#7c3aed", label: "SIVIGILA (ETA)" },
    Urgencias: { color: "#db2777", label: "Urgencias GI" },
    "Queja ciudadana": { color: "#2563eb", label: "Queja ciudadana" },
  };

export interface CasoEpidemiologico {
  id: string;
  lat: number;
  lon: number;
  fuente: FuenteCaso;
  horasAtras: number; // dentro de la ventana de vigilancia
}

export interface Cluster {
  id: number;
  centro: { lat: number; lon: number };
  radioKm: number;
  numCasos: number;
  casos: CasoEpidemiologico[];
  porFuente: Record<FuenteCaso, number>;
  fuenteProbable: Establecimiento | null;
  localidad: string;
  ventanaHoras: number;
}

// Generador congruencial lineal: pseudoaleatorio pero determinista por semilla.
function lcg(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function kmToDegLat(km: number): number {
  return km / 111;
}
function kmToDegLon(km: number, lat: number): number {
  return km / (111 * Math.cos((lat * Math.PI) / 180));
}

// Genera los casos epidemiológicos simulados: focos densos alrededor de los
// establecimientos de mayor riesgo + ruido aislado que NO debe agruparse
// (demuestra que el algoritmo discrimina señal de fondo).
export function generarCasos(data: Establecimiento[]): CasoEpidemiologico[] {
  if (data.length === 0) return [];
  const epicentros = [...data].sort((a, b) => b.score - a.score).slice(0, 3);
  const casos: CasoEpidemiologico[] = [];

  epicentros.forEach((ep) => {
    const rnd = lcg(ep.id + 1);
    const n = 6 + Math.floor(rnd() * 5); // 6..10 casos por foco
    for (let i = 0; i < n; i++) {
      const ang = rnd() * Math.PI * 2;
      const dist = rnd() * RADIO_DISPERSION_KM;
      casos.push({
        id: `c-${ep.id}-${i}`,
        lat: ep.lat + kmToDegLat(dist * Math.sin(ang)),
        lon: ep.lon + kmToDegLon(dist * Math.cos(ang), ep.lat),
        fuente: FUENTES_CASO[Math.floor(rnd() * FUENTES_CASO.length)],
        horasAtras: Math.floor(rnd() * VENTANA_HORAS),
      });
    }
  });

  // Ruido: casos aislados repartidos por la ciudad (no forman cluster).
  const orden = [...data].sort((a, b) => a.id - b.id);
  const rn = lcg(98765);
  for (let i = 0; i < 8; i++) {
    const e = orden[Math.floor(rn() * orden.length)];
    casos.push({
      id: `n-${i}`,
      lat: e.lat,
      lon: e.lon,
      fuente: FUENTES_CASO[Math.floor(rn() * FUENTES_CASO.length)],
      horasAtras: Math.floor(rn() * VENTANA_HORAS),
    });
  }

  return casos;
}

// Detecta clusters por densidad espacial (agrupamiento tipo DBSCAN simplificado)
// y asigna a cada uno la fuente probable (mayor riesgo dentro del radio).
export function detectarClusters(
  casos: CasoEpidemiologico[],
  data: Establecimiento[]
): Cluster[] {
  const usados = new Set<string>();
  const clusters: Cluster[] = [];

  // Se procesan primero los casos con más vecinos (núcleos más densos).
  const porDensidad = casos
    .map((c) => ({
      c,
      vecinos: casos.filter((o) => haversineKm(c, o) <= RADIO_CLUSTER_KM).length,
    }))
    .sort((a, b) => b.vecinos - a.vecinos || a.c.id.localeCompare(b.c.id));

  for (const { c } of porDensidad) {
    if (usados.has(c.id)) continue;
    const miembros = casos.filter(
      (o) => !usados.has(o.id) && haversineKm(c, o) <= RADIO_CLUSTER_KM
    );
    if (miembros.length < MIN_CASOS) continue;
    miembros.forEach((m) => usados.add(m.id));

    const centro = {
      lat: miembros.reduce((s, m) => s + m.lat, 0) / miembros.length,
      lon: miembros.reduce((s, m) => s + m.lon, 0) / miembros.length,
    };
    const radioKm = Math.max(...miembros.map((m) => haversineKm(centro, m)));

    const porFuente: Record<FuenteCaso, number> = {
      SIVIGILA: 0,
      Urgencias: 0,
      "Queja ciudadana": 0,
    };
    miembros.forEach((m) => porFuente[m.fuente]++);

    // Fuente probable: establecimiento de mayor score dentro del radio del foco.
    const cercanos = data.filter(
      (e) => haversineKm(centro, e) <= RADIO_FUENTE_KM
    );
    const fuenteProbable = cercanos.length
      ? cercanos.reduce((best, e) => (e.score > best.score ? e : best))
      : null;

    clusters.push({
      id: clusters.length + 1,
      centro,
      radioKm,
      numCasos: miembros.length,
      casos: miembros,
      porFuente,
      fuenteProbable,
      localidad: fuenteProbable?.localidad ?? "—",
      ventanaHoras: VENTANA_HORAS,
    });
  }

  return clusters.sort((a, b) => b.numCasos - a.numCasos);
}
