import './style.css';

import {
  clearForecastCache,
  fetchDailyForecast,
  fetchHourlyForecastForDate,
  type FetchProgress,
} from './api/openMeteo';
import { createSwissWeatherGrid } from './data/switzerland';
import {
  formatDateLabel,
  formatHour,
  formatShortDate,
  hourFromIsoLocalDateTime,
} from './lib/date';
import { createMap, type RenderSummary } from './map';
import type {
  DisplayPoint,
  ForecastPoint,
  HourlyForecastPoint,
  TemperatureMode,
} from './types';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error("L'ément #app est introuvable.");
}

app.innerHTML = `
  <header class="app-header">
    <div>
      <p class="eyebrow">Planificateur de fraîeur</p>
      <h1>Fraîeur Suisse</h1>
      <p class="subtitle">Choisissez une date et une tempéture maximale. La carte ne colore que les secteurs qui devraient rester sous ce seuil.</p>
    </div>
    <div class="header-badge">Présion indicative</div>
  </header>

  <main class="app-layout">
    <aside class="control-panel" aria-label="Filtres méo">
      <section class="controls-card">
        <div class="field">
          <label for="date-select">Jour</label>
          <select id="date-select" disabled>
            <option>Chargement des présions</option>
          </select>
        </div>

        <div class="field">
          <label for="mode-select">Tempéture</label>
          <select id="mode-select">
            <option value="daily-max">Maximum de la journé/option>
            <option value="hourly">Àune heure prése</option>
          </select>
        </div>

        <div class="field is-hidden" id="hour-field">
          <label for="hour-select">Heure</label>
          <select id="hour-select"></select>
        </div>

        <div class="field threshold-field">
          <div class="field-heading">
            <label for="threshold-range">Tempéture limite</label>
            <output id="threshold-output" for="threshold-range">27 °C</output>
          </div>
          <input id="threshold-range" type="range" min="8" max="38" step="0.5" value="27" />
          <div class="range-labels"><span>8 °C</span><span>38 °C</span></div>
        </div>

        <button id="refresh-button" class="secondary-button" type="button">Actualiser les donné</button>
      </section>

      <section class="status-card" aria-live="polite">
        <div id="loading-block">
          <div class="spinner" aria-hidden="true"></div>
          <div>
            <strong id="status-title">Prération de la grille</strong>
            <p id="status-detail">Quelques secondes peuvent êe néssaires au premier chargement.</p>
          </div>
        </div>
        <div id="error-block" class="error-block is-hidden"></div>
      </section>

      <section class="summary-card">
        <div class="summary-number" id="visible-count"></div>
        <p>cellules sous le seuil</p>
        <dl class="summary-grid">
          <div><dt>Minimum pré</dt><dd id="minimum-value"></dd></div>
          <div><dt>Maximum pré</dt><dd id="maximum-value"></dd></div>
          <div><dt>Date</dt><dd id="selected-date-label"></dd></div>
          <div><dt>Grille</dt><dd id="grid-count"></dd></div>
        </dl>
      </section>

      <section class="coolest-card">
        <div class="section-heading">
          <h2>Points les plus frais</h2>
          <span id="coolest-context"></span>
        </div>
        <ol id="coolest-list" class="coolest-list">
          <li class="empty-list">Les réltats apparaîont aprèle chargement.</li>
        </ol>
      </section>
    </aside>

    <section class="map-panel">
      <div id="map" aria-label="Carte méo de la Suisse"></div>
      <div class="legend" aria-label="Lénde de tempéture">
        <span>Plus frais</span>
        <div class="legend-gradient"></div>
        <span>Proche du seuil</span>
      </div>
      <div class="map-note">Les zones non coloré déssent le seuil choisi ou ne disposent pas de donné.</div>
    </section>
  </main>

  <footer>
    Présions : <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a>, modès dont MeteoSwiss · Altitude : Copernicus DEM · Carte : OpenStreetMap · Frontiè simplifié: Natural Earth.
  </footer>
`;

const elements = {
  dateSelect: requiredElement<HTMLSelectElement>('date-select'),
  modeSelect: requiredElement<HTMLSelectElement>('mode-select'),
  hourField: requiredElement<HTMLDivElement>('hour-field'),
  hourSelect: requiredElement<HTMLSelectElement>('hour-select'),
  thresholdRange: requiredElement<HTMLInputElement>('threshold-range'),
  thresholdOutput: requiredElement<HTMLOutputElement>('threshold-output'),
  refreshButton: requiredElement<HTMLButtonElement>('refresh-button'),
  loadingBlock: requiredElement<HTMLDivElement>('loading-block'),
  statusTitle: requiredElement<HTMLElement>('status-title'),
  statusDetail: requiredElement<HTMLParagraphElement>('status-detail'),
  errorBlock: requiredElement<HTMLDivElement>('error-block'),
  visibleCount: requiredElement<HTMLDivElement>('visible-count'),
  minimumValue: requiredElement<HTMLElement>('minimum-value'),
  maximumValue: requiredElement<HTMLElement>('maximum-value'),
  selectedDateLabel: requiredElement<HTMLElement>('selected-date-label'),
  gridCount: requiredElement<HTMLElement>('grid-count'),
  coolestContext: requiredElement<HTMLElement>('coolest-context'),
  coolestList: requiredElement<HTMLOListElement>('coolest-list'),
};

