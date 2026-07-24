// Reporte de visita del inspector y comparación "predicho vs encontrado".
//
// Cierra el ciclo del reto: el modelo PRIORIZA (score de riesgo) -> el inspector
// VISITA y registra hallazgos reales -> se COMPARA lo encontrado contra lo que el
// modelo había previsto. Ese contraste es la señal para calibrar el modelo.
//
// Reutiliza el motor auditable del autorreporte (módulos A–G y sus puntos), pero
// aquí quien diligencia es el INSPECTOR con hallazgos reales de campo. La suma de
// hallazgos produce un "resultado de inspección" (0–15) en la MISMA escala del
// factor `resultado_anterior`, así el score post-visita es directamente comparable.

import type { Establecimiento, NivelRiesgo } from "@/data/inspeccion";
import {
  type ModuloKey,
  MODULOS,
  modulosAplicables,
  puntosPorModulo,
  tipoDesdeCategoria,
  recalcularConFactor,
  PUNTOS_RESULTADO_ANTERIOR,
} from "@/lib/autorreporte";

// Estado que el inspector marca por módulo durante la visita.
//  conforme   -> cumple, no suma riesgo
//  hallazgo   -> incumplimiento observado, suma los puntos del módulo
//  no_aplica  -> el módulo no aplica a este establecimiento (se excluye)
export type EstadoModulo = "conforme" | "hallazgo" | "no_aplica";

export interface GravedadReal {
  label: string;
  rank: number; // 0..3, comparable con el nivel de riesgo predicho
  color: string;
}

export type TipoVeredicto = "acierto" | "sobrestimado" | "subestimado";

export interface Veredicto {
  tipo: TipoVeredicto;
  label: string;
  detalle: string;
  color: string;
}

export interface ResultadoVisita {
  establecimientoId: number;
  estados: Record<string, EstadoModulo>;
  resultadoInspeccion: number; // 0–15, escala del factor resultado_anterior
  hallazgos: { key: ModuloKey; label: string }[];
  gravedadReal: GravedadReal;
  nivelPredicho: NivelRiesgo;
  veredicto: Veredicto;
  scoreAntes: number;
  scoreDespues: number;
  establecimientoActualizado: Establecimiento;
}

const RANK_NIVEL: Record<NivelRiesgo, number> = {
  Bajo: 0,
  Medio: 1,
  Alto: 2,
  Critico: 3,
};

// Clasifica la gravedad REAL a partir de los puntos de hallazgo acumulados.
function clasificarGravedad(resultado: number, numHallazgos: number): GravedadReal {
  if (numHallazgos === 0)
    return { label: "Sin hallazgos", rank: 0, color: "#16a34a" };
  if (resultado <= 5)
    return { label: "Hallazgos menores", rank: 1, color: "#eab308" };
  if (resultado <= 10)
    return { label: "Hallazgos graves", rank: 2, color: "#f97316" };
  return { label: "Incumplimientos críticos", rank: 3, color: "#dc2626" };
}

// Contrasta el nivel de riesgo PREDICHO por el modelo con la gravedad ENCONTRADA.
function evaluarVeredicto(predicho: NivelRiesgo, rankReal: number): Veredicto {
  const rp = RANK_NIVEL[predicho];
  if (rankReal > rp) {
    return {
      tipo: "subestimado",
      label: "Modelo subestimó",
      detalle:
        "La realidad fue más grave que el riesgo previsto: caso para reforzar el modelo.",
      color: "#dc2626",
    };
  }
  if (rp - rankReal >= 2) {
    return {
      tipo: "sobrestimado",
      label: "Modelo sobrestimó",
      detalle:
        "El modelo priorizó por encima de lo encontrado: posible falso positivo.",
      color: "#2563eb",
    };
  }
  return {
    tipo: "acierto",
    label: "Predicción acertada",
    detalle: "Lo encontrado en campo coincide con el riesgo que el modelo previó.",
    color: "#16a34a",
  };
}

// Estado inicial del reporte: todos los módulos aplicables arrancan "conforme".
export function estadoInicialVisita(e: Establecimiento): Record<string, EstadoModulo> {
  const tipo = tipoDesdeCategoria(e.categoria);
  const out: Record<string, EstadoModulo> = {};
  for (const k of modulosAplicables(tipo)) out[k] = "conforme";
  return out;
}

// Evalúa el reporte de visita: puntos, gravedad, veredicto y score recalculado.
export function evaluarVisita(
  e: Establecimiento,
  estados: Record<string, EstadoModulo>
): ResultadoVisita {
  const tipo = tipoDesdeCategoria(e.categoria);
  const aplicables = modulosAplicables(tipo);
  const pm = puntosPorModulo(tipo);

  let suma = 0;
  const hallazgos: { key: ModuloKey; label: string }[] = [];
  for (const k of aplicables) {
    if (estados[k] === "hallazgo") {
      suma += pm[k];
      hallazgos.push({ key: k, label: MODULOS[k].label });
    }
  }
  const resultadoInspeccion =
    Math.round(Math.min(PUNTOS_RESULTADO_ANTERIOR, suma) * 10) / 10;

  const gravedadReal = clasificarGravedad(resultadoInspeccion, hallazgos.length);
  const nivelPredicho = e.nivel_riesgo;
  const veredicto = evaluarVeredicto(nivelPredicho, gravedadReal.rank);
  const establecimientoActualizado = recalcularConFactor(
    e,
    "resultado_anterior",
    resultadoInspeccion
  );

  return {
    establecimientoId: e.id,
    estados,
    resultadoInspeccion,
    hallazgos,
    gravedadReal,
    nivelPredicho,
    veredicto,
    scoreAntes: Math.round(e.score),
    scoreDespues: Math.round(establecimientoActualizado.score),
    establecimientoActualizado,
  };
}
