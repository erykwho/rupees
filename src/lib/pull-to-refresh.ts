export const PULL_DEAD_ZONE = 8;
export const PULL_THRESHOLD = 68;
export const PULL_MAX_DISTANCE = 104;
export const PULL_REFRESH_HOLD_DISTANCE = 56;

export type PullPhase = "idle" | "pulling" | "ready" | "refreshing";

/**
 * Converte o deslocamento bruto do dedo (deltaY em px) em uma distância visual
 * amortecida com curva elástica (rubber-band), respeitando a dead-zone e o limite máximo.
 */
export function calculatePullDistance(rawDeltaY: number): number {
  if (!Number.isFinite(rawDeltaY) || rawDeltaY <= PULL_DEAD_ZONE) {
    return 0;
  }

  const effectiveDelta = rawDeltaY - PULL_DEAD_ZONE;
  const damped = PULL_MAX_DISTANCE * (1 - Math.exp(-effectiveDelta / 140));
  return Math.min(PULL_MAX_DISTANCE, Math.max(0, damped));
}

/**
 * Retorna a fase atual do gesto de Pull-to-Refresh.
 */
export function getPullPhase(distance: number, isRefreshing: boolean): PullPhase {
  if (isRefreshing) {
    return "refreshing";
  }
  if (distance >= PULL_THRESHOLD) {
    return "ready";
  }
  if (distance > 0) {
    return "pulling";
  }
  return "idle";
}

/**
 * Progresso normalizado [0, 1] até o limiar de atualização.
 */
export function getPullProgress(distance: number): number {
  if (!Number.isFinite(distance) || distance <= 0) {
    return 0;
  }
  return Math.min(1, distance / PULL_THRESHOLD);
}
