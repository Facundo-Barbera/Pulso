import Foundation
import Observation

/// A brief the Coach wrote on its own (`@pulso/contract` `CoachBrief`). Times are epoch milliseconds.
struct CoachBrief: Codable, Identifiable, Equatable {
    enum Kind: String, Codable { case daily, weekly }
    enum Status: String, Codable { case running, done, error }
    var id: String
    var kind: Kind
    /// YYYY-MM-DD: the day for `daily`, the week's Sunday for `weekly`.
    var period: String
    var status: Status
    /// Markdown. Keeps the previous version while a regenerate runs.
    var text: String
    var error: String?
    var createdAt: Double
    var updatedAt: Double

    /// `period` as a local date.
    var day: Date? {
        let parts = period.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return Calendar.current.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }
}

struct CoachBriefs: Codable, Equatable {
    var daily: CoachBrief?
    var weekly: CoachBrief?
}

extension PulsoAPI {
    private struct BriefResponse: Decodable { var brief: CoachBrief? }
    private struct QuotedResponse: Decodable { var message: AgentMessage }

    func coachBriefs() async throws -> CoachBriefs {
        try await call("api/mobile/coach/brief", method: "GET")
    }

    /// Starts rewriting today's brief (or this week's check-in); poll `coachBriefs()` until it is not running.
    func regenerateCoachBrief(_ kind: CoachBrief.Kind) async throws -> CoachBrief? {
        let response: BriefResponse = try await call("api/mobile/coach/brief/regenerate", method: "POST", body: ["kind": kind.rawValue])
        return response.brief
    }

    /// «Responder»: the brief goes into the conversation as the Coach's message.
    func replyToCoachBrief(_ id: String) async throws -> AgentMessage {
        let response: QuotedResponse = try await call("api/mobile/coach/briefs/\(id)/reply", method: "POST")
        return response.message
    }
}

/// The briefs behind `CoachBriefCard`. Polls while the Mac is writing one.
@MainActor
@Observable
final class CoachBriefStore {
    private(set) var briefs = CoachBriefs()
    private(set) var loaded = false
    private(set) var replying = false

    var writing: Bool { briefs.daily?.status == .running || briefs.weekly?.status == .running }

    /// Loads, then keeps polling while a brief is being written.
    func refresh() async {
        guard let api = PulsoModel.shared.api else { return }
        do {
            briefs = try await api.coachBriefs()
            loaded = true
            var waited = 0
            while writing && waited < 120, !Task.isCancelled {
                try await Task.sleep(for: .seconds(3))
                waited += 1
                briefs = try await api.coachBriefs()
            }
        } catch is CancellationError {
            return
        } catch {
            PulsoModel.shared.handle(error)
        }
    }

    func regenerate(_ kind: CoachBrief.Kind) async {
        guard let api = PulsoModel.shared.api, !writing else { return }
        do {
            let brief = try await api.regenerateCoachBrief(kind)
            switch kind {
            case .daily: briefs.daily = brief ?? briefs.daily
            case .weekly: briefs.weekly = brief ?? briefs.weekly
            }
            await refresh()
        } catch {
            PulsoModel.shared.handle(error)
        }
    }

    /// "Responder": the brief goes into the conversation and the Coach tab opens on it, composer ready.
    func reply(to brief: CoachBrief) async {
        guard let api = PulsoModel.shared.api, !replying else { return }
        replying = true
        defer { replying = false }
        do {
            _ = try await api.replyToCoachBrief(brief.id)
            CoachLauncher.shared.open()
        } catch {
            PulsoModel.shared.handle(error)
        }
    }
}
