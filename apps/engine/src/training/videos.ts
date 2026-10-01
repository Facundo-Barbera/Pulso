import type { ExerciseVideo } from "@pulso/contract";

/**
 * Curated technique videos for the main lifts, keyed by library id. Only ids,
 * titles and channels: the phone plays them in YouTube's embedded player.
 * Every id was checked against YouTube's oEmbed endpoint.
 */
export const VIDEOS: Record<string, ExerciseVideo[]> = {
  "press-banca": [
    { youtubeId: "Kpy3Lt5vPDE", title: "Cómo hacer press banca - Ejercicio para desarrollar pectorales", channel: "Entrena con Sergio Peinado", lang: "es" },
    { youtubeId: "vcBig73ojpE", title: "How To Get A Huge Bench Press with Perfect Technique", channel: "Jeff Nippard", lang: "en" },
  ],
  sentadilla: [
    { youtubeId: "jAOoJU3afyU", title: "7 ERRORES que DEBES EVITAR en SENTADILLA", channel: "Fit Generation", lang: "es" },
    { youtubeId: "bEv6CCg2BC8", title: "How To Get A Huge Squat With Perfect Technique (Fix Mistakes)", channel: "Jeff Nippard", lang: "en" },
  ],
  "peso-muerto": [
    { youtubeId: "kancsOn7CJY", title: "Cómo hacer PESO MUERTO CONVENCIONAL como un PROFESIONAL (guía completa)", channel: "Fit Generation", lang: "es" },
    { youtubeId: "VL5Ab0T07e4", title: "Build A Bigger Deadlift With Perfect Technique (Conventional Form)", channel: "Jeff Nippard", lang: "en" },
  ],
  "press-militar": [
    { youtubeId: "j_Buh54Sb-w", title: "PRESS MILITAR - (TÉCNICA, CONSEJOS, ERRORES COMUNES ETC.)", channel: "Powerexplosive", lang: "es" },
    { youtubeId: "_RlRDWO2jfg", title: "Build Bigger Shoulders With Perfect Training Technique (The Overhead Press)", channel: "Jeff Nippard", lang: "en" },
  ],
  "remo-barra": [
    { youtubeId: "GkFMhqOH51s", title: "¡NO HAGAS REMO CON BARRA ASÍ! 5 errores graves", channel: "Fit Generation", lang: "es" },
    { youtubeId: "RQU8wZPbioA", title: "How To Barbell Row", channel: "Alan Thrall (Untamed Strength)", lang: "en" },
  ],
  dominadas: [
    { youtubeId: "FRb8IoX77mQ", title: "Cómo hacer dominadas - Los 5 errores más comunes", channel: "Entrena con Sergio Peinado", lang: "es" },
    { youtubeId: "Hdc7Mw6BIEE", title: "The Best Way To Do Pull Ups For A Wide Back (Optimal Training Technique)", channel: "Jeff Nippard", lang: "en" },
  ],
  "peso-muerto-rumano": [
    { youtubeId: "rjvlSfZ-PQw", title: "Cómo Hacer PESO MUERTO RUMANO Perfecto (paso a paso)", channel: "Fit Generation", lang: "es" },
    { youtubeId: "_oyxCn2iSjU", title: "HOW TO DO ROMANIAN DEADLIFTS (RDLs): Build Beefy Hamstrings With Perfect Technique", channel: "Jeff Nippard", lang: "en" },
  ],
  "hip-thrust": [
    { youtubeId: "3aTb9Megbuo", title: "HIP THRUST: MEJOR EJERCICIO DE GLÚTEO (TUTORIAL COMPLETO) - Técnica, errores, consejos...", channel: "Powerexplosive", lang: "es" },
    { youtubeId: "xDmFkJxPzeM", title: "How To Build Great Glutes with Perfect Hip Thrust Technique (Fix Mistakes!)", channel: "Jeff Nippard", lang: "en" },
  ],
  "jalon-pecho": [
    { youtubeId: "EO9AmI-bu_0", title: "Cómo hacer Jalón al Pecho para Dorsal (sin errores)", channel: "Fit Generation", lang: "es" },
    { youtubeId: "VXKfH6ciEBI", title: "Improve Your Lat Pulldown For Growth | Targeting The Muscle Series", channel: "Renaissance Periodization", lang: "en" },
  ],
  prensa: [
    { youtubeId: "SBynQ6-DyKo", title: "Consigue PIERNAS GRANDES con ESTE EJERCICIO (Prensa Inclinada)", channel: "Fit Generation", lang: "es" },
    { youtubeId: "B6rGDcfyPto", title: "How To Leg Press For Best Quad Growth | Targeting The Muscle Series", channel: "Renaissance Periodization", lang: "en" },
  ],
  zancadas: [
    { youtubeId: "J2PXanV4TPM", title: "TODO SOBRE LAS ZANCADAS para MAXIMIZAR GLÚTEOS y PIERNAS", channel: "Powerexplosive", lang: "es" },
    { youtubeId: "0MZd3iKzzPM", title: "10 Lunge Mistakes and How to Fix Them", channel: "Renaissance Periodization", lang: "en" },
  ],
  "sentadilla-bulgara": [
    { youtubeId: "6d6HlPWgAUs", title: "Piernas y Glúteos DE ACERO con la SENTADILLA BÚLGARA perfecta", channel: "Fit Generation", lang: "es" },
    { youtubeId: "hPlKPjohFS0", title: "The PERFECT Bulgarian Split Squat (Avoid These Errors!)", channel: "Squat University", lang: "en" },
  ],
  "curl-barra": [
    { youtubeId: "Aa-kUPuiXZA", title: "CURL DE BÍCEPS: ¡NO LO HAGAS como UN NOVATO!", channel: "Powerexplosive", lang: "es" },
    { youtubeId: "-moSw0_zJ5c", title: "8 Barbell Curl Mistakes and How to Fix Them", channel: "Renaissance Periodization", lang: "en" },
  ],
  "curl-mancuernas": [
    { youtubeId: "STq4k6wWrTY", title: "CURL DE BICEPS: Guía COMPLETA para MUTAR tus BÍCEPS", channel: "Powerexplosive", lang: "es" },
    { youtubeId: "in7PaeYlhrM", title: "The ONLY Way You Should Be Doing Dumbbell Bicep Curls!", channel: "Mind Pump TV", lang: "en" },
  ],
  "extension-triceps-polea": [
    { youtubeId: "fx4X-IBYxVI", title: "DESTRUYE TU TRÍCEPS ASÍ // Guía completa Tríceps con Polea", channel: "Powerexplosive", lang: "es" },
    { youtubeId: "yftl1tBWmKk", title: "10 Tricep Pushdown Mistakes and How To Fix Them", channel: "Renaissance Periodization", lang: "en" },
  ],
  "press-frances": [
    { youtubeId: "8t2a93BjDec", title: "How to Do SKULLCRUSHERS for BIG Triceps | Targeting The Muscle Series", channel: "Renaissance Periodization", lang: "en" },
  ],
  "press-inclinado-mancuernas": [
    { youtubeId: "nFaD2plIygA", title: "Domina el Press Inclinado: Técnicas Esenciales para un Pecho de Acero 💪", channel: "Powerexplosive", lang: "es" },
    { youtubeId: "0f6-uCUKqgA", title: "Incline Dumbbell Press BETTER | Targeting The Muscle Series", channel: "Renaissance Periodization", lang: "en" },
  ],
  "elevaciones-laterales": [
    { youtubeId: "yUJN62SBW08", title: "🤔 Cómo hacer las ELEVACIONES LATERALES 🤔", channel: "Powerexplosive", lang: "es" },
    { youtubeId: "v_ZkxWzYnMc", title: "How To Build Capped Shoulders: Optimal Training Explained (Side Delts)", channel: "Jeff Nippard", lang: "en" },
  ],
  fondos: [
    { youtubeId: "1Vm1ATIi0AE", title: "FONDOS EN PARALELAS (DIPS) - TECNICA, ERRORES, CONSEJOS ... (Todo sobre los fondos en paralelas)", channel: "Powerexplosive", lang: "es" },
    { youtubeId: "yN6Q1UI_xkE", title: "How To Do Dips For A Bigger Chest and Shoulders (Fix Mistakes!)", channel: "Jeff Nippard", lang: "en" },
  ],
  "remo-mancuerna": [
    { youtubeId: "fZYGcNtMWSc", title: "Cómo Hacer REMO CON MANCUERNA Perfecto (paso a paso)", channel: "Fit Generation", lang: "es" },
    { youtubeId: "djKXLt7kv7Q", title: "How To Do Dumbbell Rows: Build a Thicker Back With Proper \"Cheating\"", channel: "Jeff Nippard", lang: "en" },
  ],
};
