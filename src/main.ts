import './style.css';

import {
  clearForecastCache,
  fetchDailyForecast,
  fetchHourlyForecastForDate,
  type FetchProgress,
  type WeatherSource,
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
  MapDisplayMode,
  TemperatureMode,
} from './types';

const SOURCE_STORAGE_KEY = 'fraicheur-suisse:selected-source';
const DISPLAY_STORAGE_KEY = 'fraicheur-suisse:selected-display';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error("L'élément #app est introuvable.");
}

app.innerHTML = `
  <header class="app-header">
    <div>
      <p class="eyebrow">Planificateur de fraîcheur</p>
      <h1>Fraîcheur Suisse</h1>
      <p class="subtitle">Choisissez une date et un mode d’affichage. Toutes les températures disponibles restent visibles ; le seuil sert uniquement à encadrer les zones les plus fraîches.</p>
    </div>
    <div class="header-badge">Prévision indicative</div>
  </header>

  <main class="app-layout">
    <aside class="control-panel" aria-label="Filtres météo">
      <section class="controls-card">
        <div class="field">
          <label for="date-select">Jour</label>
          <select id="date-select" disabled>
            <option>Chargement des prévisions…</option>
          </select>
        </div>

        <div class="field">
          <label for="mode-select">Température</label>
          <select id="mode-select">
            <option value="daily-max">Maximum de la journée</option>
            <option value="hourly">À une heure précise</option>
          </select>
        </div>

        <div class="field hour-field is-hidden" id="hour-field">
          <label for="hour-select">Heure</label>
          <select id="hour-select"></select>
        </div>

        <div class="field">
          <label for="source-select">Source météo</label>
          <select id="source-select">
            <option value="auto">Auto — meilleur modèle</option>
            <option value="meteoswiss">MeteoSwiss CH2 — 5 jours</option>
            <option value="global">Global GFS — 16 jours</option>
          </select>
          <small id="source-help" class="field-help"></small>
        </div>

        <div class="field">
          <label for="display-select">Affichage sur la carte</label>
          <select id="display-select">
            <option value="colors">Carrés de couleur</option>
            <option value="temperatures">Températures</option>
          </select>
          <small id="display-help" class="field-help"></small>
        </div>

        <div class="field threshold-field">
          <div class="field-heading">
            <label for="threshold-range">Encadrer sous</label>
            <output id="threshold-output" for="threshold-range">27 °C</output>
          </div>
          <input id="threshold-range" type="range" min="8" max="38" step="0.5" value="27" />
          <div class="range-labels"><span>8 °C</span><span>38 °C</span></div>
          <small class="field-help">Les températures égales ou inférieures à ce seuil sont encadrées en bleu foncé.</small>
        </div>

        <button id="refresh-button" class="secondary-button" type="button">Actualiser les données</button>
      </section>

      <section id="status-card" class="status-card" aria-live="polite">
        <div id="loading-block">
          <div class="spinner" aria-hidden="true"></div>
          <div>
            <strong id="status-title">Préparation de la grille</strong>
            <p id="status-detail">Le premier chargement peut prendre quelques secondes.</p>
          </div>
        </div>
        <div id="error-block" class="error-block is-hidden"></div>
      </section>

      <section class="summary-card">
        <div class="summary-number" id="visible-count">—</div>
        <p>cellules encadrées</p>
        <dl class="summary-grid">
          <div><dt>Minimum prévu</dt><dd id="minimum-value">—</dd></div>
          <div><dt>Maximum prévu</dt><dd id="maximum-value">—</dd></div>
          <div><dt>Date</dt><dd id="selected-date-label">—</dd></div>
          <div><dt>Grille</dt><dd id="grid-count">—</dd></div>
        </dl>
      </section>

      <section class="coolest-card">
        <div class="section-heading">
          <h2>Points les plus frais</h2>
          <span id="coolest-context"></span>
        </div>
        <ol id="coolest-list" class="coolest-list">
          <li class="empty-list">Les résultats apparaîtront après le chargement.</li>
        </ol>
      </section>
    </aside>

    <section class="map-panel">
      <div id="map" aria-label="Carte météo de la Suisse"></div>
      <div class="legend" aria-label="Légende de température">
        <span id="legend-min">Plus froid</span>
        <div class="legend-gradient"></div>
        <span id="legend-max">Plus chaud</span>
      </div>
      <div class="map-note">Bleu = plus froid, rouge = plus chaud. Le contour bleu foncé indique les températures égales ou inférieures au seuil choisi.</div>
    </section>
  </main>

  <footer>
    Données météo : <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a>, modèles dont MeteoSwiss · Altitude : Copernicus DEM · Carte : OpenStreetMap · Frontière simplifiée : Natural Earth.
  </footer>
`;

