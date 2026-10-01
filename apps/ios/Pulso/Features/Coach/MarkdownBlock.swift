import Foundation

/// The Coach's Markdown as blocks, for `CoachMarkdown` to lay out on a phone.
/// Inline syntax (bold, italic, code, links) stays in the text; `Text` renders it.
/// Tolerant of half-streamed input: an unclosed fence or a table without its
/// separator row yet still renders what has arrived.
indirect enum MarkdownBlock: Equatable {
    case heading(level: Int, text: String)
    case paragraph(String)
    case list(ordered: Bool, items: [MarkdownListItem])
    case quote([MarkdownBlock])
    case code(String)
    case table(MarkdownTable)
    case rule

    static func parse(_ source: String) -> [MarkdownBlock] {
        let lines = source.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\t", with: "    ").components(separatedBy: "\n")
        var parser = MarkdownParser(lines: lines)
        return parser.blocks()
    }
}

struct MarkdownListItem: Equatable {
    /// "1." for ordered lists; bullets are drawn by the view from the depth.
    var marker: String
    var blocks: [MarkdownBlock]
}

struct MarkdownTable: Equatable {
    /// Empty when the table has no header row.
    var header: [String]
    var rows: [[String]]

    var columns: Int { max(header.count, rows.map(\.count).max() ?? 0) }

    /// Fits the phone's width as a grid: at most 3 columns of short cells.
    /// Anything wider reads as one card per row instead.
    var fitsAsGrid: Bool {
        columns <= 3 && (rows + [header]).allSatisfy { $0.allSatisfy { $0.count <= 22 } }
    }
}

private struct MarkdownParser {
    let lines: [String]
    var index = 0

    init(lines: [String]) { self.lines = lines }

    mutating func blocks() -> [MarkdownBlock] {
        var blocks: [MarkdownBlock] = []
        while index < lines.count {
            let line = lines[index]
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty {
                index += 1
            } else if trimmed.hasPrefix("```") || trimmed.hasPrefix("~~~") {
                blocks.append(code(fence: String(trimmed.prefix(3))))
            } else if let heading = Self.heading(trimmed) {
                blocks.append(heading)
                index += 1
            } else if Self.isRule(trimmed) {
                blocks.append(.rule)
                index += 1
            } else if trimmed.hasPrefix(">") {
                blocks.append(quote())
            } else if Self.item(line) != nil {
                blocks.append(list())
            } else if startsTable(at: index) {
                blocks.append(table())
            } else {
                blocks.append(paragraph())
            }
        }
        return blocks
    }

    // MARK: Blocks

    private mutating func code(fence: String) -> MarkdownBlock {
        index += 1
        var body: [String] = []
        while index < lines.count {
            defer { index += 1 }
            if lines[index].trimmingCharacters(in: .whitespaces).hasPrefix(fence) { break }
            body.append(lines[index])
        }
        return .code(body.joined(separator: "\n"))
    }

    private mutating func quote() -> MarkdownBlock {
        var inner: [String] = []
        while index < lines.count {
            let trimmed = lines[index].trimmingCharacters(in: .whitespaces)
            guard trimmed.hasPrefix(">") else { break }
            var rest = trimmed.dropFirst()
            if rest.first == " " { rest = rest.dropFirst() }
            inner.append(String(rest))
            index += 1
        }
        var nested = MarkdownParser(lines: inner)
        return .quote(nested.blocks())
    }

    /// A run of items of one kind at one indent. Lines indented past the
    /// marker belong to the item above (continuations and nested lists).
    private mutating func list() -> MarkdownBlock {
        guard let first = Self.item(lines[index]) else { return paragraph() }
        var items: [MarkdownListItem] = []
        while index < lines.count, let item = Self.item(lines[index]), item.indent == first.indent, item.ordered == first.ordered {
            index += 1
            var body = [item.text]
            var sawBlank = false
            while index < lines.count {
                let line = lines[index]
                let trimmed = line.trimmingCharacters(in: .whitespaces)
                if trimmed.isEmpty {
                    sawBlank = true
                    index += 1
                    continue
                }
                let indent = Self.indent(of: line)
                let nested = indent > item.indent
                // After a blank line only indented lines continue the item; before it, plain text is a lazy continuation.
                let lazy = !sawBlank && Self.item(line) == nil && !Self.startsBlock(trimmed) && !startsTable(at: index)
                guard nested || lazy else { break }
                if sawBlank { body.append("") }
                sawBlank = false
                body.append(nested ? String(line.dropFirst(min(indent, item.contentIndent))) : trimmed)
                index += 1
            }
            var nested = MarkdownParser(lines: Self.dedent(body))
            items.append(MarkdownListItem(marker: item.ordered ? "\(item.number)." : "•", blocks: nested.blocks()))
        }
        return .list(ordered: first.ordered, items: items)
    }

