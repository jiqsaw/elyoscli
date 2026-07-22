export interface WeatherCondition {
  temperature_c: number;
  condition: string;
  humidity: number;
}

export interface WeatherData {
  location: string;
  conditions: WeatherCondition[];
}

export interface ResearchData {
  topic: string;
  summary: string;
  sources: string[];
  generated_at: string;
}
