/**
 * Dallas Weather Fetcher
 *
 * Fetches current weather for Dallas, TX via Open-Meteo API (free, no key needed)
 */

const axios = require('axios');

async function fetchDallasWeather() {
  const url = 'https://api.open-meteo.com/v1/forecast'
    + '?latitude=32.7767&longitude=-96.7970'
    + '&current=temperature_2m,weathercode,windspeed_10m'
    + '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max'
    + '&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America%2FChicago&forecast_days=1';

  const { data } = await axios.get(url, { timeout: 10000 });
  const c = data.current;
  const d = data.daily;

  // WMO weather code → human description
  const conditions = {
    0: 'clear skies', 1: 'mainly clear', 2: 'partly cloudy', 3: 'overcast',
    45: 'foggy', 48: 'icy fog', 51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle',
    61: 'light rain', 63: 'moderate rain', 65: 'heavy rain',
    71: 'light snow', 73: 'moderate snow', 75: 'heavy snow',
    80: 'rain showers', 81: 'moderate rain showers', 82: 'heavy rain showers',
    95: 'thunderstorms', 96: 'thunderstorms with hail',
  };
  const description = conditions[c.weathercode] ?? 'mixed conditions';

  return {
    current: Math.round(c.temperature_2m),
    high: Math.round(d.temperature_2m_max[0]),
    low: Math.round(d.temperature_2m_min[0]),
    precip: d.precipitation_probability_max[0],
    description,
    wind: Math.round(c.windspeed_10m),
  };
}

module.exports = { fetchDallasWeather };
