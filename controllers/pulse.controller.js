const PulseConfig = require("../models/PulseConfig");
const { fetchJson } = require("../utils/httpClient");

const ADMIN_USERNAME = "amritanshu99";
const DEFAULT_TIMEZONE = "Asia/Kolkata";
const WEATHER_CACHE_TTL_MS = 10 * 60 * 1000;
const weatherCache = new Map();

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isAdmin(req) {
  return req.user?.username === ADMIN_USERNAME;
}

function sanitizeString(value, maxLength) {
  if (value === undefined || value === null) return "";
  return String(value).trim().slice(0, maxLength);
}

function coerceBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return null;
}

function coerceNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function coerceHour(value) {
  const number = coerceNumber(value);
  if (!Number.isInteger(number) || number < 0 || number > 23) return null;
  return number;
}

function isValidTimezone(timezone) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

async function getOrCreatePulseConfig() {
  return PulseConfig.findOneAndUpdate(
    { key: PulseConfig.CONFIG_KEY },
    {
      $setOnInsert: {
        key: PulseConfig.CONFIG_KEY,
        ...PulseConfig.createDefaultPulseConfig(),
      },
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    },
  );
}

function serializeCta(cta) {
  return {
    label: cta?.label || "",
    url: cta?.url || "",
  };
}

function serializeScheduleRules(scheduleRules) {
  return Array.isArray(scheduleRules)
    ? scheduleRules.map((rule) => ({
        startHour: rule.startHour,
        endHour: rule.endHour,
        status: rule.status || "",
        mood: rule.mood || "",
        vibe: rule.vibe || "",
        suggestion: rule.suggestion || "",
      }))
    : [];
}

function serializePublicConfig(config) {
  return {
    isEnabled: Boolean(config.isEnabled),
    widgetTitle: config.widgetTitle || "Amiverse Pulse",
    mode: config.mode || "auto",
    manualStatus: config.manualStatus || "Building Amiverse",
    manualMood: config.manualMood || "Focused",
    manualVibe: config.manualVibe || "Future-ready",
    manualSuggestion: config.manualSuggestion || "Small progress compounds daily.",
    ctaPrimary: serializeCta(config.ctaPrimary),
    ctaSecondary: serializeCta(config.ctaSecondary),
    ownerCity: config.ownerCity || "",
    ownerRegion: config.ownerRegion || "",
    ownerCountry: config.ownerCountry || "",
    ownerTimezone: config.ownerTimezone || DEFAULT_TIMEZONE,
    locationLabel: config.locationLabel || "Location not configured",
    scheduleRules: serializeScheduleRules(config.scheduleRules),
    updatedAt: config.updatedAt,
  };
}

function serializeAdminConfig(config) {
  return {
    ...serializePublicConfig(config),
    ownerLatitude: config.ownerLatitude,
    ownerLongitude: config.ownerLongitude,
    createdAt: config.createdAt,
  };
}

function addStringField(update, body, field, maxLength) {
  if (hasOwn(body, field)) {
    update[field] = sanitizeString(body[field], maxLength);
  }
}

function addCoordinate(update, body, errors, field, min, max) {
  if (!hasOwn(body, field)) return;

  const number = coerceNumber(body[field]);
  if (number === null || number < min || number > max) {
    errors.push(`${field} must be a number between ${min} and ${max}`);
    return;
  }

  update[field] = number;
}

function addCta(update, body, errors, field) {
  if (!hasOwn(body, field)) return;

  const cta = body[field];
  if (!isObject(cta)) {
    errors.push(`${field} must be an object with label and url strings`);
    return;
  }

  if (hasOwn(cta, "label")) {
    update[`${field}.label`] = sanitizeString(cta.label, 80);
  }

  if (hasOwn(cta, "url")) {
    update[`${field}.url`] = sanitizeString(cta.url, 300);
  }
}

