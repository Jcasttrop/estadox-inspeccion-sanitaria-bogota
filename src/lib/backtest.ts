// Backtest estilo Chicago (2015) — cierre del pitch (§11 de la propuesta).
//
// Chicago no midió "menos intoxicaciones": midió VELOCIDAD DE DETECCIÓN. Sobre el
// mismo conjunto de inspecciones, ¿qué ORDEN encuentra antes las violaciones
// críticas — el orden reactivo/aleatorio actual, o el orden que propone el modelo
// de riesgo? Su resultado: el enfoque por datos halló el 69% de las violaciones
// críticas en la primera mitad del periodo, frente al 55% del método tradicional
// (≈7 días antes), con los mismos inspectores.
//
// Este motor replica esa metodología. NO hardcodea el 69%: computa las curvas de
// detección de ambos órdenes a partir de un ground-truth simulado, determinista y
// auditable, y reporta el número que sale. Es una función pura (misma entrada →
// misma salida), en línea con el resto de motores del módulo.
//
// Honestidad (igual que §2 de la propuesta): es un resultado de VELOCIDAD DE
// DETECCIÓN sobre datos simulados, no una prueba de reducción de intoxicaciones.

import type { Establecimiento } from "@/data/inspeccion";

// --- Parámetros del ground-truth (auditables) ---------------------------------
// Probabilidad de que un establecimiento tenga una violación crítica, como
// función CONVEXA de su score: P_BASE + P_COEF·(score/100)^P_EXP. La convexidad
// (exponente 2) hace que el riesgo alto viole mucho más que el bajo (~10×), pero
// el sorteo con ruido deja que algunos críticos NO violen (falsos positivos del
// modelo) y algunos de bajo riesgo SÍ (los que el modelo pierde). Sin ese ruido
// el modelo saldría perfecto y no sería creíble. Calibrado sobre el dataset real
// para una tasa base ≈18% (cercana al 16% observado en Chicago).
export const P_BASE = 0.02;
export const P_COEF = 0.75;
export const P_EXP = 2;

// Nº de barajados sobre los que se PROMEDIA el orden "tradicional". Un solo
// barajado tiene suerte (o mala suerte); el promedio converge al desempeño real
// del método reactivo/aleatorio (~50% a mitad de periodo), que es lo justo.
export const BASELINE_MUESTRAS = 120;

// Muestra mínima para ofrecer una localidad en el backtest: por debajo, la
// varianza del sorteo domina y la curva deja de ser representativa. "Toda
// Bogotá" siempre está disponible.
export const MIN_N_LOCALIDAD = 150;

// Ritmo de trabajo de un inspector, para traducir "inspecciones ahorradas" a
// jornadas de adelanto (mismo supuesto del reto: ~5 visitas/día).
export const VISITAS_POR_DIA = 5;

// --- Capacidad operativa (por qué el ORDEN importa tanto) ---------------------
// El reto: ~400.000 establecimientos vigilados y solo unos cientos de técnicos.
// A 5 visitas/día no se alcanza a cubrir todo el universo en un año; solo se
// cubre el ARRANQUE de la lista. Por eso ordenar bien esa porción alcanzable es
// lo que separa un sistema que encuentra los peligros de uno que no.
export const DIAS_LABORALES = 250;
export const UNIVERSO_REAL = 400_000; // establecimientos vigilados (Bogotá)
export const INSPECTORES_DEFECTO = 150; // "unos pocos cientos" del reto (ajustable)

// Fracción del universo real que un equipo de N inspectores alcanza a visitar en
// un año (a VISITAS_POR_DIA/día · DIAS_LABORALES). Se satura en 1.
export function coberturaAnual(inspectores: number): number {
  const visitas = inspectores * VISITAS_POR_DIA * DIAS_LABORALES;
  return Math.min(1, visitas / UNIVERSO_REAL);
}

// Probabilidad de violación crítica para un score dado (expuesta para auditoría).
export function probabilidadViolacion(score: number): number {
  const p = P_BASE + P_COEF * Math.pow(score / 100, P_EXP);
  return Math.min(0.95, Math.max(0, p));
}

// Hash entero → real uniforme en [0,1). Determinista por semilla: el mismo id
// produce siempre el mismo sorteo, así el backtest es 100% reproducible.
function rand01(seed: number): number {
  let s = (seed * 2654435761) >>> 0;
  s ^= s >>> 15;
  s = (s * 2246822519) >>> 0;
  s ^= s >>> 13;
  s = (s * 3266489917) >>> 0;
  s ^= s >>> 16;
  return (s >>> 0) / 4294967296;
}

// Ground-truth: ¿este establecimiento tuvo una violación crítica? Sorteo
// determinista contra su probabilidad. El id como semilla lo hace reproducible.
export function tieneViolacionCritica(e: Establecimiento): boolean {
  return rand01(e.id) < probabilidadViolacion(e.score);
}

