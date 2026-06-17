export interface GridPoint {
  id: string;
  latitude: number;
  longitude: number;
}

export interface DailyForecast {
  dates: string[];
  temperatureMax: Array<number | null>;
  precipitationSum: Array<number | null>;
  windSpeedMax: Array<number | null>;
}

export interface HourlyForecast {
  times: string[];
  temperatures: Array<number | null>;
}

export interface ForecastPoint extends GridPoint {
  elevation: number | null;
  daily: DailyForecast;
}

export interface HourlyForecastPoint extends GridPoint {
  elevation: number | null;
  hourly: HourlyForecast;
}

export interface DisplayPoint extends GridPoint {
  elevation: number | null;
  temperature: number;
  precipitation: number | null;
  windSpeed: number | null;
}

export type TemperatureMode = 'daily-max' | 'hourly';
export type MapDisplayMode = 'colors' | 'temperatures';