function sanitizeScheduleRules(value, errors) {
  if (!Array.isArray(value)) {
    errors.push("scheduleRules must be an array");
    return undefined;
  }

  return value.map((rule, index) => {
    if (!isObject(rule)) {
      errors.push(`scheduleRules[${index}] must be an object`);
      return null;
    }

    const startHour = coerceHour(rule.startHour);
    const endHour = coerceHour(rule.endHour);

    if (startHour === null) {
      errors.push(`scheduleRules[${index}].startHour must be an integer from 0 to 23`);
    }

    if (endHour === null) {
      errors.push(`scheduleRules[${index}].endHour must be an integer from 0 to 23`);
    }

    return {
      startHour,
      endHour,
      status: sanitizeString(rule.status, 160),
      mood: sanitizeString(rule.mood, 80),
      vibe: sanitizeString(rule.vibe, 80),
      suggestion: sanitizeString(rule.suggestion, 240),
    };
  });
}

function buildPulseUpdate(body) {
  const update = {};
  const errors = [];

  if (hasOwn(body, "isEnabled")) {
    const isEnabled = coerceBoolean(body.isEnabled);
    if (isEnabled === null) {
      errors.push("isEnabled must be a boolean");
    } else {
      update.isEnabled = isEnabled;
    }
  }

  if (hasOwn(body, "mode")) {
    const mode = sanitizeString(body.mode, 20);
    if (mode !== "auto" && mode !== "manual") {
      errors.push('mode must be either "auto" or "manual"');
    } else {
      update.mode = mode;
    }
  }

  addStringField(update, body, "widgetTitle", 120);
  addStringField(update, body, "manualStatus", 160);
  addStringField(update, body, "manualMood", 80);
  addStringField(update, body, "manualVibe", 80);
  addStringField(update, body, "manualSuggestion", 240);
  addStringField(update, body, "ownerCity", 120);
  addStringField(update, body, "ownerRegion", 120);
  addStringField(update, body, "ownerCountry", 120);
  addStringField(update, body, "locationLabel", 160);
  addCoordinate(update, body, errors, "ownerLatitude", -90, 90);
  addCoordinate(update, body, errors, "ownerLongitude", -180, 180);
  addCta(update, body, errors, "ctaPrimary");
  addCta(update, body, errors, "ctaSecondary");

  if (hasOwn(body, "ownerTimezone")) {
    const timezone = sanitizeString(body.ownerTimezone, 80) || DEFAULT_TIMEZONE;
    if (!isValidTimezone(timezone)) {
      errors.push("ownerTimezone must be a valid IANA timezone string");
    } else {
      update.ownerTimezone = timezone;
    }
  }

  if (hasOwn(body, "scheduleRules")) {
    const rules = sanitizeScheduleRules(body.scheduleRules, errors);
    if (rules) update.scheduleRules = rules;
  }

  return { update, errors };
}

function getWeatherCacheKey(config) {
  const latitude = Number(config.ownerLatitude);
  const longitude = Number(config.ownerLongitude);
  const updatedAt = config.updatedAt
    ? new Date(config.updatedAt).getTime()
    : "not-updated";

  return `${latitude.toFixed(3)}:${longitude.toFixed(3)}:${updatedAt}`;
}

function getCachedWeather(key) {
  const cached = weatherCache.get(key);
  if (!cached) return null;

  if (cached.expiresAt <= Date.now()) {
    weatherCache.delete(key);
    return null;
  }

  return cached.data;
}

function setCachedWeather(key, data) {
  weatherCache.set(key, {
    data,
    expiresAt: Date.now() + WEATHER_CACHE_TTL_MS,
  });

  if (weatherCache.size > 25) {
    const oldestKey = weatherCache.keys().next().value;
    weatherCache.delete(oldestKey);
  }
}

function normalizeWeatherData(weatherData, config) {
  const weather = Array.isArray(weatherData.weather) ? weatherData.weather[0] : {};
  const main = weatherData.main || {};
  const wind = weatherData.wind || {};

  return {
    city: weatherData.name || config.ownerCity || "",
    country: weatherData.sys?.country || config.ownerCountry || "",
    temp: Number.isFinite(main.temp) ? Math.round(main.temp) : null,
    feelsLike: Number.isFinite(main.feels_like) ? Math.round(main.feels_like) : null,
    humidity: Number.isFinite(main.humidity) ? main.humidity : null,
    windSpeed: Number.isFinite(wind.speed) ? wind.speed : null,
    condition: weather?.main || "Unavailable",
    description: weather?.description || "",
    icon: weather?.icon || "",
  };
}

