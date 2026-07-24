// Tipos y configuración para el módulo de Inspección Sanitaria Inteligente (Bogotá).
// Las ubicaciones y tipos de establecimiento son reales (OpenStreetMap).
// El historial sanitario y el puntaje de riesgo están simulados con una
// fórmula ponderada transparente y auditable (no es un modelo caja negra).

export type NivelRiesgo = "Critico" | "Alto" | "Medio" | "Bajo";

export interface DesgloseRiesgo {
  tipo_establecimiento: number;
  antiguedad_concepto: number;
  tiempo_sin_visita: number;
  resultado_anterior: number;
  quejas_ciudadanas: number;
  poblacion_vulnerable: number;
}

export interface Establecimiento {
  id: number;
  nombre: string;
  categoria: string;
  lat: number;
  lon: number;
  localidad: string;
  score: number;
  nivel_riesgo: NivelRiesgo;
  poblacion_vulnerable: boolean;
  concepto_vencido: boolean;
  dias_desde_concepto: number;
  num_visitas: number;
  dias_ultima_visita: number | null;
  resultado_previo: string | null;
  quejas_12m: number;
  desglose: DesgloseRiesgo;
  razones: string[];
}

export const NIVEL_CONFIG: Record<
  NivelRiesgo,
  { label: string; color: string; borderColor: string }
> = {
  Critico: { label: "Crítico", color: "#dc2626", borderColor: "#7f1d1d" },
  Alto: { label: "Alto", color: "#f97316", borderColor: "#9a3412" },
  Medio: { label: "Medio", color: "#eab308", borderColor: "#854d0e" },
  Bajo: { label: "Bajo", color: "#16a34a", borderColor: "#14532d" },
};

export const NIVELES_ORDEN: NivelRiesgo[] = ["Critico", "Alto", "Medio", "Bajo"];

// Etiquetas legibles para cada factor del desglose del puntaje.
export const FACTOR_LABEL: Record<keyof DesgloseRiesgo, string> = {
  tipo_establecimiento: "Tipo de establecimiento",
  antiguedad_concepto: "Antigüedad del concepto",
  tiempo_sin_visita: "Tiempo sin visita",
  resultado_anterior: "Resultado visita anterior",
  quejas_ciudadanas: "Quejas ciudadanas",
  poblacion_vulnerable: "Población vulnerable",
};

// Puntaje máximo posible de cada factor (para dibujar las barras del desglose).
export const FACTOR_MAX: Record<keyof DesgloseRiesgo, number> = {
  tipo_establecimiento: 30,
  antiguedad_concepto: 20,
  tiempo_sin_visita: 15,
  resultado_anterior: 15,
  quejas_ciudadanas: 12,
  poblacion_vulnerable: 8,
};

export const FUENTE_INSPECCION =
  "Ubicaciones y tipos: OpenStreetMap (reales). Historial sanitario y puntaje de riesgo: simulados con fórmula ponderada auditable — demostración Hackathon EstadoX.";

// Umbrales de nivel derivados del dataset (ver §8.1 de la propuesta).
// Se ordenan de mayor a menor para derivar el nivel a partir del score.
export const UMBRALES_NIVEL: { min: number; nivel: NivelRiesgo }[] = [
  { min: 65, nivel: "Critico" },
  { min: 45, nivel: "Alto" },
  { min: 25, nivel: "Medio" },
  { min: 0, nivel: "Bajo" },
];

// Deriva el nivel de riesgo a partir del score (0-100). Se usa para recalcular
// el nivel en vivo cuando un autorreporte o un reporte ciudadano cambia el score.
export function nivelDesdeScore(score: number): NivelRiesgo {
  return (UMBRALES_NIVEL.find((u) => score >= u.min) ?? UMBRALES_NIVEL[3]).nivel;
}
