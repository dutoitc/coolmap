import type {
  ForecastPoint,
  GridPoint,
  HourlyForecastPoint,
} from '../types';

const FORECAST_ENDPOINT = 'https://api.open-meteo.com/v1/forecast';

// 496 points sont utilisés sur la Suisse. Le plafond de sécurité reste sous
// la limite gratuite de 600 positions par minute.
const CHUNK_SIZE = 100;
const RATE_LIMIT_WINDOW_MS = 61_000;
const RATE_LIMIT_POINT_BUDGET = 520;

// Cache navigateur persistant : il survit à F5 et à la fermeture du navigateur.
const CACHE_DURATION_MS = 6 * 60 * 60 * 1000;
const STALE_CACHE_DURATION_MS = 36 * 60 * 60 * 1000;
const GRID_VERSION = 'grid-0.085-0.115-v3';
const CACHE_PREFIX = 'fraicheur-suisse:weather:v3:';

export type WeatherSource = 'auto' | 'meteoswiss' | 'global';

interface SourceConfiguration {
  model: string | null;
  forecastDays: number;
}

const SOURCE_CONFIGURATIONS: Record<WeatherSource, SourceConfiguration> = {
  auto: {
    model: null,
    forecastDays: 16,
  },
  meteoswiss: {
    model: 'meteoswiss_icon_ch2',
    forecastDays: 5,
  },
  global: {
    model: 'ncep_gfs013',
    forecastDays: 16,
  },
};

interface OpenMeteoDailyResponse {
  latitude: number;
  longitude: number;
  elevation?: number;
  daily: {
    time: string[];
    temperature_2m_max: Array<number | null>;
    precipitation_sum: Array<number | null>;
    wind_speed_10m_max: Array<number | null>;
  };
}

interface OpenMeteoHourlyResponse {
  latitude: number;
  longitude: number;
  elevation?: number;
  hourly: {
    time: string[];
    temperature_2m: Array<number | null>;
  };
}

interface CacheEnvelope<T> {
  createdAt: number;
  data: T;
}

interface RequestHistoryEntry {
  createdAt: number;
  pointCount: number;
}

export interface FetchProgress {
  completedChunks: number;
  totalChunks: number;
  fromCache?: boolean;
  waitingSeconds?: number;
}

const requestHistory: RequestHistoryEntry[] = [];

export function clearForecastCache(): void {
  try {
    const keysToRemove: string[] = [];

    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(CACHE_PREFIX)) {
        keysToRemove.push(key);
      }
    }

    keysToRemove.forEach((key) => localStorage.removeItem(key));
  } catch {
    // Le cache est une optimisation. L'application reste utilisable sans lui.
  }
}

export async function fetchDailyForecast(
  points: GridPoint[],
  source: WeatherSource,
  onProgress?: (progress: FetchProgress) => void,
  forceRefresh = false,
): Promise<ForecastPoint[]> {
  const chunks = chunk(points, CHUNK_SIZE);
  const results: ForecastPoint[][] = [];

  for (const [chunkIndex, pointChunk] of chunks.entries()) {
    const cacheKey = createCacheKey('daily', source, null, chunkIndex);
    const freshCache = forceRefresh
      ? null
      : readCache<ForecastPoint[]>(cacheKey, false);

    if (freshCache) {
      results.push(freshCache);
      onProgress?.({
        completedChunks: chunkIndex + 1,
        totalChunks: chunks.length,
        fromCache: true,
      });
      continue;
    }

    try {
      const url = buildDailyUrl(pointChunk, source);
      const responses = normalizeResponses<OpenMeteoDailyResponse>(
        await fetchJson(url, pointChunk.length, (waitingSeconds) => {
          onProgress?.({
            completedChunks: chunkIndex,
            totalChunks: chunks.length,
            waitingSeconds,
          });
        }),
      );

      const mapped = mapDailyResponses(pointChunk, responses);
      writeCache(cacheKey, mapped);
      results.push(mapped);

      onProgress?.({
        completedChunks: chunkIndex + 1,
        totalChunks: chunks.length,
      });
    } catch (error) {
      const staleCache = readCache<ForecastPoint[]>(cacheKey, true);
      if (!staleCache) {
        throw error;
      }

      results.push(staleCache);
      onProgress?.({
        completedChunks: chunkIndex + 1,
        totalChunks: chunks.length,
        fromCache: true,
      });
    }
  }

  return results.flat();
}

