import SwiftUI

/// Renders the Coach's Markdown for a phone: comfortable line spacing, lists
/// with hanging indents, and tables that never need sideways scrolling (a grid
/// when they fit, otherwise one card per row). Blocks come from `MarkdownBlock`;
/// each block's inline runs go through `AttributedString(markdown:)`.
struct CoachMarkdown: View {
    let text: String

    var body: some View {
        MarkdownBlocks(blocks: MarkdownBlock.parse(text), depth: 0)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct MarkdownBlocks: View {
    let blocks: [MarkdownBlock]
    let depth: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { index, block in
                MarkdownBlockView(block: block, depth: depth)
                    // Headings sit closer to what they introduce than to what came before.
                    .padding(.top, index > 0 && block.isHeading ? 8 : 0)
            }
        }
    }
}

private struct MarkdownBlockView: View {
    let block: MarkdownBlock
    let depth: Int

    var body: some View {
        switch block {
        case let .heading(level, text):
            Text(MarkdownInline.render(text))
                .font(level <= 2 ? .title3.weight(.bold) : .headline)
                .fontDesign(.rounded)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
        case let .paragraph(text):
            MarkdownText(text: text)
        case let .list(ordered, items):
            MarkdownList(ordered: ordered, items: items, depth: depth)
        case let .quote(blocks):
            MarkdownBlocks(blocks: blocks, depth: depth)
                .foregroundStyle(.secondary)
                .padding(.leading, 14)
                .overlay(alignment: .leading) { Capsule().fill(.tint.opacity(0.6)).frame(width: 3) }
        case let .code(text):
            Text(text)
                .font(.callout.monospaced())
                .fixedSize(horizontal: false, vertical: true)
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.fill.tertiary, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        case let .table(table):
            if table.fitsAsGrid {
                MarkdownGrid(table: table)
            } else {
                MarkdownRowCards(table: table)
            }
        case .rule:
            Divider().padding(.vertical, 4)
        }
    }
}

/// A paragraph with room between its lines.
private struct MarkdownText: View {
    let text: String

    var body: some View {
        Text(MarkdownInline.render(text))
            .lineSpacing(4)
            .fixedSize(horizontal: false, vertical: true)
    }
}

private struct MarkdownList: View {
    let ordered: Bool
    let items: [MarkdownListItem]
    let depth: Int

    private var bullet: String { ["•", "◦", "▪︎"][min(depth, 2)] }

    var body: some View {
        // Wide enough for the longest number, so every item's text starts at the same x.
        let markerWidth: CGFloat = ordered ? CGFloat((items.map(\.marker.count).max() ?? 2) * 10 + 2) : 12
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(ordered ? item.marker : bullet)
                        .foregroundStyle(ordered ? AnyShapeStyle(.secondary) : AnyShapeStyle(.tint))
                        .monospacedDigit()
                        .frame(width: markerWidth, alignment: ordered ? .trailing : .center)
                    MarkdownBlocks(blocks: item.blocks, depth: depth + 1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }
}

/// ≤3 short columns: a compact grid that wraps inside the screen width.
private struct MarkdownGrid: View {
    let table: MarkdownTable

    var body: some View {
        Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 14, verticalSpacing: 10) {
            if !table.header.isEmpty {
                row(table.header, header: true)
                Divider().gridCellUnsizedAxes(.horizontal)
            }
            ForEach(Array(table.rows.enumerated()), id: \.offset) { _, cells in
                row(cells, header: false)
            }
        }
        .font(.subheadline)
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.fill.quaternary, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func row(_ cells: [String], header: Bool) -> some View {
        GridRow {
            ForEach(0..<table.columns, id: \.self) { column in
                Text(MarkdownInline.render(column < cells.count ? cells[column] : ""))
                    .fontWeight(header ? .semibold : nil)
                    .foregroundStyle(header ? .secondary : .primary)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
}

/// Wider tables: one card per row, the first cell as its title and the rest as
/// "header: value" lines. Nothing is clipped and nothing scrolls sideways.
private struct MarkdownRowCards: View {
    let table: MarkdownTable

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(table.rows.enumerated()), id: \.offset) { _, cells in
                VStack(alignment: .leading, spacing: 6) {
                    if let title = cells.first {
                        if !table.header.isEmpty, table.header.count > 1, !table.header[0].isEmpty {
                            Text(table.header[0].uppercased())
                                .font(.caption2.weight(.semibold))
                                .tracking(0.5)
                                .foregroundStyle(.secondary)
                        }
                        Text(MarkdownInline.render(title))
                            .font(.subheadline.weight(.semibold))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    ForEach(Array(cells.dropFirst().enumerated()), id: \.offset) { offset, value in
                        if !value.isEmpty {
                            field(label: offset + 1 < table.header.count ? table.header[offset + 1] : nil, value: value)
                        }
                    }
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.fill.quaternary, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
        }
    }

    private func field(label: String?, value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            if let label, !label.isEmpty {
                Text(MarkdownInline.render(label)).font(.caption).foregroundStyle(.secondary)
            }
            Text(MarkdownInline.render(value))
                .font(.subheadline)
                .lineSpacing(2)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

enum MarkdownInline {
    /// Bold, italic, links and `code` (monospaced on a soft fill). Falls back to the raw text.
    static func render(_ text: String) -> AttributedString {
        guard var string = try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)) else {
            return AttributedString(text)
        }
        for run in string.runs where run.inlinePresentationIntent?.contains(.code) == true {
            string[run.range].font = .callout.monospaced()
            string[run.range].backgroundColor = Color.secondary.opacity(0.18)
        }
        return string
    }
}

private extension MarkdownBlock {
    var isHeading: Bool {
        if case .heading = self { return true }
        return false
    }
}
