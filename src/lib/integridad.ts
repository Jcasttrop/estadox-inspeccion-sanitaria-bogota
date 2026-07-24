// Capa de integridad anti-envenenamiento (Reto 4) — pieza mínima aplicada al
// autorreporte.
//
// El envenenamiento del algoritmo consiste en inyectar datos falsos (aquí: un
// autorreporte "todo en regla") para que un establecimiento insalubre baje su
// score y evite la inspección. La defensa no depende de confiar en el
// autorreporte, sino de CRUZARLO con fuentes que el establecimiento NO controla:
// SIVIGILA (ETA), urgencias por síntomas gastrointestinales y quejas ciudadanas,
// ya agregadas como clusters de brote en `brotes.ts`.
//
// Regla `seguro-bajo-brote`: si un establecimiento se presenta como seguro pero
// es la fuente probable de un cluster epidemiológico activo, hay contradicción
// crítica. Evadirla exigiría envenenar además los datos de salud reales — que no
// están bajo el control del atacante. Función pura y determinista.
//
// Propuesta de diseño (spec: docs/superpowers/specs/2026-07-23-integridad-anti-
// envenenamiento-design.md), no estándar oficial de la Secretaría de Salud.

import type { Establecimiento } from "@/data/inspeccion";
import type { Cluster } from "@/lib/brotes";

export interface ContradiccionBrote {
  cluster: Cluster;
  numCasos: number;
  ventanaHoras: number;
  // Desglose de casos por fuente independiente, para el mensaje al jurado.
  porFuente: Cluster["porFuente"];
}

// Devuelve la contradicción si el establecimiento es la fuente probable de un
// cluster activo; null si no hay conflicto. Es la regla `seguro-bajo-brote`.
export function contradiccionSeguroBajoBrote(
  e: Establecimiento,
  clusters: Cluster[]
): ContradiccionBrote | null {
  const cluster = clusters.find((c) => c.fuenteProbable?.id === e.id);
  if (!cluster) return null;
  return {
    cluster,
    numCasos: cluster.numCasos,
    ventanaHoras: cluster.ventanaHoras,
    porFuente: cluster.porFuente,
  };
}
