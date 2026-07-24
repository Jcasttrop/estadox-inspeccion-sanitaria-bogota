// Motor de autovigilancia asistida (Eje 3 del reto).
//
// El establecimiento diligencia un checklist guiado ANTES de la visita del
// inspector. Cada hallazgo desfavorable suma "puntos de riesgo" que viven
// DENTRO del factor `resultado_anterior` (0-15) de la fórmula general del
// score. Si un módulo no se diligencia, se asume el máximo ("no autorreportado
// = riesgo no descartado").
//
// Los puntos por pregunta NO están hardcodeados: se derivan de los pesos de
// severidad de cada módulo, de la tabla de aplicabilidad por tipo de
// establecimiento y de la confiabilidad de la evidencia (una foto validada por
// IA pesa más que una declaración de texto). Es una función pura y auditable:
// mismos pesos -> mismos puntos.
//
// Propuesta de diseño, no estándar oficial de la Secretaría de Salud.

import {
  type Establecimiento,
  type DesgloseRiesgo,
  FACTOR_MAX,
  nivelDesdeScore,
} from "@/data/inspeccion";

// Total de puntos que reparte el autorreporte: es el máximo del factor
// `resultado_anterior` de la fórmula general.
export const PUNTOS_RESULTADO_ANTERIOR = 15;

// ---------------------------------------------------------------------------
// Tipos de establecimiento del autorreporte (5 perfiles con módulos distintos)
// ---------------------------------------------------------------------------
export type TipoAutorreporte = 1 | 2 | 3 | 4 | 5;

export const TIPO_AUTORREPORTE_LABEL: Record<TipoAutorreporte, string> = {
  1: "Jardín infantil / planta de procesamiento",
  2: "Consultorio odontológico / laboratorio clínico",
  3: "Restaurante / panadería / droguería",
  4: "Peluquería",
  5: "Tienda de barrio (sin manipulación de alimentos)",
};

// ---------------------------------------------------------------------------
// Módulos y pesos de severidad (fijos, antes de normalizar)
// ---------------------------------------------------------------------------
export type ModuloKey = "A" | "B" | "C" | "D" | "E" | "F" | "G";

export const MODULOS: Record<ModuloKey, { label: string; severidad: number }> = {
  A: { label: "Cadena de frío", severidad: 20 },
  B: { label: "Control de plagas", severidad: 18 },
  C: { label: "Manejo de residuos", severidad: 10 },
  D: { label: "Higiene del personal", severidad: 16 },
  E: { label: "Esterilización de instrumental", severidad: 20 },
  F: { label: "Registros y documentación", severidad: 8 },
  G: { label: "Infraestructura", severidad: 12 },
};

// Tabla de aplicabilidad: qué módulos aplican a cada tipo de establecimiento.
const APLICABILIDAD: Record<TipoAutorreporte, ModuloKey[]> = {
  1: ["A", "B", "C", "D", "F", "G"], // no aplica E
  2: ["B", "C", "D", "E", "F", "G"], // no aplica A
  3: ["A", "B", "C", "D", "F"], //       no aplican E ni G
  4: ["B", "C", "D", "E", "F", "G"], // no aplica A
  5: ["C", "F"], //                      riesgo bajo: checklist reducido
};

// ---------------------------------------------------------------------------
// Preguntas por módulo. `share` = fracción del puntaje del módulo que aporta
// cada pregunta (suma 1 por módulo). Las preguntas con foto validada por IA
// concentran más puntaje: la evidencia es más confiable.
// ---------------------------------------------------------------------------
export type TipoEvidencia = "foto-ia" | "numerico" | "texto" | "opcion";

export const EVIDENCIA_LABEL: Record<TipoEvidencia, string> = {
  "foto-ia": "Foto validada por IA",
  numerico: "Dato numérico",
  texto: "Declaración",
  opcion: "Selección",
};

// Rango válido para preguntas numéricas: un valor dentro del rango es favorable.
export interface RangoNumerico {
  min: number;
  max: number;
  unidad?: string;
}

// Opción concreta para preguntas de selección. Cada opción ya trae el estado
// que representa, así el establecimiento no vuelve a clasificar a mano.
export interface OpcionRespuesta {
  label: string;
  estado: "favorable" | "desfavorable";
}

export interface PreguntaDef {
  id: string; // estable entre tipos (p. ej. "A2")
  texto: string;
  ayudaIA?: string; // qué valida la IA / criterio de hallazgo desfavorable
  tipoEvidencia: TipoEvidencia;
  share: number;
  placeholder?: string; // sugerencia de escritura para numerico/texto
  rango?: RangoNumerico; // numerico: deriva el estado a partir del valor
  opciones?: OpcionRespuesta[]; // opcion: cada opción fija el estado
}

