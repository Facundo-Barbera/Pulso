import Foundation

/// Supersets: two or more consecutive strength exercises sharing a `supersetId`,
/// done alternating (a set of each, then the rest). Same rules as the engine.
enum Superset {
    static func newId() -> String { "s" + UUID().uuidString.prefix(6).lowercased() }

    /// Keeps an id only on a run of 2+ consecutive strength exercises; a lone
    /// member, cardio, or a later run reusing an id gets nil.
    static func normalize(_ ids: [String?], cardio: [Bool]) -> [String?] {
        let clean = ids.indices.map { i -> String? in
            guard !cardio[i], let id = ids[i]?.trimmingCharacters(in: .whitespaces), !id.isEmpty else { return nil }
            return id
        }
        var out = [String?](repeating: nil, count: clean.count)
        var used: Set<String> = []
        var i = 0
        while i < clean.count {
            guard let id = clean[i] else { i += 1; continue }
            var end = i + 1
            while end < clean.count, clean[end] == id { end += 1 }
            if end - i >= 2, !used.contains(id) {
                for k in i..<end { out[k] = id }
                used.insert(id)
            }
            i = end
        }
        return out
    }

    /// The group around `index`, if it is in one.
    static func group(of index: Int, in ids: [String?]) -> Range<Int>? {
        guard ids.indices.contains(index), let id = ids[index] else { return nil }
        var start = index
        while start > 0, ids[start - 1] == id { start -= 1 }
        var end = index + 1
        while end < ids.count, ids[end] == id { end += 1 }
        return end - start >= 2 ? start..<end : nil
    }

    /// Pairs `a` and `b` (adjacent, either order), joining a group either is in.
    /// Nil when they aren't next to each other or one is cardio.
    static func pair(_ a: Int, _ b: Int, in ids: [String?], cardio: [Bool]) -> [String?]? {
        let (low, high) = (min(a, b), max(a, b))
        guard high - low == 1, ids.indices.contains(high), !cardio[low], !cardio[high] else { return nil }
        var next = ids
        let id = ids[low] ?? ids[high] ?? newId()
        next[low] = id
        next[high] = id
        return normalize(next, cardio: cardio)
    }

    /// Takes `index` out of its group; the rest stay paired if still 2+ together.
    static func unpair(_ index: Int, in ids: [String?], cardio: [Bool]) -> [String?] {
        guard ids.indices.contains(index) else { return ids }
        var next = ids
        next[index] = nil
        return normalize(next, cardio: cardio)
    }

    /// "Superserie 1", "Superserie 2"… by order in the list.
    static func labels(_ ids: [String?]) -> [String: Int] {
        var out: [String: Int] = [:]
        for id in ids.compactMap(\.self) where out[id] == nil { out[id] = out.count + 1 }
        return out
    }
}
