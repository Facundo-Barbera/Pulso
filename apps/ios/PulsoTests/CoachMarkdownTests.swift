import XCTest
@testable import Pulso

/// The block parser on answers shaped like the Coach's real ones.
final class CoachMarkdownTests: XCTestCase {
    private func item(_ marker: String, _ text: String, _ children: MarkdownBlock...) -> MarkdownListItem {
        MarkdownListItem(marker: marker, blocks: [.paragraph(text)] + children)
    }

    func testRoutineAsHeadingsAndOneExercisePerLine() {
        let blocks = MarkdownBlock.parse("""
        Te propongo **Torso/Pierna** 4 días.

        ### Día 1 — Torso A
        - **Press banca** — 3×6–8 · 3 min
        - **Remo con barra** — 3×8–10 · 2 min

        ### Día 2 — Pierna A
        - **Sentadilla** — 4×5 · 3 min
        """)
        XCTAssertEqual(blocks, [
            .paragraph("Te propongo **Torso/Pierna** 4 días."),
            .heading(level: 3, text: "Día 1 — Torso A"),
            .list(ordered: false, items: [item("•", "**Press banca** — 3×6–8 · 3 min"), item("•", "**Remo con barra** — 3×8–10 · 2 min")]),
            .heading(level: 3, text: "Día 2 — Pierna A"),
            .list(ordered: false, items: [item("•", "**Sentadilla** — 4×5 · 3 min")]),
        ])
    }

    func testWideRoutineTableBecomesCardsNotAGrid() throws {
        let blocks = MarkdownBlock.parse("""
        **Semana 1**
        | Torso A | Torso B |
        |:--|:--|
        | Press banca 3×6–8 (3') | Press inclinado mancuernas 3×8–10 (2') |
        | Press hombro mancuernas 3×8–12 (2') | Jalón al pecho 3×10–12 (90'') |
        """)
        XCTAssertEqual(blocks.first, .paragraph("**Semana 1**"))
        guard case let .table(table) = try XCTUnwrap(blocks.last) else { return XCTFail("expected a table") }
        XCTAssertEqual(table.header, ["Torso A", "Torso B"])
        XCTAssertEqual(table.rows.count, 2)
        XCTAssertEqual(table.rows[1], ["Press hombro mancuernas 3×8–12 (2')", "Jalón al pecho 3×10–12 (90'')"])
        XCTAssertFalse(table.fitsAsGrid)
    }

    func testNarrowTableFitsAsGrid() throws {
        guard case let .table(table) = try XCTUnwrap(MarkdownBlock.parse("| Macro | Objetivo |\n|---|---|\n| Proteína | **160 g** |\n| Grasa | 70 g |").first) else { return XCTFail("expected a table") }
        XCTAssertEqual(table.columns, 2)
        XCTAssertTrue(table.fitsAsGrid)
        XCTAssertFalse(MarkdownTable(header: ["L", "M", "X", "J"], rows: [["a", "b", "c", "d"]]).fitsAsGrid)
    }

    func testMealPlanWithNestedLists() {
        let blocks = MarkdownBlock.parse("""
        1. **Desayuno** — 520 kcal
           - Avena — 60 g
           - Leche — 250 ml
        2. **Comida** — 750 kcal
            - Arroz — 80 g
        """)
        XCTAssertEqual(blocks, [
            .list(ordered: true, items: [
                item("1.", "**Desayuno** — 520 kcal", .list(ordered: false, items: [item("•", "Avena — 60 g"), item("•", "Leche — 250 ml")])),
                item("2.", "**Comida** — 750 kcal", .list(ordered: false, items: [item("•", "Arroz — 80 g")])),
            ]),
        ])
    }

    func testListItemsKeepContinuationsAndSurviveBlankLines() {
        let blocks = MarkdownBlock.parse("""
        - **Sentadilla**
        baja hasta paralelo

        - Peso muerto

        Fin.
        """)
        XCTAssertEqual(blocks, [
            .list(ordered: false, items: [item("•", "**Sentadilla**\nbaja hasta paralelo"), item("•", "Peso muerto")]),
            .paragraph("Fin."),
        ])
    }

    func testQuotesRulesAndCode() {
        let blocks = MarkdownBlock.parse("""
        > **Ojo:** si duele,
        > para.
        ---
        ```
        A 3x5
        ```
        """)
        XCTAssertEqual(blocks, [.quote([.paragraph("**Ojo:** si duele,\npara.")]), .rule, .code("A 3x5")])
    }

    func testBoldLinesAreNotListsOrRules() {
        XCTAssertEqual(MarkdownBlock.parse("**Press banca** — 3×6\n***"), [.paragraph("**Press banca** — 3×6"), .rule])
    }

    func testHalfStreamedInputStillRenders() {
        XCTAssertEqual(MarkdownBlock.parse("Mira:\n```\nA 3x5"), [.paragraph("Mira:"), .code("A 3x5")])
        XCTAssertEqual(MarkdownBlock.parse("| Día | Foco |"), [.table(MarkdownTable(header: [], rows: [["Día", "Foco"]]))])
        XCTAssertEqual(MarkdownBlock.parse("### "), [.heading(level: 3, text: "")])
    }
}