exports.getPublicPulse = async (req, res) => {
  try {
    const config = await getOrCreatePulseConfig();
    return res.json({
      success: true,
      data: serializePublicConfig(config),
    });
  } catch (err) {
    console.error("Pulse config fetch failed:", err.message || err);
    return res.status(500).json({
      success: false,
      message: "Unable to load Amiverse Pulse",
    });
  }
};

exports.getAdminPulse = async (req, res) => {
  if (!isAdmin(req)) {
    return res.status(403).json({ success: false, message: "Only admin can view Pulse settings" });
  }

  try {
    const config = await getOrCreatePulseConfig();
    return res.json({
      success: true,
      data: serializeAdminConfig(config),
    });
  } catch (err) {
    console.error("Pulse admin fetch failed:", err.message || err);
    return res.status(500).json({
      success: false,
      message: "Unable to load Pulse settings",
    });
  }
};

exports.getOwnerWeather = async (req, res) => {
  try {
    const config = await getOrCreatePulseConfig();
    const latitude = Number(config.ownerLatitude);
    const longitude = Number(config.ownerLongitude);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return res.status(422).json({
        success: false,
        message: "Pulse owner location is not configured",
      });
    }

    const apiKey = process.env.OPENWEATHER_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        success: false,
        message: "Weather service is not configured",
      });
    }

    const cacheKey = getWeatherCacheKey(config);
    const cachedWeather = getCachedWeather(cacheKey);
    if (cachedWeather) {
      return res.json({ success: true, data: cachedWeather });
    }

    const url = new URL("https://api.openweathermap.org/data/2.5/weather");
    url.searchParams.set("lat", String(latitude));
    url.searchParams.set("lon", String(longitude));
    url.searchParams.set("appid", apiKey);
    url.searchParams.set("units", "metric");

    const { response, data } = await fetchJson(url.toString(), {
      timeoutMs: 8000,
      maxResponseBytes: 128 * 1024,
    });

    if (!response.ok) {
      console.error("OpenWeather request failed:", response.status);
      return res.status(502).json({
        success: false,
        message: "Weather service is temporarily unavailable",
      });
    }

    const normalizedWeather = normalizeWeatherData(data || {}, config);
    setCachedWeather(cacheKey, normalizedWeather);

    return res.json({
      success: true,
      data: normalizedWeather,
    });
  } catch (err) {
    console.error("Pulse weather fetch failed:", err.message || err);
    return res.status(502).json({
      success: false,
      message: "Weather service is temporarily unavailable",
    });
  }
};

exports.updatePulse = async (req, res) => {
  if (!isAdmin(req)) {
    return res.status(403).json({ success: false, message: "Only admin can update Pulse settings" });
  }

  try {
    const { update, errors } = buildPulseUpdate(req.body || {});

    if (errors.length) {
      return res.status(400).json({
        success: false,
        message: "Invalid Pulse settings",
        errors,
      });
    }

    const config = await getOrCreatePulseConfig();
    if (!Object.keys(update).length) {
      return res.json({
        success: true,
        message: "Amiverse Pulse updated successfully",
        data: serializeAdminConfig(config),
      });
    }

    const updatedConfig = await PulseConfig.findByIdAndUpdate(
      config._id,
      { $set: update },
      { new: true, runValidators: true },
    );

    weatherCache.clear();

    return res.json({
      success: true,
      message: "Amiverse Pulse updated successfully",
      data: serializeAdminConfig(updatedConfig),
    });
  } catch (err) {
    console.error("Pulse update failed:", err.message || err);
    return res.status(500).json({
      success: false,
      message: "Unable to update Amiverse Pulse",
    });
  }
};

exports.getOrCreatePulseConfig = getOrCreatePulseConfig;