export async function fetchHourlyForecastForDate(
  points: GridPoint[],
  dateIso: string,
  source: WeatherSource,
  onProgress?: (progress: FetchProgress) => void,
  forceRefresh = false,
): Promise<HourlyForecastPoint[]> {
  const chunks = chunk(points, CHUNK_SIZE);
  const results: HourlyForecastPoint[][] = [];

  for (const [chunkIndex, pointChunk] of chunks.entries()) {
    const cacheKey = createCacheKey('hourly', source, dateIso, chunkIndex);
    const freshCache = forceRefresh
      ? null
      : readCache<HourlyForecastPoint[]>(cacheKey, false);

    if (freshCache) {
      results.push(freshCache);
      onProgress?.({
        completedChunks: chunkIndex + 1,
        totalChunks: chunks.length,
        fromCache: true,
      });
      continue;
    }

    try {
      const url = buildHourlyUrl(pointChunk, dateIso, source);
      const responses = normalizeResponses<OpenMeteoHourlyResponse>(
        await fetchJson(url, pointChunk.length, (waitingSeconds) => {
          onProgress?.({
            completedChunks: chunkIndex,
            totalChunks: chunks.length,
            waitingSeconds,
          });
        }),
      );

      const mapped = mapHourlyResponses(pointChunk, responses);
      writeCache(cacheKey, mapped);
      results.push(mapped);

      onProgress?.({
        completedChunks: chunkIndex + 1,
        totalChunks: chunks.length,
      });
    } catch (error) {
      const staleCache = readCache<HourlyForecastPoint[]>(cacheKey, true);
      if (!staleCache) {
        throw error;
      }

      results.push(staleCache);
      onProgress?.({
        completedChunks: chunkIndex + 1,
        totalChunks: chunks.length,
        fromCache: true,
      });
    }
  }

  return results.flat();
}

function buildDailyUrl(points: GridPoint[], source: WeatherSource): string {
  const params = commonParams(points, source);
  params.set(
    'daily',
    'temperature_2m_max,precipitation_sum,wind_speed_10m_max',
  );
  params.set(
    'forecast_days',
    String(SOURCE_CONFIGURATIONS[source].forecastDays),
  );

  return `${FORECAST_ENDPOINT}?${params.toString()}`;
}

function buildHourlyUrl(
  points: GridPoint[],
  dateIso: string,
  source: WeatherSource,
): string {
  const params = commonParams(points, source);
  params.set('hourly', 'temperature_2m');
  params.set('start_date', dateIso);
  params.set('end_date', dateIso);

  return `${FORECAST_ENDPOINT}?${params.toString()}`;
}

function commonParams(
  points: GridPoint[],
  source: WeatherSource,
): URLSearchParams {
  const params = new URLSearchParams({
    latitude: points.map((point) => point.latitude).join(','),
    longitude: points.map((point) => point.longitude).join(','),
    timezone: 'Europe/Zurich',
    temperature_unit: 'celsius',
    wind_speed_unit: 'kmh',
  });

  const model = SOURCE_CONFIGURATIONS[source].model;
  if (model) {
    params.set('models', model);
  }

  return params;
}

async function fetchJson(
  url: string,
  pointCount: number,
  onWait: (waitingSeconds: number) => void,
): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await reserveApiBudget(pointCount, onWait);

    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
      },
    });

    if (response.ok) {
      return response.json();
    }

    if (response.status === 429 && attempt === 0) {
      const retryAfterSeconds = parseRetryAfterSeconds(
        response.headers.get('Retry-After'),
      );
      await waitWithCountdown(retryAfterSeconds * 1000, onWait);
      continue;
    }

    const reason = await readErrorReason(response);
    throw new Error(`Open-Meteo a refusé la requête : ${reason}`);
  }

  throw new Error('Open-Meteo reste temporairement indisponible.');
}

async function reserveApiBudget(
  pointCount: number,
  onWait: (waitingSeconds: number) => void,
): Promise<void> {
  while (true) {
    removeExpiredRequestHistory();

    const usedPoints = requestHistory.reduce(
      (total, entry) => total + entry.pointCount,
      0,
    );

    if (usedPoints + pointCount <= RATE_LIMIT_POINT_BUDGET) {
      requestHistory.push({
        createdAt: Date.now(),
        pointCount,
      });
      onWait(0);
      return;
    }

    const oldestEntry = requestHistory[0];
    const waitMilliseconds = Math.max(
      1_000,
      oldestEntry.createdAt + RATE_LIMIT_WINDOW_MS - Date.now(),
    );

    await waitWithCountdown(waitMilliseconds, onWait);
  }
}