const grid = createSwissWeatherGrid();
elements.gridCount.textContent = `${grid.length} points`;

let dailyForecast: ForecastPoint[] = [];
const hourlyForecastByDate = new Map<string, HourlyForecastPoint[]>();
let currentDisplayPoints: DisplayPoint[] = [];
let currentSummary: RenderSummary = {
  visiblePoints: [],
  minimum: null,
  maximum: null,
};

const mapController = createMap('map', (summary) => {
  currentSummary = summary;
  renderSummary();
});

populateHours();
registerEvents();
void loadDailyForecast();

function registerEvents(): void {
  elements.thresholdRange.addEventListener('input', () => {
    elements.thresholdOutput.textContent = `${Number(elements.thresholdRange.value).toFixed(1)} °C`;
    renderMap();
  });

  elements.dateSelect.addEventListener('change', () => {
    void updateSelectedForecast();
  });

  elements.modeSelect.addEventListener('change', () => {
    const mode = selectedMode();
    elements.hourField.classList.toggle('is-hidden', mode !== 'hourly');
    void updateSelectedForecast();
  });

  elements.hourSelect.addEventListener('change', () => {
    void updateSelectedForecast();
  });

  elements.refreshButton.addEventListener('click', () => {
    hourlyForecastByDate.clear();
    clearForecastCache();
    void loadDailyForecast(true);
  });
}

async function loadDailyForecast(forceRefresh = false): Promise<void> {
  setLoading('Chargement des présions', 'Connexion àpen-Meteo');
  clearError();
  elements.refreshButton.disabled = true;
  elements.dateSelect.disabled = true;
  mapController.clear();

  try {
    dailyForecast = await fetchDailyForecast(
      grid,
      (progress) => updateProgress(progress, 'Présions journaliès'),
      forceRefresh,
    );

    if (!dailyForecast.length || !dailyForecast[0].daily.dates.length) {
      throw new Error('Aucune présion journaliè reç.');
    }

    populateDates(dailyForecast[0].daily.dates);
    elements.dateSelect.disabled = false;
    await updateSelectedForecast();
    setReady();
  } catch (error) {
    showError(error);
  } finally {
    elements.refreshButton.disabled = false;
  }
}

async function updateSelectedForecast(): Promise<void> {
  const dateIso = elements.dateSelect.value;
  if (!dateIso || !dailyForecast.length) {
    return;
  }

  clearError();
  elements.selectedDateLabel.textContent = formatShortDate(dateIso);

  if (selectedMode() === 'daily-max') {
    currentDisplayPoints = buildDailyDisplayPoints(dateIso);
    renderMap();
    setReady();
    return;
  }

  setLoading(
    'Chargement du déil horaire',
    `Tempétures du ${formatShortDate(dateIso)}`,
  );

  try {
    let hourlyForecast = hourlyForecastByDate.get(dateIso);
    if (!hourlyForecast) {
      hourlyForecast = await fetchHourlyForecastForDate(grid, dateIso, (progress) =>
        updateProgress(progress, 'Présions horaires'),
      );
      hourlyForecastByDate.set(dateIso, hourlyForecast);
    }

    currentDisplayPoints = buildHourlyDisplayPoints(hourlyForecast);
    renderMap();
    setReady();
  } catch (error) {
    showError(error);
  }
}

function buildDailyDisplayPoints(dateIso: string): DisplayPoint[] {
  return dailyForecast.flatMap((point) => {
    const index = point.daily.dates.indexOf(dateIso);
    const temperature = point.daily.temperatureMax[index];
    if (index < 0 || temperature === null || !Number.isFinite(temperature)) {
      return [];
    }

    return [
      {
        id: point.id,
        latitude: point.latitude,
        longitude: point.longitude,
        elevation: point.elevation,
        temperature,
        precipitation: point.daily.precipitationSum[index] ?? null,
        windSpeed: point.daily.windSpeedMax[index] ?? null,
      },
    ];
  });
}

function buildHourlyDisplayPoints(
  hourlyForecast: HourlyForecastPoint[],
): DisplayPoint[] {
  const selectedHour = Number(elements.hourSelect.value);

  return hourlyForecast.flatMap((point) => {
    const index = point.hourly.times.findIndex(
      (time) => hourFromIsoLocalDateTime(time) === selectedHour,
    );
    const temperature = point.hourly.temperatures[index];
    if (index < 0 || temperature === null || !Number.isFinite(temperature)) {
      return [];
    }

    return [
      {
        id: point.id,
        latitude: point.latitude,
        longitude: point.longitude,
        elevation: point.elevation,
        temperature,
        precipitation: null,
        windSpeed: null,
      },
    ];
  });
}

