/** Lean or fat mass per body segment, kg. */
export type Segmental = {
  rightArm: number;
  leftArm: number;
  trunk: number;
  rightLeg: number;
  leftLeg: number;
};

/** Every numeric measurement a scan can carry. All optional: a manual entry may have only weight. */
export type BodyScanValues = {
  /** kg */
  weight: number | null;
  /** Skeletal muscle mass, kg */
  skeletalMuscleMass: number | null;
  /** kg */
  bodyFatMass: number | null;
  /** Percent body fat, % */
  percentBodyFat: number | null;
  /** kg/m² */
  bmi: number | null;
  /** InBody visceral fat level, unitless (1–20) */
  visceralFatLevel: number | null;
  /** Basal metabolic rate, kcal/day */
  bmr: number | null;
  /** Total body water, L */
  totalBodyWater: number | null;
  /** Extracellular water / total body water ratio (≈0.36–0.40) */
  ecwRatio: number | null;
  /** InBody score, points (/100) */
  inbodyScore: number | null;
  /** kg */
  softLeanMass: number | null;
  /** kg */
  protein: number | null;
  /** kg */
  mineral: number | null;
  /** Bone mineral content, kg */
  boneMineralContent: number | null;
  /** Body cell mass, kg */
  bodyCellMass: number | null;
  /** Intracellular water, L */
  intracellularWater: number | null;
  /** Extracellular water, L */
  extracellularWater: number | null;
  /** Skeletal muscle index (arm + leg lean / height²), kg/m² */
  smi: number | null;
  /** Waist / hip, unitless */
  waistHipRatio: number | null;
  /** cm */
  waistCircumference: number | null;
  /** cm² */
  visceralFatArea: number | null;
  /** Whole-body phase angle, degrees */
  phaseAngle: number | null;
};

/** One body-composition measurement. */
export type BodyScan = BodyScanValues & {
  id: string;
  /** Epoch ms of the measurement (not of when it was saved). */
  measuredAt: number;
  source: "inbody" | "manual";
  /** Dedupes re-imports: `inbody:<minute>` for InBody tests with a time, so QR and CSV of one test meet. */
  externalId: string | null;
  /** InBody model, e.g. "270", "570". */
  device: string | null;
  /** Lean mass per segment, kg */
  segmentalLean: Segmental | null;
  /** Fat mass per segment, kg */
  segmentalFat: Segmental | null;
  /** ECW ratio per segment, unitless */
  segmentalEcw: Segmental | null;
  /** The original payload: QR text, or the CSV row as JSON (keeps columns without a field). */
  raw: string | null;
};

export type BodyScanInput = Omit<BodyScan, "id">;

/** Result of `POST /api/mobile/body/import`. */
export type BodyImport = { imported: number; skipped: { line: number; reason: string }[] };

/** A single weight or body-fat reading from Apple Health. */
export type BodySample = {
  /** HealthKit UUID */
  externalId: string;
  metric: "weight" | "percentBodyFat";
  /** kg or % */
  value: number;
  measuredAt: number;
};

/** Metrics with a trend, projection and goal. */
export const BODY_METRICS = ["weight", "bodyFatMass", "skeletalMuscleMass", "percentBodyFat"] as const;
export type BodyMetric = (typeof BODY_METRICS)[number];

export type BodyGoal = { metric: BodyMetric; target: number; setAt: number };

export type ProjectionPoint = { at: number; value: number; low: number; high: number };

export type BodyProjection = {
  metric: BodyMetric;
  unit: "kg" | "%";
  /** Daily medians the fit used, oldest first. */
  observed: { at: number; value: number }[];
  /** Trend value at the last observation; null when there is not enough data to fit. */
  current: number | null;
  slopePerWeek: number | null;
  /** The fitted line from the first observation to 12 weeks out, with an 80% band. */
  band: ProjectionPoint[];
  /** 4, 8 and 12 weeks after the last observation. */
  horizons: (ProjectionPoint & { weeks: number })[];
  goal: { target: number; eta: number | null; message: string } | null;
  /** Spanish, for the person: why there is no projection, or a one-line summary. */
  note: string;
};

/** What the QR parser returns to the phone before anything is saved. */
export type InBodyParse =
  | { ok: true; scan: BodyScanInput }
  | { ok: false; code: "unknown_inbody_format" | "unmapped_ibdata"; message: string; payloadId: string };