function removeExpiredRequestHistory(): void {
  const minimumTimestamp = Date.now() - RATE_LIMIT_WINDOW_MS;

  while (
    requestHistory.length > 0 &&
    requestHistory[0].createdAt <= minimumTimestamp
  ) {
    requestHistory.shift();
  }
}

async function waitWithCountdown(
  durationMs: number,
  onWait: (waitingSeconds: number) => void,
): Promise<void> {
  const endAt = Date.now() + durationMs;

  while (Date.now() < endAt) {
    const waitingSeconds = Math.max(
      1,
      Math.ceil((endAt - Date.now()) / 1000),
    );
    onWait(waitingSeconds);
    await sleep(Math.min(1_000, endAt - Date.now()));
  }

  onWait(0);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function parseRetryAfterSeconds(value: string | null): number {
  if (!value) {
    return 61;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(120, Math.ceil(seconds));
  }

  return 61;
}

async function readErrorReason(response: Response): Promise<string> {
  const fallback = `${response.status} ${response.statusText}`.trim();

  try {
    const error = (await response.json()) as { reason?: string };
    return error.reason ?? fallback;
  } catch {
    return fallback;
  }
}

function normalizeResponses<T>(value: unknown): T[] {
  return (Array.isArray(value) ? value : [value]) as T[];
}

function mapDailyResponses(
  requestedPoints: GridPoint[],
  responses: OpenMeteoDailyResponse[],
): ForecastPoint[] {
  if (responses.length !== requestedPoints.length) {
    throw new Error(
      `Réponse météo incomplète : ${responses.length} points reçus pour ${requestedPoints.length} demandés.`,
    );
  }

  return responses.map((response, index) => ({
    ...requestedPoints[index],
    elevation: finiteOrNull(response.elevation),
    daily: {
      dates: response.daily.time,
      temperatureMax: response.daily.temperature_2m_max,
      precipitationSum: response.daily.precipitation_sum,
      windSpeedMax: response.daily.wind_speed_10m_max,
    },
  }));
}

function mapHourlyResponses(
  requestedPoints: GridPoint[],
  responses: OpenMeteoHourlyResponse[],
): HourlyForecastPoint[] {
  if (responses.length !== requestedPoints.length) {
    throw new Error(
      `Réponse météo horaire incomplète : ${responses.length} points reçus pour ${requestedPoints.length} demandés.`,
    );
  }

  return responses.map((response, index) => ({
    ...requestedPoints[index],
    elevation: finiteOrNull(response.elevation),
    hourly: {
      times: response.hourly.time,
      temperatures: response.hourly.temperature_2m,
    },
  }));
}

function finiteOrNull(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function createCacheKey(
  kind: 'daily' | 'hourly',
  source: WeatherSource,
  dateIso: string | null,
  chunkIndex: number,
): string {
  const datePart = dateIso ?? 'all';
  return `${CACHE_PREFIX}${GRID_VERSION}:${kind}:${source}:${datePart}:${chunkIndex}`;
}

function readCache<T>(key: string, allowStale: boolean): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return null;
    }

    const envelope = JSON.parse(raw) as CacheEnvelope<T>;
    const age = Date.now() - envelope.createdAt;

    if (age > STALE_CACHE_DURATION_MS) {
      localStorage.removeItem(key);
      return null;
    }

    if (!allowStale && age > CACHE_DURATION_MS) {
      return null;
    }

    return envelope.data;
  } catch {
    localStorage.removeItem(key);
    return null;
  }
}

function writeCache<T>(key: string, data: T): void {
  const envelope: CacheEnvelope<T> = {
    createdAt: Date.now(),
    data,
  };

  try {
    localStorage.setItem(key, JSON.stringify(envelope));
  } catch {
    removeOldestCacheEntries(10);

    try {
      localStorage.setItem(key, JSON.stringify(envelope));
    } catch {
      // Cache plein ou désactivé : l'application continue sans cache.
    }
  }
}

function removeOldestCacheEntries(maximumEntries: number): void {
  try {
    const entries: Array<{ key: string; createdAt: number }> = [];

    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(CACHE_PREFIX)) {
        continue;
      }

      try {
        const raw = localStorage.getItem(key);
        const envelope = raw
          ? (JSON.parse(raw) as CacheEnvelope<unknown>)
          : null;

        entries.push({
          key,
          createdAt: envelope?.createdAt ?? 0,
        });
      } catch {
        entries.push({ key, createdAt: 0 });
      }
    }

    entries
      .sort((left, right) => left.createdAt - right.createdAt)
      .slice(0, maximumEntries)
      .forEach((entry) => localStorage.removeItem(entry.key));
  } catch {
    // Rien à faire si le stockage du navigateur est indisponible.
  }
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}
