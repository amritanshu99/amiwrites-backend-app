const mongoose = require("mongoose");

const CONFIG_KEY = "amiverse-pulse";

const DEFAULT_SCHEDULE_RULES = [
  {
    startHour: 5,
    endHour: 8,
    status: "Morning Walk / Fresh Start Mode",
    mood: "Energetic",
    vibe: "Discipline Mode",
    suggestion: "Perfect time for walking, planning, and winning the day.",
  },
  {
    startHour: 8,
    endHour: 18,
    status: "Builder Mode: Coding & Solving",
    mood: "Productive",
    vibe: "Deep Work",
    suggestion: "Deep work time. Build, fix, ship.",
  },
  {
    startHour: 18,
    endHour: 20,
    status: "Fitness / Family Reset Mode",
    mood: "Balanced",
    vibe: "Recharge Mode",
    suggestion: "Good time for workout, family, and recovery.",
  },
  {
    startHour: 20,
    endHour: 23,
    status: "AI Learning & Amiverse Mode",
    mood: "Focused",
    vibe: "Deep Focus",
    suggestion: "Good time to learn AI and improve one thing.",
  },
  {
    startHour: 23,
    endHour: 5,
    status: "Recharge Mode: Rest & Sleep",
    mood: "Calm",
    vibe: "Sleep & Recovery",
    suggestion: "Even builders need rest.",
  },
];

const DEFAULT_PULSE_CONFIG = {
  isEnabled: true,
  widgetTitle: "Amiverse Pulse",
  mode: "auto",
  manualStatus: "Building Amiverse",
  manualMood: "Focused",
  manualVibe: "Future-ready",
  manualSuggestion: "Small progress compounds daily.",
  ctaPrimary: {
    label: "Explore Projects",
    url: "/projects",
  },
  ctaSecondary: {
    label: "Read Blog",
    url: "/blog",
  },
  ownerCity: "Greater Noida",
  ownerRegion: "Uttar Pradesh",
  ownerCountry: "India",
  ownerLatitude: 28.4744,
  ownerLongitude: 77.504,
  ownerTimezone: "Asia/Kolkata",
  locationLabel: "Greater Noida, India",
  scheduleRules: DEFAULT_SCHEDULE_RULES,
};

function createDefaultPulseConfig() {
  return JSON.parse(JSON.stringify(DEFAULT_PULSE_CONFIG));
}

const ctaSchema = new mongoose.Schema(
  {
    label: { type: String, trim: true, maxlength: 80, default: "" },
    url: { type: String, trim: true, maxlength: 300, default: "" },
  },
  { _id: false },
);

const scheduleRuleSchema = new mongoose.Schema(
  {
    startHour: { type: Number, min: 0, max: 23, required: true },
    endHour: { type: Number, min: 0, max: 23, required: true },
    status: { type: String, trim: true, maxlength: 160, default: "" },
    mood: { type: String, trim: true, maxlength: 80, default: "" },
    vibe: { type: String, trim: true, maxlength: 80, default: "" },
    suggestion: { type: String, trim: true, maxlength: 240, default: "" },
  },
  { _id: false },
);

const pulseConfigSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      default: CONFIG_KEY,
      unique: true,
      index: true,
      select: false,
    },
    isEnabled: { type: Boolean, default: DEFAULT_PULSE_CONFIG.isEnabled },
    widgetTitle: {
      type: String,
      trim: true,
      maxlength: 120,
      default: DEFAULT_PULSE_CONFIG.widgetTitle,
    },
    mode: {
      type: String,
      enum: ["auto", "manual"],
      default: DEFAULT_PULSE_CONFIG.mode,
    },
    manualStatus: {
      type: String,
      trim: true,
      maxlength: 160,
      default: DEFAULT_PULSE_CONFIG.manualStatus,
    },
    manualMood: {
      type: String,
      trim: true,
      maxlength: 80,
      default: DEFAULT_PULSE_CONFIG.manualMood,
    },
    manualVibe: {
      type: String,
      trim: true,
      maxlength: 80,
      default: DEFAULT_PULSE_CONFIG.manualVibe,
    },
    manualSuggestion: {
      type: String,
      trim: true,
      maxlength: 240,
      default: DEFAULT_PULSE_CONFIG.manualSuggestion,
    },
    ctaPrimary: {
      type: ctaSchema,
      default: () => createDefaultPulseConfig().ctaPrimary,
    },
    ctaSecondary: {
      type: ctaSchema,
      default: () => createDefaultPulseConfig().ctaSecondary,
    },
    ownerCity: {
      type: String,
      trim: true,
      maxlength: 120,
      default: DEFAULT_PULSE_CONFIG.ownerCity,
    },
    ownerRegion: {
      type: String,
      trim: true,
      maxlength: 120,
      default: DEFAULT_PULSE_CONFIG.ownerRegion,
    },
    ownerCountry: {
      type: String,
      trim: true,
      maxlength: 120,
      default: DEFAULT_PULSE_CONFIG.ownerCountry,
    },
    ownerLatitude: {
      type: Number,
      min: -90,
      max: 90,
      default: DEFAULT_PULSE_CONFIG.ownerLatitude,
    },
    ownerLongitude: {
      type: Number,
      min: -180,
      max: 180,
      default: DEFAULT_PULSE_CONFIG.ownerLongitude,
    },
    ownerTimezone: {
      type: String,
      trim: true,
      maxlength: 80,
      default: DEFAULT_PULSE_CONFIG.ownerTimezone,
    },
    locationLabel: {
      type: String,
      trim: true,
      maxlength: 160,
      default: DEFAULT_PULSE_CONFIG.locationLabel,
    },
    scheduleRules: {
      type: [scheduleRuleSchema],
      default: () => createDefaultPulseConfig().scheduleRules,
    },
  },
  { timestamps: true },
);

const PulseConfig = mongoose.model("PulseConfig", pulseConfigSchema);

module.exports = PulseConfig;
module.exports.CONFIG_KEY = CONFIG_KEY;
module.exports.DEFAULT_SCHEDULE_RULES = DEFAULT_SCHEDULE_RULES;
module.exports.DEFAULT_PULSE_CONFIG = DEFAULT_PULSE_CONFIG;
module.exports.createDefaultPulseConfig = createDefaultPulseConfig;
