// ─── Live Info: real-time data Janjak can't get from local history ─────
// Currently: weather via wttr.in (free, no API key). Designed so more
// real-time sources (e.g. a web search) can be added later.

const WEATHER_KEYWORDS = /\b(weather|temperature|forecast|raining|rain|snow|sunny|cloudy|how (hot|cold|warm)|météo|fait[- ]il (chaud|froid))\b/i;

/** True if the question is asking about the weather. */
export function looksLikeWeatherQuestion(text: string): boolean {
  return WEATHER_KEYWORDS.test(text);
}

/**
 * Pull a location out of a weather question, e.g.
 * "what's the weather in Port-au-Prince?" → "Port-au-Prince".
 * Returns null when no place is mentioned.
 */
function extractLocation(text: string): string | null {
  const m =
    text.match(/\b(?:in|at|for|à|en|au|aux)\s+([A-Z][\w.'-]+(?:[ -][A-Z][\w.'-]+){0,3})/) ??
    text.match(/\b(?:in|at|for)\s+([a-z][\w.'-]+(?:[ -][\w.'-]+){0,2})\s*\??$/i);
  if (!m) return null;
  return m[1]
    .replace(/\b(right )?now\b/i, "")
    .replace(/[?.!,]+$/, "")
    .trim() || null;
}

interface WttrCurrent {
  temp_C?: string;
  FeelsLikeC?: string;
  humidity?: string;
  weatherDesc?: Array<{ value?: string }>;
  windspeedKmph?: string;
}

interface WttrDay {
  date?: string;
  maxtempC?: string;
  mintempC?: string;
  hourly?: Array<{ chanceofrain?: string }>;
}

/** Fetch a concise current-weather summary for a location (or null on failure). */
export async function getWeather(location: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(`https://wttr.in/${encodeURIComponent(location)}?format=j1`, {
      headers: { "User-Agent": "Janjak/1.0" },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { current_condition?: WttrCurrent[]; weather?: WttrDay[] };
    const cur = data.current_condition?.[0];
    const today = data.weather?.[0];
    if (!cur) return null;

    const desc = cur.weatherDesc?.[0]?.value ?? "";
    const parts = [
      `${location}: ${desc}, ${cur.temp_C}°C (feels like ${cur.FeelsLikeC}°C)`,
      cur.humidity ? `humidity ${cur.humidity}%` : "",
      cur.windspeedKmph ? `wind ${cur.windspeedKmph} km/h` : "",
    ].filter(Boolean);

    let summary = parts.join(", ");
    if (today?.maxtempC && today?.mintempC) {
      const rain = today.hourly?.some((h) => Number(h.chanceofrain ?? 0) >= 50);
      summary += `. Today: high ${today.maxtempC}°C / low ${today.mintempC}°C${rain ? ", rain likely" : ""}`;
    }
    return summary;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Best-effort live-info enrichment for a question. Returns a context block to
 * append to the prompt, or "" when nothing applies.
 */
export async function fetchLiveInfo(question: string): Promise<string> {
  if (looksLikeWeatherQuestion(question)) {
    const location = extractLocation(question);
    if (!location) {
      return "\nLIVE WEATHER: The user asked about the weather but didn't say where. Ask them which city.";
    }
    const weather = await getWeather(location);
    if (weather) {
      return `\nLIVE WEATHER (real-time): ${weather}`;
    }
    return `\nLIVE WEATHER: Couldn't fetch live weather for "${location}" right now.`;
  }
  return "";
}
