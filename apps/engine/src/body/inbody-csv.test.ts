import { expect, test } from "bun:test";
import { inbodyId } from "./fields";
import { parseInBody } from "./inbody";
import { parseCsv, parseInBodyCsv } from "./inbody-csv";
import { addScan, addScans, listScans } from "./store";

/** The InBody app's export header, verbatim (including "Left leg" in lower case). Rows are invented. */
const HEADER =
  "Date,Measurement device.,Weight(kg),Skeletal Muscle Mass(kg),Soft Lean Mass(kg),Body Fat Mass(kg),BMI(kg/m²),Percent Body Fat(%),Basal Metabolic Rate(kcal),InBody Score,Right Arm Lean Mass(kg),Left Arm Lean Mass(kg),Trunk Lean Mass(kg),Right Leg Lean Mass(kg),Left leg Lean Mass(kg),Right Arm Fat Mass(kg),Left Arm Fat Mass(kg),Trunk Fat Mass(kg),Right Leg Fat Mass(kg),Left Leg Fat Mass(kg),Right Arm ECW Ratio,Left Arm ECW Ratio,Trunk ECW Ratio,Right Leg ECW Ratio,Left Leg ECW Ratio,Waist Hip Ratio,Waist Circumference(cm),Visceral Fat Area(cm²),Visceral Fat Level(Level),Total Body Water(L),Intracellular Water(L),Extracellular Water(L),ECW Ratio,Upper-Lower,Upper,Lower,Leg Muscle Level(Level),Leg Lean Mass(kg),Protein(kg),Mineral(kg),Bone Mineral Content(kg),Body Cell Mass(kg),SMI(kg/m²),Whole Body Phase Angle(°)";
const ROW_270 =
  "20250315091000,270,85.2,34.0,-,22.1,27.1,25.9,1650,71,3.50,3.45,27.0,9.10,9.05,1.9,2.0,11.0,3.4,3.4,-,-,-,-,-,0.93,-,-,9,44.0,-,-,-,0,0,0,-,-,11.8,3.95,-,-,8.4,-";
const ROW_570 =
  "20250101070500,570,88.0,33.1,-,25.5,28.0,29.0,1610,66,3.40,3.35,26.5,8.90,8.85,2.2,2.3,13.0,3.9,3.8,0.380,0.381,0.384,0.390,0.391,0.97,-,-,11,43.2,26.9,16.3,0.377,1,0,0,-,-,11.6,3.88,3.20,38.4,8.2,5.6";
const CSV = `﻿${HEADER}\r\n${ROW_270}\r\n${ROW_570}\r\n`;

test("reads the InBody app export: BOM, '-' as missing, segmental and device", () => {
  const { scans, skipped } = parseInBodyCsv(CSV);
  expect(skipped).toEqual([]);
  expect(scans).toHaveLength(2);
  const [a, b] = scans;
  expect(a).toMatchObject({
    device: "270", weight: 85.2, skeletalMuscleMass: 34, bodyFatMass: 22.1, percentBodyFat: 25.9, bmi: 27.1, bmr: 1650, inbodyScore: 71,
    visceralFatLevel: 9, totalBodyWater: 44, protein: 11.8, mineral: 3.95, smi: 8.4, waistHipRatio: 0.93,
    softLeanMass: null, ecwRatio: null, intracellularWater: null, segmentalEcw: null,
    segmentalLean: { rightArm: 3.5, leftArm: 3.45, trunk: 27, rightLeg: 9.1, leftLeg: 9.05 },
    segmentalFat: { rightArm: 1.9, leftArm: 2, trunk: 11, rightLeg: 3.4, leftLeg: 3.4 },
  });
  expect(a!.measuredAt).toBe(new Date(2025, 2, 15, 9, 10).getTime());
  expect(a!.externalId).toBe(inbodyId(a!.measuredAt));
  expect(JSON.parse(a!.raw!)["Upper-Lower"]).toBe("0");
  expect(b).toMatchObject({
    device: "570", ecwRatio: 0.377, intracellularWater: 26.9, extracellularWater: 16.3, boneMineralContent: 3.2, bodyCellMass: 38.4, phaseAngle: 5.6,
    segmentalEcw: { rightArm: 0.38, leftArm: 0.381, trunk: 0.384, rightLeg: 0.39, leftLeg: 0.391 },
  });
});

test("Spanish headers, semicolons and decimal commas", () => {
  const csv = 'Fecha;Equipo;Peso (kg);Masa Muscular Esquelética (kg);Porcentaje de Grasa Corporal (%);"Nivel de Grasa Visceral"\n15/03/2025 09:10;270;85,2;34,0;25,9;9\n';
  const { scans } = parseInBodyCsv(csv);
  expect(scans[0]).toMatchObject({ weight: 85.2, skeletalMuscleMass: 34, percentBodyFat: 25.9, visceralFatLevel: 9, device: "270" });
});

test("rows without a date or without composition are reported, not guessed", () => {
  const { scans, skipped } = parseInBodyCsv(`${HEADER}\n-,270,80.0\n20250101,270,-,-\n`);
  expect(scans).toHaveLength(0);
  expect(skipped).toEqual([
    { line: 2, reason: "Sin fecha legible." },
    { line: 3, reason: "Sin peso ni composición." },
  ]);
});

test("quoted fields keep separators and quotes", () => {
  expect(parseCsv('a,"b,c","say ""hi"""\n1,2,3', ",")).toEqual([["a", "b,c", 'say "hi"'], ["1", "2", "3"]]);
});

test("importing the same export twice, or the QR of the same test, keeps one scan per test", () => {
  const { scans } = parseInBodyCsv(CSV);
  addScans(scans);
  addScans(parseInBodyCsv(CSV).scans);
  const qr = parseInBody(`https://example.com/?WT=85.3&SMM=34.0&date=20250315091000`);
  if (!qr.ok) throw new Error(qr.message);
  addScan(qr.scan);
  const sameTest = listScans().filter((s) => s.externalId === inbodyId(new Date(2025, 2, 15, 9, 10).getTime()));
  expect(sameTest).toHaveLength(1);
  expect(sameTest[0]?.weight).toBe(85.3);
});