const elements = {
  dateSelect: requiredElement<HTMLSelectElement>('date-select'),
  modeSelect: requiredElement<HTMLSelectElement>('mode-select'),
  sourceSelect: requiredElement<HTMLSelectElement>('source-select'),
  sourceHelp: requiredElement<HTMLElement>('source-help'),
  displaySelect: requiredElement<HTMLSelectElement>('display-select'),
  displayHelp: requiredElement<HTMLElement>('display-help'),
  hourField: requiredElement<HTMLDivElement>('hour-field'),
  hourSelect: requiredElement<HTMLSelectElement>('hour-select'),
  thresholdRange: requiredElement<HTMLInputElement>('threshold-range'),
  thresholdOutput: requiredElement<HTMLOutputElement>('threshold-output'),
  refreshButton: requiredElement<HTMLButtonElement>('refresh-button'),
  statusCard: requiredElement<HTMLElement>('status-card'),
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
  legendMin: requiredElement<HTMLElement>('legend-min'),
  legendMax: requiredElement<HTMLElement>('legend-max'),
};

restoreSourceSelection();
restoreDisplaySelection();
updateSourceHelp();
updateDisplayHelp();
populateHours();

const grid = createSwissWeatherGrid();
elements.gridCount.textContent = `${grid.length} points`;

let dailyForecast: ForecastPoint[] = [];
const hourlyForecastByDate = new Map<string, HourlyForecastPoint[]>();
let currentDisplayPoints: DisplayPoint[] = [];
let currentSummary: RenderSummary = {
  points: [],
  pointsAtOrBelowThreshold: [],
  minimum: null,
  maximum: null,
};

const mapController = createMap('map', (summary) => {
  currentSummary = summary;
  renderSummary();
});

registerEvents();
void loadDailyForecast();

