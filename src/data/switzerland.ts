import type { GridPoint } from '../types';

import { SWITZERLAND_BORDER } from './switzerland-border';

export { SWITZERLAND_BORDER };

export const GRID_LATITUDE_STEP = 0.075;
export const GRID_LONGITUDE_STEP = 0.1;

const BOUNDS = {
  minLatitude: 45.75,
  maxLatitude: 47.86,
  minLongitude: 5.96,
  maxLongitude: 10.5,
};

export function isInsideSwitzerland(longitude: number, latitude: number): boolean {
  let inside = false;

  for (
    let current = 0, previous = SWITZERLAND_BORDER.length - 1;
    current < SWITZERLAND_BORDER.length;
    previous = current++
  ) {
    const [currentLongitude, currentLatitude] = SWITZERLAND_BORDER[current];
    const [previousLongitude, previousLatitude] = SWITZERLAND_BORDER[previous];

    const crossesLatitude =
      currentLatitude > latitude !== previousLatitude > latitude;

    if (!crossesLatitude) {
      continue;
    }

    const intersectionLongitude =
      ((previousLongitude - currentLongitude) *
        (latitude - currentLatitude)) /
        (previousLatitude - currentLatitude) +
      currentLongitude;

    if (longitude < intersectionLongitude) {
      inside = !inside;
    }
  }

  return inside;
}

export function createSwissWeatherGrid(): GridPoint[] {
  const points: GridPoint[] = [];

  for (
    let latitude = BOUNDS.minLatitude;
    latitude <= BOUNDS.maxLatitude;
    latitude += GRID_LATITUDE_STEP
  ) {
    for (
      let longitude = BOUNDS.minLongitude;
      longitude <= BOUNDS.maxLongitude;
      longitude += GRID_LONGITUDE_STEP
    ) {
      const roundedLatitude = Number(latitude.toFixed(4));
      const roundedLongitude = Number(longitude.toFixed(4));

      if (!isInsideSwitzerland(roundedLongitude, roundedLatitude)) {
        continue;
      }

      points.push({
        id: `${roundedLatitude.toFixed(4)}-${roundedLongitude.toFixed(4)}`,
        latitude: roundedLatitude,
        longitude: roundedLongitude,
      });
    }
  }

  return points;
}