const PREGUNTAS: Record<ModuloKey, PreguntaDef[]> = {
  A: [
    {
      id: "A1",
      texto:
        "¿Cuál es la temperatura actual del refrigerador donde se almacenan los productos perecederos?",
      ayudaIA: "Hallazgo si está fuera del rango 0–4 °C.",
      tipoEvidencia: "numerico",
      share: 0.25,
      placeholder: "Ej. 3.5",
      rango: { min: 0, max: 4, unidad: "°C" },
    },
    {
      id: "A2",
      texto: "Tome una foto del termómetro junto al producto almacenado.",
      ayudaIA:
        "La IA valida número visible entre 0–4 °C y que crudos y cocidos no se mezclen.",
      tipoEvidencia: "foto-ia",
      share: 0.5,
    },
    {
      id: "A3",
      texto:
        "¿Hace cuánto se descongeló o falló la refrigeración por última vez, aunque haya sido breve?",
      ayudaIA:
        "Describa fecha, duración y qué productos se vieron afectados. Sin incidentes = marque En regla.",
      tipoEvidencia: "texto",
      share: 0.25,
      placeholder: "Ej. Hace 2 semanas, corte de luz de ~3 h; se descartó el pollo crudo.",
    },
  ],
  B: [
    {
      id: "B1",
      texto:
        "Fotografíe las zonas de almacenamiento de insumos y los rincones bajo estanterías.",
      ayudaIA:
        "La IA busca evidencia visual de excrementos, huevos, insectos o roedores.",
      tipoEvidencia: "foto-ia",
      share: 0.45,
    },
    {
      id: "B2",
      texto: "¿Cuándo fue la última fumigación y quién la realizó?",
      tipoEvidencia: "texto",
      share: 0.2,
      placeholder: "Ej. 12/05/2026, empresa Fumigax (registro sanitario 1234).",
    },
    {
      id: "B3",
      texto: "Suba la foto del certificado de la última fumigación.",
      ayudaIA: "La IA valida la fecha de vigencia.",
      tipoEvidencia: "foto-ia",
      share: 0.35,
    },
  ],
  C: [
    {
      id: "C1",
      texto:
        "Fotografíe el punto de disposición de residuos al final del día.",
      ayudaIA:
        "La IA valida canecas tapadas, separadas y sin desbordamiento (incluye cortopunzantes/biosanitarios si aplica).",
      tipoEvidencia: "foto-ia",
      share: 0.6,
    },
    {
      id: "C2",
      texto:
        "¿Cada cuánto se retiran los residuos del área de preparación o atención?",
      tipoEvidencia: "opcion",
      share: 0.4,
      opciones: [
        { label: "Varias veces al día", estado: "favorable" },
        { label: "Una vez al día, al cierre", estado: "favorable" },
        { label: "Cada 2–3 días", estado: "desfavorable" },
        { label: "Sin una frecuencia definida", estado: "desfavorable" },
      ],
    },
  ],
  D: [
    {
      id: "D1",
      texto: "Fotografíe al personal en su puesto de trabajo durante la jornada.",
      ayudaIA:
        "La IA valida uso de cofia/guantes/tapabocas, uñas cortas y ausencia de accesorios.",
      tipoEvidencia: "foto-ia",
      share: 0.55,
    },
    {
      id: "D2",
      texto:
        "¿Personal con síntomas gripales, gastrointestinales o de infección en piel/manos ha trabajado en los últimos 7 días?",
      tipoEvidencia: "opcion",
      share: 0.45,
      opciones: [
        { label: "No, ninguno", estado: "favorable" },
        {
          label: "Sí, pero fue reubicado sin contacto con producto",
          estado: "desfavorable",
        },
        { label: "Sí, siguió en su puesto habitual", estado: "desfavorable" },
      ],
    },
  ],
  E: [
    {
      id: "E1",
      texto:
        "Fotografíe el indicador biológico/químico del último ciclo de autoclave o desinfección.",
      ayudaIA: "La IA valida si el indicador cambió de color correctamente.",
      tipoEvidencia: "foto-ia",
      share: 0.7,
    },
    {
      id: "E2",
      texto: "¿Cuántos ciclos de esterilización/desinfección se corrieron hoy?",
      ayudaIA:
        "Registre el número de ciclos. Cero ciclos en jornada con instrumental en uso = marque Hallazgo.",
      tipoEvidencia: "numerico",
      share: 0.3,
      placeholder: "Ej. 3",
    },
  ],
  F: [
    {
      id: "F1",
      texto:
        "Fotografíe la última página diligenciada del libro de limpieza/temperatura/esterilización.",
      ayudaIA:
        "La IA valida campos en blanco o letra que sugiera llenado retroactivo.",
      tipoEvidencia: "foto-ia",
      share: 0.6,
    },
    {
      id: "F2",
      texto:
        "¿Quién diligencia estos registros: el mismo responsable siempre o rota entre el personal?",
      tipoEvidencia: "opcion",
      share: 0.4,
      opciones: [
        {
          label: "Un responsable designado, siempre el mismo",
          estado: "favorable",
        },
        { label: "Rota entre personal capacitado", estado: "favorable" },
        { label: "Cualquiera, sin un control definido", estado: "desfavorable" },
        { label: "No se lleva registro escrito", estado: "desfavorable" },
      ],
    },
  ],
  G: [
    {
      id: "G1",
      texto:
        "Fotografíe el sistema de drenaje del área o el lavamanos de atención.",
      ayudaIA:
        "La IA valida estancamiento de agua, ausencia de jabón/toallas y grietas.",
      tipoEvidencia: "foto-ia",
      share: 0.65,
    },
    {
      id: "G2",
      texto:
        "¿Ha habido cortes de agua en el último mes? ¿Cómo se manejó la operación durante ese corte?",
      ayudaIA: "Sin cortes = marque En regla.",
      tipoEvidencia: "texto",
      share: 0.35,
      placeholder:
        "Ej. Un corte de 4 h; se usó tanque de reserva de 500 L y gel antibacterial.",
    },
  ],
};

