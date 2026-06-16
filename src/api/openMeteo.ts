import type {
  ForecastPoint,
  GridPoint,
  HourlyForecastPoint,
} from '../types';

const FORECAST_ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
const CHUNK_SIZE = 50;
const CONCURRENCY = 1;
const DELAY_BETWEEN_REQUESTS_MS = 1200;
const CACHE_DURATION_MS = 45 * 60 * 1000;
const GRID_VERSION = 'grid-0.075-0.10-v2';
const CACHE_PREFIX = 'fraicheur-suisse:';

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
  gridVersion: string;
  data: T;
}

export interface FetchProgress {
  completedChunks: number;
  totalChunks: number;
}


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
    // L'actualisation réseau reste possible même si le stockage est indisponible.
  }
}

export async function fetchDailyForecast(
  points: GridPoint[],
  onProgress?: (progress: FetchProgress) => void,
  forceRefresh = false,
): Promise<ForecastPoint[]> {
  const cacheKey = `${CACHE_PREFIX}daily:v1`;

  if (!forceRefresh) {
    const cached = readCache<ForecastPoint[]>(cacheKey);
    if (cached) {
      onProgress?.({ completedChunks: 1, totalChunks: 1 });
      return cached;
    }
  }

  const chunks = chunk(points, CHUNK_SIZE);
  let completedChunks = 0;

  const results = await mapWithConcurrency(chunks, CONCURRENCY, async (pointChunk) => {
    const url = buildDailyUrl(pointChunk);
    const responses = normalizeResponses<OpenMeteoDailyResponse>(
      await fetchJson(url),
    );

    const mapped = mapDailyResponses(pointChunk, responses);
    completedChunks += 1;
    onProgress?.({ completedChunks, totalChunks: chunks.length });
    return mapped;
  });

  const flattened = results.flat();
  writeCache(cacheKey, flattened);
  return flattened;
}

export async function fetchHourlyForecastForDate(
  points: GridPoint[],
  dateIso: string,
  onProgress?: (progress: FetchProgress) => void,
  forceRefresh = false,
): Promise<HourlyForecastPoint[]> {
  const cacheKey = `${CACHE_PREFIX}hourly:${dateIso}:v1`;

  if (!forceRefresh) {
    const cached = readCache<HourlyForecastPoint[]>(cacheKey);
    if (cached) {
      onProgress?.({ completedChunks: 1, totalChunks: 1 });
      return cached;
    }
  }

  const chunks = chunk(points, CHUNK_SIZE);
  let completedChunks = 0;

  const results = await mapWithConcurrency(chunks, CONCURRENCY, async (pointChunk) => {
    const url = buildHourlyUrl(pointChunk, dateIso);
    const responses = normalizeResponses<OpenMeteoHourlyResponse>(
      await fetchJson(url),
    );

    const mapped = mapHourlyResponses(pointChunk, responses);
    completedChunks += 1;
    onProgress?.({ completedChunks, totalChunks: chunks.length });
    return mapped;
  });

  const flattened = results.flat();
  writeCache(cacheKey, flattened);
  return flattened;
}

function buildDailyUrl(points: GridPoint[]): string {
  const params = commonParams(points);
  params.set(
    'daily',
    'temperature_2m_max,precipitation_sum,wind_speed_10m_max',
  );
  params.set('forecast_days', '16');
  return `${FORECAST_ENDPOINT}?${params.toString()}`;
}

function buildHourlyUrl(points: GridPoint[], dateIso: string): string {
  const params = commonParams(points);
  params.set('hourly', 'temperature_2m');
  params.set('start_date', dateIso);
  params.set('end_date', dateIso);
  return `${FORECAST_ENDPOINT}?${params.toString()}`;
}

function commonParams(points: GridPoint[]): URLSearchParams {
  return new URLSearchParams({
    latitude: points.map((point) => point.latitude).join(','),
    longitude: points.map((point) => point.longitude).join(','),
    timezone: 'Europe/Zurich',
    models: 'best_match',
    temperature_unit: 'celsius',
    wind_speed_unit: 'kmh',
  });
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    let reason = `${response.status} ${response.statusText}`;
    try {
      const error = (await response.json()) as { reason?: string };
      reason = error.reason ?? reason;
    } catch {
      // La réponse n'est pas toujours du JSON en cas de panne intermédiaire.
    }
    throw new Error(`Open-Meteo a refusé la requête : ${reason}`);
  }

  return response.json();
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

function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return null;
    }

    const envelope = JSON.parse(raw) as CacheEnvelope<T>;
    const isFresh = Date.now() - envelope.createdAt < CACHE_DURATION_MS;
    if (!isFresh || envelope.gridVersion !== GRID_VERSION) {
      localStorage.removeItem(key);
      return null;
    }

    return envelope.data;
  } catch {
    return null;
  }
}

function writeCache<T>(key: string, data: T): void {
  try {
    const envelope: CacheEnvelope<T> = {
      createdAt: Date.now(),
      gridVersion: GRID_VERSION,
      data,
    };
    localStorage.setItem(key, JSON.stringify(envelope));
  } catch {
    // Le cache est une optimisation. L'application doit fonctionner sans lui.
  }
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  task: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await task(values[currentIndex], currentIndex);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker()),
  );

  return results;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
