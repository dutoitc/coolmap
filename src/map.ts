import L, { type LatLngExpression, type LayerGroup } from 'leaflet';
import 'leaflet/dist/leaflet.css';

import {
  GRID_LATITUDE_STEP,
  GRID_LONGITUDE_STEP,
  SWITZERLAND_BORDER,
} from './data/switzerland';
import type { DisplayPoint } from './types';

export interface MapController {
  render(points: DisplayPoint[], threshold: number): void;
  focus(point: DisplayPoint): void;
  clear(): void;
}

export interface RenderSummary {
  visiblePoints: DisplayPoint[];
  minimum: number | null;
  maximum: number | null;
}

export function createMap(
  elementId: string,
  onRender?: (summary: RenderSummary) => void,
): MapController {
  const map = L.map(elementId, {
    center: [46.82, 8.22],
    zoom: 8,
    minZoom: 7,
    maxZoom: 14,
    zoomControl: true,
    preferCanvas: true,
  });

  map.setMaxBounds([
    [44.9, 4.8],
    [48.7, 11.7],
  ]);

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  const borderLatLngs: LatLngExpression[] = SWITZERLAND_BORDER.map(
    ([longitude, latitude]) => [latitude, longitude],
  );

  L.polygon(borderLatLngs, {
    color: '#18333d',
    weight: 2,
    opacity: 0.72,
    fill: false,
    interactive: false,
  }).addTo(map);

  const weatherLayer: LayerGroup = L.layerGroup().addTo(map);
  const pointLayers = new Map<string, L.Rectangle>();

  function render(points: DisplayPoint[], threshold: number): void {
    weatherLayer.clearLayers();
    pointLayers.clear();

    const visiblePoints = points.filter(
      (point) => point.temperature <= threshold,
    );

    for (const point of visiblePoints) {
      const bounds: L.LatLngBoundsExpression = [
        [
          point.latitude - GRID_LATITUDE_STEP / 2,
          point.longitude - GRID_LONGITUDE_STEP / 2,
        ],
        [
          point.latitude + GRID_LATITUDE_STEP / 2,
          point.longitude + GRID_LONGITUDE_STEP / 2,
        ],
      ];

      const rectangle = L.rectangle(bounds, {
        stroke: false,
        fillColor: colorForTemperature(point.temperature, threshold),
        fillOpacity: opacityForTemperature(point.temperature, threshold),
        interactive: true,
      });

      rectangle.bindPopup(createPopup(point), {
        maxWidth: 280,
      });
      rectangle.addTo(weatherLayer);
      pointLayers.set(point.id, rectangle);
    }

    const temperatures = points.map((point) => point.temperature);
    onRender?.({
      visiblePoints,
      minimum: temperatures.length ? Math.min(...temperatures) : null,
      maximum: temperatures.length ? Math.max(...temperatures) : null,
    });
  }

  function focus(point: DisplayPoint): void {
    map.flyTo([point.latitude, point.longitude], Math.max(map.getZoom(), 11), {
      duration: 0.65,
    });
    pointLayers.get(point.id)?.openPopup();
  }

  function clear(): void {
    weatherLayer.clearLayers();
    pointLayers.clear();
    onRender?.({ visiblePoints: [], minimum: null, maximum: null });
  }

  return { render, focus, clear };
}

function createPopup(point: DisplayPoint): HTMLElement {
  const container = document.createElement('div');
  container.className = 'weather-popup';

  const title = document.createElement('strong');
  title.textContent = `${point.temperature.toFixed(1)} °C`;
  container.append(title);

  const details = document.createElement('dl');
  details.innerHTML = `
    <div><dt>Altitude</dt><dd>${formatAltitude(point.elevation)}</dd></div>
    <div><dt>Précipitations</dt><dd>${formatNumber(point.precipitation, 'mm')}</dd></div>
    <div><dt>Vent maximal</dt><dd>${formatNumber(point.windSpeed, 'km/h')}</dd></div>
    <div><dt>Coordonnées</dt><dd>${point.latitude.toFixed(3)}, ${point.longitude.toFixed(3)}</dd></div>
  `;
  container.append(details);

  const links = document.createElement('div');
  links.className = 'popup-links';
  links.innerHTML = `
    <a href="https://map.geo.admin.ch/#/map?lang=fr&bgLayer=ch.swisstopo.pixelkarte-farbe&swisssearch=${point.longitude}%2C${point.latitude}&swisssearch_autoselect=true&z=8" target="_blank" rel="noreferrer">Swisstopo</a>
    <a href="https://www.openstreetmap.org/?mlat=${point.latitude}&mlon=${point.longitude}#map=13/${point.latitude}/${point.longitude}" target="_blank" rel="noreferrer">OpenStreetMap</a>
  `;
  container.append(links);

  return container;
}

function colorForTemperature(temperature: number, threshold: number): string {
  const delta = threshold - temperature;
  if (delta >= 10) return '#2457a5';
  if (delta >= 7) return '#3c89bd';
  if (delta >= 4) return '#70c3cf';
  if (delta >= 2) return '#a8dbca';
  return '#e8edbd';
}

function opacityForTemperature(temperature: number, threshold: number): number {
  const delta = Math.max(0, threshold - temperature);
  return Math.min(0.78, 0.46 + delta * 0.025);
}

function formatAltitude(value: number | null): string {
  return value === null ? 'inconnue' : `${Math.round(value)} m`;
}

function formatNumber(value: number | null, unit: string): string {
  return value === null ? 'indisponible' : `${value.toFixed(1)} ${unit}`;
}