// ---------------------------------------------------------------------------
// Cálculo del puntaje (fórmula de normalización auditable)
// ---------------------------------------------------------------------------
export function modulosAplicables(tipo: TipoAutorreporte): ModuloKey[] {
  return APLICABILIDAD[tipo];
}

// Puntos normalizados por módulo:
//   puntos_modulo = (peso_modulo / Σ pesos aplicables) × 15
export function puntosPorModulo(
  tipo: TipoAutorreporte
): Record<ModuloKey, number> {
  const keys = APLICABILIDAD[tipo];
  const suma = keys.reduce((s, k) => s + MODULOS[k].severidad, 0);
  const out = {} as Record<ModuloKey, number>;
  for (const k of keys) {
    out[k] = (MODULOS[k].severidad / suma) * PUNTOS_RESULTADO_ANTERIOR;
  }
  return out;
}

export interface PreguntaCalculada extends PreguntaDef {
  modulo: ModuloKey;
  puntos: number; // puntos de riesgo que suma si el hallazgo es desfavorable
}

export interface ModuloCalculado {
  key: ModuloKey;
  label: string;
  severidad: number;
  puntosModulo: number;
  preguntas: PreguntaCalculada[];
}

// Estructura completa de la encuesta para un tipo, con los puntos ya repartidos.
export function encuestaParaTipo(tipo: TipoAutorreporte): ModuloCalculado[] {
  const pm = puntosPorModulo(tipo);
  return APLICABILIDAD[tipo].map((k) => ({
    key: k,
    label: MODULOS[k].label,
    severidad: MODULOS[k].severidad,
    puntosModulo: pm[k],
    preguntas: PREGUNTAS[k].map((p) => ({
      ...p,
      modulo: k,
      puntos: pm[k] * p.share,
    })),
  }));
}

// Estado de cada respuesta. "sin_dato" (aún no reportado) cuenta como riesgo:
// mientras el establecimiento no demuestre lo contrario, se asume el peor caso.
export type EstadoRespuesta = "favorable" | "desfavorable" | "sin_dato";

// Cada respuesta guarda el estado (que alimenta el score) y, cuando aplica, el
// valor crudo declarado: número, texto o la etiqueta de la opción elegida.
export interface RespuestaValor {
  estado: EstadoRespuesta;
  valor?: string | number;
}

export type Respuestas = Record<string, RespuestaValor>;

// Deriva el estado de una pregunta numérica: dentro del rango = favorable.
export function estadoDesdeNumero(
  rango: RangoNumerico,
  valor: number
): EstadoRespuesta {
  return valor >= rango.min && valor <= rango.max ? "favorable" : "desfavorable";
}

// ---------------------------------------------------------------------------
// Confianza asimétrica: una respuesta "favorable" NO vale lo mismo si viene con
// prueba verificable que si es solo una declaración. Principio del Reto 4: el
// autorreporte no verificado puede subir el riesgo, pero solo puede BAJARLO de
// forma parcial y provisional; la reducción plena exige evidencia (foto IA hoy;
// visita del inspector / concepto sanitario en producción). Así, marcar "todo en
// regla" a punta de texto nunca lleva el riesgo a cero: mentir no limpia.
// ---------------------------------------------------------------------------