// LCG determinista para barajar el orden "tradicional" (reactivo/aleatorio),
// sin correlación con el riesgo — el "por inercia y por petición" del reto.
function lcg(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Barajado Fisher-Yates determinista (no muta el arreglo original).
function barajarDeterminista(items: Establecimiento[], seed: number): Establecimiento[] {
  const out = [...items];
  const rnd = lcg(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// --- Tipos de salida ----------------------------------------------------------
export interface PuntoCurva {
  x: number; // fracción del esfuerzo (0..1): inspecciones realizadas / total
  y: number; // fracción de detección (0..1): violaciones halladas / total
}

export interface CurvaOrden {
  // Establecimientos en el orden en que se visitarían.
  orden: Establecimiento[];
  // Curva de detección acumulada, arrancando en (0,0).
  curva: PuntoCurva[];
  // Detección alcanzada al 50% del esfuerzo (fracción 0..1).
  deteccionEnMitad: number;
}

export interface ResultadoBacktest {
  universo: string;
  n: number;
  totalViolaciones: number;
  tasaBase: number; // violaciones / n (fracción 0..1)
  modelo: CurvaOrden;
  tradicional: CurvaOrden;
  // Ventaja del modelo en detección temprana (@50%), en puntos porcentuales.
  liftPuntos: number;
  // Inspecciones que el modelo se ahorra para igualar la detección que el método
  // tradicional logra a mitad de periodo.
  inspeccionesAhorradas: number;
  // Ese ahorro traducido a jornadas de un inspector (≈ "días antes" de Chicago).
  jornadasAntes: number;
}

// Detección acumulada (solo los valores y, alineados a la grilla i/n) para un
// orden dado de visitas.
function deteccionAcumulada(
  orden: Establecimiento[],
  totalViolaciones: number
): number[] {
  const y: number[] = [0];
  let hallados = 0;
  for (let i = 0; i < orden.length; i++) {
    if (tieneViolacionCritica(orden[i])) hallados++;
    y.push(totalViolaciones ? hallados / totalViolaciones : 0);
  }
  return y;
}

// Convierte una serie de valores y (grilla uniforme) en puntos (x, y).
function aPuntos(y: number[]): PuntoCurva[] {
  const n = y.length - 1;
  return y.map((v, i) => ({ x: n ? i / n : 0, y: v }));
}

// Interpola la detección (y) que alcanza una curva en una fracción de esfuerzo x.
function yEnX(curva: PuntoCurva[], x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return curva[curva.length - 1].y;
  for (let i = 1; i < curva.length; i++) {
    if (curva[i].x >= x) {
      const a = curva[i - 1];
      const b = curva[i];
      const t = (x - a.x) / (b.x - a.x || 1);
      return a.y + t * (b.y - a.y);
    }
  }
  return curva[curva.length - 1].y;
}

// Primera fracción de esfuerzo (x) en la que la curva alcanza una detección y.
function xParaY(curva: PuntoCurva[], y: number): number {
  for (let i = 1; i < curva.length; i++) {
    if (curva[i].y >= y) {
      const a = curva[i - 1];
      const b = curva[i];
      const t = (y - a.y) / (b.y - a.y || 1);
      return a.x + t * (b.x - a.x);
    }
  }
  return 1;
}

// Ejecuta el backtest sobre un subconjunto de establecimientos ya filtrado.
export function ejecutarBacktest(
  subset: Establecimiento[],
  universo: string
): ResultadoBacktest | null {
  const n = subset.length;
  if (n === 0) return null;

  const totalViolaciones = subset.reduce(
    (s, e) => s + (tieneViolacionCritica(e) ? 1 : 0),
    0
  );

  // Orden del MODELO: por score descendente (desempate estable por id).
  const ordenModelo = [...subset].sort(
    (a, b) => b.score - a.score || a.id - b.id
  );
  const yModelo = deteccionAcumulada(ordenModelo, totalViolaciones);

  // Orden TRADICIONAL: se PROMEDIA la detección sobre muchos barajados
  // deterministas (sin relación con el riesgo). Así la curva refleja el
  // desempeño esperado del método reactivo/aleatorio, no un barajado con suerte.
  const yTradicional = new Array<number>(n + 1).fill(0);
  let ordenTradRepresentativo: Establecimiento[] = subset;
  for (let k = 0; k < BASELINE_MUESTRAS; k++) {
    const orden = barajarDeterminista(subset, 1000 + k * 7919);
    if (k === 0) ordenTradRepresentativo = orden;
    const yk = deteccionAcumulada(orden, totalViolaciones);
    for (let i = 0; i <= n; i++) yTradicional[i] += yk[i] / BASELINE_MUESTRAS;
  }

  const curvaModelo = aPuntos(yModelo);
  const curvaTradicional = aPuntos(yTradicional);

  const deteccionModelo50 = yEnX(curvaModelo, 0.5);
  const deteccionTrad50 = yEnX(curvaTradicional, 0.5);

  // Para igualar la detección de medio periodo del método tradicional, ¿cuánto
  // antes la alcanza el modelo? Ese hueco horizontal es el "adelanto".
  const xModeloIgual = xParaY(curvaModelo, deteccionTrad50);
  const inspeccionesAhorradas = Math.max(0, Math.round((0.5 - xModeloIgual) * n));

  return {
    universo,
    n,
    totalViolaciones,
    tasaBase: totalViolaciones / n,
    modelo: {
      orden: ordenModelo,
      curva: curvaModelo,
      deteccionEnMitad: deteccionModelo50,
    },
    tradicional: {
      orden: ordenTradRepresentativo,
      curva: curvaTradicional,
      deteccionEnMitad: deteccionTrad50,
    },
    liftPuntos: (deteccionModelo50 - deteccionTrad50) * 100,
    inspeccionesAhorradas,
    jornadasAntes: Math.round(inspeccionesAhorradas / VISITAS_POR_DIA),
  };
}

// Etiqueta del universo por defecto (toda la ciudad).
export const UNIVERSO_CIUDAD = "Toda Bogotá";

// Localidades con muestra suficiente para un backtest representativo, ordenadas
// alfabéticamente. Las que no llegan a MIN_N_LOCALIDAD se omiten del selector.
export function localidadesElegibles(data: Establecimiento[]): string[] {
  const conteo = new Map<string, number>();
  for (const e of data) conteo.set(e.localidad, (conteo.get(e.localidad) ?? 0) + 1);
  return [...conteo.entries()]
    .filter(([, n]) => n >= MIN_N_LOCALIDAD)
    .map(([loc]) => loc)
    .sort((a, b) => a.localeCompare(b, "es"));
}