function registerEvents(): void {
  elements.thresholdRange.addEventListener('input', () => {
    elements.thresholdOutput.textContent = formatThreshold(
      Number(elements.thresholdRange.value),
    );
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

  elements.sourceSelect.addEventListener('change', () => {
    saveSourceSelection();
    updateSourceHelp();
    hourlyForecastByDate.clear();
    void loadDailyForecast();
  });

  elements.displaySelect.addEventListener('change', () => {
    saveDisplaySelection();
    updateDisplayHelp();
    renderMap();
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
  setLoading('Chargement des prévisions', 'Lecture du cache navigateur…');
  clearError();
  elements.refreshButton.disabled = true;
  elements.dateSelect.disabled = true;
  mapController.clear();

  try {
    dailyForecast = await fetchDailyForecast(
      grid,
      selectedSource(),
      (progress) => updateProgress(progress, 'Prévisions journalières'),
      forceRefresh,
    );

    if (!dailyForecast.length || !dailyForecast[0].daily.dates.length) {
      throw new Error('Aucune prévision journalière reçue.');
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
    'Chargement du détail horaire',
    `Températures du ${formatShortDate(dateIso)}…`,
  );

  try {
    const cacheKey = hourlyMemoryCacheKey(dateIso);
    let hourlyForecast = hourlyForecastByDate.get(cacheKey);

    if (!hourlyForecast) {
      hourlyForecast = await fetchHourlyForecastForDate(
        grid,
        dateIso,
        selectedSource(),
        (progress) => updateProgress(progress, 'Prévisions horaires'),
      );
      hourlyForecastByDate.set(cacheKey, hourlyForecast);
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
  mapController.render(currentDisplayPoints, threshold, selectedDisplay());
}

function renderSummary(): void {
  const allPoints = [...currentSummary.points].sort(
    (left, right) => left.temperature - right.temperature,
  );

  elements.visibleCount.textContent = String(
    currentSummary.pointsAtOrBelowThreshold.length,
  );
  elements.minimumValue.textContent = formatTemperature(currentSummary.minimum);
  elements.maximumValue.textContent = formatTemperature(currentSummary.maximum);
  elements.legendMin.textContent = formatTemperature(currentSummary.minimum);
  elements.legendMax.textContent = formatTemperature(currentSummary.maximum);
  elements.coolestContext.textContent = allPoints.length
    ? 'toutes les mesures'
    : '';

  elements.coolestList.replaceChildren();

  if (!allPoints.length) {
    const item = document.createElement('li');
    item.className = 'empty-list';
    item.textContent = 'Aucune température disponible pour cette sélection.';
    elements.coolestList.append(item);
    return;
  }

  const coolestAreas = selectSpatiallyDistinctPoints(allPoints, 7, 28);

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

function selectedSource(): WeatherSource {
  return elements.sourceSelect.value as WeatherSource;
}

function selectedDisplay(): MapDisplayMode {
  return elements.displaySelect.value as MapDisplayMode;
}

function hourlyMemoryCacheKey(dateIso: string): string {
  return `${selectedSource()}:${dateIso}`;
}

function updateProgress(progress: FetchProgress, label: string): void {
  if (progress.waitingSeconds && progress.waitingSeconds > 0) {
    setLoading(
      label,
      `Limite de l'API protégée : reprise dans ${progress.waitingSeconds} s…`,
    );
    return;
  }

  const percent = Math.round(
    (progress.completedChunks / progress.totalChunks) * 100,
  );
  const origin = progress.fromCache ? 'cache navigateur' : 'réseau';

  setLoading(
    label,
    `${progress.completedChunks}/${progress.totalChunks} groupes chargés — ${percent} % (${origin})`,
  );
}

function updateSourceHelp(): void {
  const descriptions: Record<WeatherSource, string> = {
    auto: "Open-Meteo choisit le meilleur modèle disponible, jusqu'à 16 jours.",
    meteoswiss:
      "MeteoSwiss ICON-CH2 via Open-Meteo, haute résolution, jusqu'à 5 jours.",
    global: "Modèle global GFS via Open-Meteo, jusqu'à 16 jours.",
  };

  elements.sourceHelp.textContent = descriptions[selectedSource()];
}

function restoreSourceSelection(): void {
  try {
    const storedSource = localStorage.getItem(SOURCE_STORAGE_KEY);
    if (
      storedSource === 'auto' ||
      storedSource === 'meteoswiss' ||
      storedSource === 'global'
    ) {
      elements.sourceSelect.value = storedSource;
    }
  } catch {
    // Le choix Auto reste utilisé si le stockage est indisponible.
  }
}

function saveSourceSelection(): void {
  try {
    localStorage.setItem(SOURCE_STORAGE_KEY, selectedSource());
  } catch {
    // Le choix reste valable pour la session courante.
  }
}

function updateDisplayHelp(): void {
  const descriptions: Record<MapDisplayMode, string> = {
    colors:
      'Toutes les cellules sont affichées : bleu pour les plus froides, rouge pour les plus chaudes. Le seuil ajoute un contour bleu foncé aux températures égales ou inférieures.',
    temperatures:
      'Chaque point affiche la température arrondie. Les valeurs égales ou inférieures au seuil sont encadrées en bleu foncé.',
  };

  elements.displayHelp.textContent = descriptions[selectedDisplay()];
}

function restoreDisplaySelection(): void {
  try {
    const storedDisplay = localStorage.getItem(DISPLAY_STORAGE_KEY);
    if (storedDisplay === 'colors' || storedDisplay === 'temperatures') {
      elements.displaySelect.value = storedDisplay;
    }
  } catch {
    // L'affichage par carrés reste utilisé si le stockage est indisponible.
  }
}

function saveDisplaySelection(): void {
  try {
    localStorage.setItem(DISPLAY_STORAGE_KEY, selectedDisplay());
  } catch {
    // Le choix reste valable pour la session courante.
  }
}

function setLoading(title: string, detail: string): void {
  elements.statusCard.classList.remove('is-hidden');
  elements.loadingBlock.classList.remove('is-hidden');
  elements.statusTitle.textContent = title;
  elements.statusDetail.textContent = detail;
}

function setReady(): void {
  elements.loadingBlock.classList.add('is-hidden');
  elements.statusCard.classList.add('is-hidden');
}

function showError(error: unknown): void {
  setReady();

  const message = error instanceof Error ? error.message : String(error);

  elements.statusCard.classList.remove('is-hidden');
  elements.errorBlock.classList.remove('is-hidden');
  elements.errorBlock.innerHTML = `
    <strong>Impossible de charger la météo.</strong>
    <p>${escapeHtml(message)}</p>
    <p>Les données déjà obtenues restent dans le cache du navigateur pendant six heures et survivent à F5.</p>
  `;
}

function clearError(): void {
  elements.errorBlock.classList.add('is-hidden');
  elements.errorBlock.replaceChildren();
}

function formatTemperature(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)} °C`;
}

function formatThreshold(value: number): string {
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)} °C`;
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
    throw new Error(`Élément #${id} introuvable.`);
  }

  return element as T;
}

function escapeHtml(value: string): string {
  const element = document.createElement('div');
  element.textContent = value;
  return element.innerHTML;
}
