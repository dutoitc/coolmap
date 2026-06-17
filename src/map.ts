import L, { type LatLngExpression, type LayerGroup } from 'leaflet';
import 'leaflet/dist/leaflet.css';

import {
  GRID_LATITUDE_STEP,
  GRID_LONGITUDE_STEP,
  SWITZERLAND_BORDER,
} from './data/switzerland';
import type { DisplayPoint, MapDisplayMode } from './types';

export interface MapController {
  render(
    points: DisplayPoint[],
    threshold: number,
    displayMode: MapDisplayMode,
  ): void;
  focus(point: DisplayPoint): void;
  clear(): void;
}

export interface RenderSummary {
  points: DisplayPoint[];
  pointsAtOrBelowThreshold: DisplayPoint[];
  minimum: number | null;
  maximum: number | null;
}

type WeatherLayer = L.Rectangle | L.Marker;

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
  const pointLayers = new Map<string, WeatherLayer>();

  function render(
    points: DisplayPoint[],
    threshold: number,
    displayMode: MapDisplayMode,
  ): void {
    weatherLayer.clearLayers();
    pointLayers.clear();

    const temperatures = points.map((point) => point.temperature);
    const minimum = temperatures.length ? Math.min(...temperatures) : null;
    const maximum = temperatures.length ? Math.max(...temperatures) : null;
    const pointsAtOrBelowThreshold = points.filter(
      (point) => point.temperature <= threshold,
    );

    if (minimum !== null && maximum !== null) {
      for (const point of points) {
        const color = colorForTemperature(point.temperature, minimum, maximum);
        const isHighlighted = point.temperature <= threshold;
        const layer =
          displayMode === 'temperatures'
            ? createTemperatureMarker(point, color, isHighlighted)
            : createTemperatureRectangle(point, color, isHighlighted);

        layer.bindPopup(createPopup(point), {
          maxWidth: 280,
        });
        layer.addTo(weatherLayer);
        pointLayers.set(point.id, layer);
      }
    }

    onRender?.({
      points,
      pointsAtOrBelowThreshold,
      minimum,
      maximum,
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
    onRender?.({
      points: [],
      pointsAtOrBelowThreshold: [],
      minimum: null,
      maximum: null,
    });
  }

  return { render, focus, clear };
}

function createTemperatureRectangle(
  point: DisplayPoint,
  color: string,
  isHighlighted: boolean,
): L.Rectangle {
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

  const normalStyle: L.PathOptions = {
    stroke: isHighlighted,
    color: '#0b3d66',
    opacity: isHighlighted ? 0.95 : 0,
    weight: isHighlighted ? 2 : 0,
    fillColor: color,
    fillOpacity: isHighlighted ? 0.34 : 0.28,
    interactive: true,
  };

  const rectangle = L.rectangle(bounds, normalStyle);

  rectangle.on('mouseover', () => {
    rectangle.setStyle({
      fillOpacity: 0.52,
      color: '#0b3d66',
      opacity: 0.95,
      weight: isHighlighted ? 3 : 1,
      stroke: true,
    });
  });

  rectangle.on('mouseout', () => {
    rectangle.setStyle(normalStyle);
  });

  return rectangle;
}

function createTemperatureMarker(
  point: DisplayPoint,
  color: string,
  isHighlighted: boolean,
): L.Marker {
  const temperature = Math.round(point.temperature);
  const highlightedClass = isHighlighted ? ' is-threshold-highlighted' : '';
  const icon = L.divIcon({
    className: 'temperature-label-icon',
    html: `<span class="temperature-label${highlightedClass}" style="--temperature-color: ${color}">${temperature}°</span>`,
    iconSize: [34, 22],
    iconAnchor: [17, 11],
  });

  return L.marker([point.latitude, point.longitude], {
    icon,
    keyboard: true,
    title: `${point.temperature.toFixed(1)} °C`,
  });
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

function colorForTemperature(
  temperature: number,
  minimum: number,
  maximum: number,
): string {
  if (maximum <= minimum) {
    return '#6c9fc6';
  }

  const ratio = clamp((temperature - minimum) / (maximum - minimum), 0, 1);
  const stops = [
    { position: 0, color: [36, 87, 165] },
    { position: 0.25, color: [64, 157, 191] },
    { position: 0.5, color: [241, 210, 91] },
    { position: 0.75, color: [232, 134, 55] },
    { position: 1, color: [200, 62, 50] },
  ];

  const upperIndex = stops.findIndex((stop) => ratio <= stop.position);
  if (upperIndex <= 0) {
    return rgbToHex(stops[0].color);
  }

  const lower = stops[upperIndex - 1];
  const upper = stops[upperIndex];
  const localRatio =
    (ratio - lower.position) / (upper.position - lower.position);

  const color = lower.color.map((channel, index) =>
    Math.round(channel + (upper.color[index] - channel) * localRatio),
  );

  return rgbToHex(color);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function rgbToHex(color: number[]): string {
  return `#${color
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`;
}

function formatAltitude(value: number | null): string {
  return value === null ? 'inconnue' : `${Math.round(value)} m`;
}

function formatNumber(value: number | null, unit: string): string {
  return value === null ? 'indisponible' : `${value.toFixed(1)} ${unit}`;
}
