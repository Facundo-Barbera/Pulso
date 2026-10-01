import SwiftUI

/// Renders the Coach's Markdown. `Text` only understands inline Markdown, so
/// blocks (headings, lists, tables, code, quotes) are split out here and each
/// block's inline runs go through `AttributedString(markdown:)`.
struct CoachMarkdown: View {
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(MarkdownBlock.parse(text).enumerated()), id: \.offset) { _, block in
                view(for: block)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func view(for block: MarkdownBlock) -> some View {
        switch block {
        case let .heading(level, text):
            Text(inline(text))
                .font(level <= 2 ? .title3.weight(.semibold) : .headline)
                .padding(.top, 4)
        case let .paragraph(text):
            Text(inline(text))
        case let .item(marker, text, depth):
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(marker)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
                    .frame(minWidth: 14, alignment: .trailing)
                Text(inline(text))
            }
            .padding(.leading, CGFloat(depth) * 16)
        case let .quote(text):
            Text(inline(text))
                .foregroundStyle(.secondary)
                .padding(.leading, 12)
                .overlay(alignment: .leading) { Capsule().fill(.tint).frame(width: 3) }
        case let .code(text):
            ScrollView(.horizontal, showsIndicators: false) {
                Text(text).font(.callout.monospaced()).padding(12)
            }
            .background(.fill.tertiary, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        case let .table(rows):
            MarkdownTable(rows: rows, inline: inline)
        case .rule:
            Divider().padding(.vertical, 4)
        }
    }

    private func inline(_ text: String) -> AttributedString {
        (try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(text)
    }
}

private struct MarkdownTable: View {
    let rows: [[String]]
    let inline: (String) -> AttributedString

    var body: some View {
        let columns = rows.map(\.count).max() ?? 0
        ScrollView(.horizontal, showsIndicators: false) {
            Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 8) {
                ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                    GridRow {
                        ForEach(0..<columns, id: \.self) { column in
                            Text(inline(column < row.count ? row[column] : ""))
                                .font(index == 0 ? .subheadline.weight(.semibold) : .subheadline)
                                .foregroundStyle(index == 0 ? .secondary : .primary)
                                .fixedSize(horizontal: false, vertical: true)
                                .frame(maxWidth: 220, alignment: .leading)
                        }
                    }
                    if index == 0 { Divider().gridCellUnsizedAxes(.horizontal) }
                }
            }
            .padding(14)
        }
        .background(.fill.quaternary, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

enum MarkdownBlock: Equatable {
    case heading(level: Int, text: String)
    case paragraph(String)
    case item(marker: String, text: String, depth: Int)
    case quote(String)
    case code(String)
    case table([[String]])
    case rule

    static func parse(_ source: String) -> [MarkdownBlock] {
        var blocks: [MarkdownBlock] = []
        var paragraph: [String] = []
        var table: [[String]] = []
        var code: [String]?

        func flush() {
            if !paragraph.isEmpty { blocks.append(.paragraph(paragraph.joined(separator: "\n"))) }
            if !table.isEmpty { blocks.append(.table(table)) }
            paragraph = []
            table = []
        }

        for raw in source.components(separatedBy: "\n") {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("```") {
                if let open = code {
                    blocks.append(.code(open.joined(separator: "\n")))
                    code = nil
                } else {
                    flush()
                    code = []
                }
                continue
            }
            if code != nil {
                code!.append(raw)
                continue
            }
            if line.hasPrefix("|") {
                if !paragraph.isEmpty { flush() }
                let cells = line.trimmingCharacters(in: CharacterSet(charactersIn: "|")).components(separatedBy: "|").map { $0.trimmingCharacters(in: .whitespaces) }
                // Skip the |---|:--:| separator row.
                if !cells.allSatisfy({ $0.allSatisfy { "-: ".contains($0) } }) { table.append(cells) }
                continue
            }
            if line.isEmpty {
                flush()
                continue
            }
            if let heading = line.firstMatch(of: #/^(#{1,6})\s+(.+)$/#) {
                flush()
                blocks.append(.heading(level: heading.1.count, text: String(heading.2)))
            } else if line.wholeMatch(of: #/^([-*_])\s*(\1\s*){2,}$/#) != nil {
                flush()
                blocks.append(.rule)
            } else if let item = raw.firstMatch(of: #/^(\s*)[-*+]\s+(.+)$/#) {
                flush()
                blocks.append(.item(marker: "•", text: String(item.2), depth: item.1.count / 2))
            } else if let item = raw.firstMatch(of: #/^(\s*)(\d+)[.)]\s+(.+)$/#) {
                flush()
                blocks.append(.item(marker: "\(item.2).", text: String(item.3), depth: item.1.count / 2))
            } else if line.hasPrefix(">") {
                flush()
                blocks.append(.quote(String(line.drop(while: { $0 == ">" || $0 == " " }))))
            } else {
                if !table.isEmpty { flush() }
                paragraph.append(line)
            }
        }
        // An unclosed fence while streaming still shows what has arrived.
        if let open = code { flush(); blocks.append(.code(open.joined(separator: "\n"))) }
        flush()
        return blocks
    }
}
