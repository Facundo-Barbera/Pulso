# Knowledge — the Coach's evidence base

Short, curated cards that let the Coach answer with concrete numbers and a reason instead of generic advice. One topic per Markdown file in `cards/`, written in Spanish (the person's language), sources cited in their original language.

## Scope
Nutrition, training, body composition, sleep and recovery, medication timing (the person's own medications: GLP-1 receptor agonists, levothyroxine), supplements with solid evidence, and alcohol/cannabis from a harm-reduction stance. Cards inform coaching; they never diagnose, change a prescribed dose or replace a professional — every card has a "Cuándo derivar a un profesional" section.

Sources, in order of preference: position stands and consensus statements (ISSN, ACSM, IOC, AASM/SRS), official guidelines and reference intakes (WHO, EFSA, IOM/NASEM, ATA, ADA), drug labels, then systematic reviews and meta-analyses. Single small studies only to illustrate, labelled as such. Paraphrase; no long excerpts.

## How it is used
- `store.ts` reads every card once and ranks them with BM25 over title (×3), tags (×3) and body. Tokens are lowercased, without accents, lightly de-pluralised; `SYNONYMS` maps colloquial words (café, Ozempic, porro…) to what cards are tagged with.
- `consult_knowledge(query, topics?, limit?)` (`tools.ts`, read-only) returns the best cards with evidence level, review date and sources. The persona's "Conocimiento" section tells the Coach to call it before any numeric recommendation.
- `knowledgeIndex()` puts the card titles (not their content) in every turn's workspace CLAUDE.md, so the Coach knows what exists.

## Adding or updating a card
1. Create or edit `cards/<id>.md` (kebab-case Spanish id without accents, equal to the file name):
   ```
   ---
   id: proteina-diaria
   title: Proteína diaria para entrenar y perder grasa
   topic: nutrition            # nutrition | training | body | sleep | medication | supplements | substances
   tags: proteína, protein, g/kg, …   # one line; the words a person would type, Spanish and English
   evidence: alta              # alta | moderada | baja
   reviewed: 2026-10-02
   ---
   ## Recomendación
   ## Cuándo aplica
   ## Matices
   ## Cuándo derivar a un profesional
   ## Fuentes
   - Authors/Org. Title. Journal/Publisher, Year. URL
   ```
2. Every number must come from a source in `## Fuentes` that you opened. Keep it to ~150–350 words before the sources; no tables (it is read on a phone).
3. Add the question that should find it to `EVAL` in `knowledge.test.ts`, then run `bun test src/knowledge` from `apps/engine`. If it isn't retrieved, add tags (or a `SYNONYMS` entry) rather than stuffing the body.
4. Bump `reviewed` whenever you check a card against its sources, even if nothing changed.

## Review cadence
- Every card at least once a year (look for `reviewed` older than 12 months).
- Medication cards (`topic: medication`) every 6 months and whenever a guideline or drug label changes.
- Immediately when a cited organisation publishes a new position stand on the topic.
