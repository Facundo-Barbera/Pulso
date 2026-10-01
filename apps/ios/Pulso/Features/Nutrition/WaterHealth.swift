import Foundation
import HealthKit

/// Mirrors water logged on the phone into Salud as dietary water. Each sample
/// carries the engine entry's id, so undo removes exactly that one. Best effort:
/// a refused permission never blocks logging.
enum WaterHealth {
    private static let type = HKQuantityType(.dietaryWater)

    static func save(_ entry: WaterEntry) async {
        guard HealthSync.available else { return }
        do {
            try await HealthSync.store.requestAuthorization(toShare: [type], read: [])
            let date = Date(timeIntervalSince1970: entry.loggedAt / 1000)
            let sample = HKQuantitySample(
                type: type,
                quantity: HKQuantity(unit: .literUnit(with: .milli), doubleValue: entry.amountMl),
                start: date, end: date,
                metadata: [HKMetadataKeyExternalUUID: entry.id]
            )
            try await HealthSync.store.save(sample)
        } catch {
            print("[water] not saved to Salud: \(error.localizedDescription)")
        }
    }

    static func delete(_ entryId: String) async {
        guard HealthSync.available, HealthSync.store.authorizationStatus(for: type) == .sharingAuthorized else { return }
        let predicate = HKQuery.predicateForObjects(withMetadataKey: HKMetadataKeyExternalUUID, allowedValues: [entryId])
        _ = try? await HealthSync.store.deleteObjects(of: type, predicate: predicate)
    }
}