function renderMap(): void {
  const threshold = Number(elements.thresholdRange.value);
  mapController.render(currentDisplayPoints, threshold);
}

function renderSummary(): void {
  const visible = [...currentSummary.visiblePoints].sort(
    (left, right) => left.temperature - right.temperature,
  );

  elements.visibleCount.textContent = String(visible.length);
  elements.minimumValue.textContent = formatTemperature(currentSummary.minimum);
  elements.maximumValue.textContent = formatTemperature(currentSummary.maximum);
  elements.coolestContext.textContent = visible.length
    ? `sous ${Number(elements.thresholdRange.value).toFixed(1)} °C`
    : '';

  elements.coolestList.replaceChildren();

  if (!visible.length) {
    const item = document.createElement('li');
    item.className = 'empty-list';
    item.textContent = 'Aucun point ne respecte ce seuil. Montez lérement la tempéture limite.';
    elements.coolestList.append(item);
    return;
  }

  const coolestAreas = selectSpatiallyDistinctPoints(visible, 7, 28);

  for (const [index, point] of coolestAreas.entries()) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'coolest-button';
    button.innerHTML = `
      <span class="rank">${index + 1}</span>
      <span class="coolest-main">
        <strong>${point.temperature.toFixed(1)} °C</strong>
        <small>${formatAltitude(point.elevation)} · ${point.latitude.toFixed(2)}, ${point.longitude.toFixed(2)}</small>
      </span>
      <span aria-hidden="true">Voir</span>
    `;
    button.addEventListener('click', () => mapController.focus(point));
    item.append(button);
    elements.coolestList.append(item);
  }
}

function populateDates(dates: string[]): void {
  const previousValue = elements.dateSelect.value;
  elements.dateSelect.replaceChildren();

  dates.forEach((dateIso, index) => {
    const option = document.createElement('option');
    option.value = dateIso;
    option.textContent = formatDateLabel(dateIso, index);
    elements.dateSelect.append(option);
  });

  if (dates.includes(previousValue)) {
    elements.dateSelect.value = previousValue;
  }
}

function populateHours(): void {
  for (let hour = 6; hour <= 21; hour += 1) {
    const option = document.createElement('option');
    option.value = String(hour);
    option.textContent = formatHour(hour);
    option.selected = hour === 14;
    elements.hourSelect.append(option);
  }
}

function selectedMode(): TemperatureMode {
  return elements.modeSelect.value as TemperatureMode;
}

function updateProgress(progress: FetchProgress, label: string): void {
  const percent = Math.round(
    (progress.completedChunks / progress.totalChunks) * 100,
  );
  setLoading(label, `${progress.completedChunks}/${progress.totalChunks} groupes chargé ${percent} %`);
}

function setLoading(title: string, detail: string): void {
  elements.loadingBlock.classList.remove('is-hidden');
  elements.statusTitle.textContent = title;
  elements.statusDetail.textContent = detail;
}

function setReady(): void {
  elements.loadingBlock.classList.add('is-hidden');
}

function showError(error: unknown): void {
  setReady();
  const message = error instanceof Error ? error.message : String(error);
  elements.errorBlock.classList.remove('is-hidden');
  elements.errorBlock.innerHTML = `<strong>Impossible de charger la méo.</strong><p>${escapeHtml(message)}</p><p>Résayez dans quelques instants. La carte elle-mê reste utilisable.</p>`;
}

function clearError(): void {
  elements.errorBlock.classList.add('is-hidden');
  elements.errorBlock.replaceChildren();
}

function formatTemperature(value: number | null): string {
  return value === null ? '' : `${value.toFixed(1)} °C`;
}

function formatAltitude(value: number | null): string {
  return value === null ? 'altitude inconnue' : `${Math.round(value)} m`;
}


function selectSpatiallyDistinctPoints(
  sortedPoints: DisplayPoint[],
  limit: number,
  minimumDistanceKm: number,
): DisplayPoint[] {
  const selected: DisplayPoint[] = [];

  for (const candidate of sortedPoints) {
    const isFarEnough = selected.every(
      (point) => distanceKm(point, candidate) >= minimumDistanceKm,
    );

    if (isFarEnough) {
      selected.push(candidate);
    }

    if (selected.length === limit) {
      break;
    }
  }

  return selected;
}

function distanceKm(left: DisplayPoint, right: DisplayPoint): number {
  const earthRadiusKm = 6371;
  const latitudeDelta = degreesToRadians(right.latitude - left.latitude);
  const longitudeDelta = degreesToRadians(right.longitude - left.longitude);
  const leftLatitude = degreesToRadians(left.latitude);
  const rightLatitude = degreesToRadians(right.latitude);

  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(leftLatitude) *
      Math.cos(rightLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;

  return 2 * earthRadiusKm * Math.asin(Math.sqrt(haversine));
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Éént #${id} introuvable.`);
  }
  return element as T;
}

function escapeHtml(value: string): string {
  const element = document.createElement('div');
  element.textContent = value;
  return element.innerHTML;
}