// Crédito que otorga una respuesta favorable SOLO declarada (sin foto): limpia
// esta fracción de sus puntos; el resto queda como riesgo residual sin verificar.
export const CREDITO_DECLARADO = 0.5;

// Fracción de puntos que una respuesta favorable limpia, según su evidencia.
// La foto validada por IA es verificable -> crédito pleno.
export function creditoFavorable(tipoEvidencia: TipoEvidencia): number {
  return tipoEvidencia === "foto-ia" ? 1 : CREDITO_DECLARADO;
}

export interface DesgloseAutorreporte {
  total: number; // riesgo final que alimenta `resultado_anterior` (0-15)
  verificado: number; // puntos de riesgo removidos con evidencia (foto IA)
  provisional: number; // riesgo residual de favorables solo declarados
  itemsVerificados: number; // # de favorables con foto
  itemsProvisionales: number; // # de favorables solo declarados
}

// Desglosa el resultado distinguiendo lo verificado de lo solo prometido.
export function desglosarAutorreporte(
  tipo: TipoAutorreporte,
  respuestas: Respuestas
): DesgloseAutorreporte {
  let total = 0;
  let verificado = 0;
  let provisional = 0;
  let itemsVerificados = 0;
  let itemsProvisionales = 0;

  for (const m of encuestaParaTipo(tipo)) {
    for (const p of m.preguntas) {
      const estado = respuestas[p.id]?.estado ?? "sin_dato";
      if (estado !== "favorable") {
        // Desfavorable o sin reportar: cuenta el riesgo completo.
        total += p.puntos;
        continue;
      }
      const credito = creditoFavorable(p.tipoEvidencia);
      const removido = p.puntos * credito; // riesgo que esta respuesta limpia
      const residual = p.puntos - removido; // lo que queda sin verificar
      total += residual;
      if (credito >= 1) {
        verificado += removido;
        itemsVerificados += 1;
      } else {
        provisional += residual;
        itemsProvisionales += 1;
      }
    }
  }

  return {
    total: Math.min(PUNTOS_RESULTADO_ANTERIOR, total),
    verificado,
    provisional,
    itemsVerificados,
    itemsProvisionales,
  };
}

// Suma de puntos de riesgo -> factor `resultado_anterior` (0-15). Delegado en
// `desglosarAutorreporte` para respetar la confianza asimétrica por evidencia.
export function calcularResultadoAnterior(
  tipo: TipoAutorreporte,
  respuestas: Respuestas
): number {
  return desglosarAutorreporte(tipo, respuestas).total;
}

// ---------------------------------------------------------------------------
// Mapeo de la categoría OSM real -> tipo de autorreporte
// ---------------------------------------------------------------------------
const CATEGORIA_TIPO: Record<string, TipoAutorreporte> = {
  "Jardin infantil": 1,
  "Consultorio medico": 2,
  "Consultorio odontologico": 2,
  "Clinica / laboratorio": 2,
  Restaurante: 3,
  "Comida rapida": 3,
  Panaderia: 3,
  Drogueria: 3,
  Cafe: 3,
  Supermercado: 3,
  Carniceria: 3,
  Fruver: 3,
  Bar: 3,
  "Bar de jugos": 3,
  Peluqueria: 4,
  "Tienda de barrio": 5,
  "Cafe internet": 5,
  Gimnasio: 5,
};

export function tipoDesdeCategoria(categoria: string): TipoAutorreporte {
  return CATEGORIA_TIPO[categoria] ?? 3;
}

// ---------------------------------------------------------------------------
// Reporte ciudadano: cada reporte suma al factor `quejas_ciudadanas` (tope 12).
// ---------------------------------------------------------------------------
export const INCREMENTO_QUEJA_CIUDADANA = 3;

// ---------------------------------------------------------------------------
// Recálculo en vivo del score por modelo delta.
// Como el desglose original no expone su fórmula inversa, sustituimos solo el
// factor tocado y re-derivamos score y nivel con los umbrales oficiales:
//   score' = score − factor_viejo + factor_nuevo
// Es honesto y auditable: no reconstruye factores que no cambiaron.
// ---------------------------------------------------------------------------
export function recalcularConFactor(
  e: Establecimiento,
  factor: keyof DesgloseRiesgo,
  nuevoValor: number
): Establecimiento {
  const valor = Math.min(FACTOR_MAX[factor], Math.max(0, nuevoValor));
  const desglose = { ...e.desglose, [factor]: valor };
  const score = Math.min(100, Math.max(0, e.score - e.desglose[factor] + valor));
  return { ...e, desglose, score, nivel_riesgo: nivelDesdeScore(score) };
}