    private func startsTable(at i: Int) -> Bool {
        let trimmed = lines[i].trimmingCharacters(in: .whitespaces)
        guard trimmed.contains("|") else { return false }
        if i + 1 < lines.count, Self.isSeparator(lines[i + 1]) { return true }
        return trimmed.hasPrefix("|") && trimmed.dropFirst().contains("|")
    }

    private mutating func table() -> MarkdownBlock {
        var rows: [[String]] = []
        var header: [String] = []
        while index < lines.count {
            let trimmed = lines[index].trimmingCharacters(in: .whitespaces)
            guard !trimmed.isEmpty, trimmed.contains("|") else { break }
            if Self.isSeparator(trimmed) {
                if header.isEmpty, rows.count == 1 { header = rows.removeFirst() }
            } else {
                rows.append(Self.cells(trimmed))
            }
            index += 1
        }
        return .table(MarkdownTable(header: header, rows: rows))
    }

    private mutating func paragraph() -> MarkdownBlock {
        var text: [String] = []
        while index < lines.count {
            let line = lines[index]
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty || (!text.isEmpty && (Self.startsBlock(trimmed) || Self.item(line) != nil || startsTable(at: index))) { break }
            text.append(trimmed)
            index += 1
        }
        return .paragraph(text.joined(separator: "\n"))
    }

    // MARK: Lines

    private struct Item {
        var indent: Int
        var ordered: Bool
        var number: Int
        var contentIndent: Int
        var text: String
    }

    private static func item(_ line: String) -> Item? {
        if let match = line.wholeMatch(of: #/( *)([-*+])( +)(.*)/#), !isRule(line.trimmingCharacters(in: .whitespaces)) {
            let indent = match.1.count
            return Item(indent: indent, ordered: false, number: 0, contentIndent: indent + 1 + match.3.count, text: String(match.4))
        }
        if let match = line.wholeMatch(of: #/( *)(\d{1,3})[.)]( +)(.*)/#) {
            let indent = match.1.count
            return Item(indent: indent, ordered: true, number: Int(match.2) ?? 1, contentIndent: indent + match.2.count + 1 + match.3.count, text: String(match.4))
        }
        return nil
    }

    private static func heading(_ trimmed: String) -> MarkdownBlock? {
        // "###" alone is a heading still streaming in.
        guard let match = trimmed.wholeMatch(of: #/(#{1,6})(?:\s+(.*?))?(?:\s+#+)?/#) else { return nil }
        return .heading(level: match.1.count, text: String(match.2 ?? ""))
    }

    private static func isRule(_ trimmed: String) -> Bool {
        trimmed.wholeMatch(of: #/([-*_])(\s*\1){2,}/#) != nil
    }

    private static func isSeparator(_ line: String) -> Bool {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        return trimmed.contains("|") && trimmed.contains("-") && trimmed.wholeMatch(of: #/\|?(\s*:?-+:?\s*\|)*\s*:?-+:?\s*\|?/#) != nil
    }

    /// Lines that end a paragraph even without a blank line before them.
    private static func startsBlock(_ trimmed: String) -> Bool {
        trimmed.hasPrefix("```") || trimmed.hasPrefix("~~~") || trimmed.hasPrefix(">") || heading(trimmed) != nil || isRule(trimmed)
    }

    private static func cells(_ row: String) -> [String] {
        var row = Substring(row)
        if row.hasPrefix("|") { row = row.dropFirst() }
        if row.hasSuffix("|") { row = row.dropLast() }
        return row.components(separatedBy: "|").map { $0.trimmingCharacters(in: .whitespaces) }
    }

    private static func indent(of line: String) -> Int {
        line.prefix { $0 == " " }.count
    }

    /// Removes the indent the continuation lines share, so a nested list parses at depth 0 inside its item.
    private static func dedent(_ lines: [String]) -> [String] {
        let shared = lines.dropFirst().filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }.map(indent(of:)).min() ?? 0
        guard shared > 0 else { return lines }
        return [lines[0]] + lines.dropFirst().map { String($0.dropFirst(min(shared, indent(of: $0)))) }
    }
}
