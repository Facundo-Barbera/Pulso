import XCTest
@testable import Pulso

final class PairingTests: XCTestCase {
    func testCodeKeepsOnlyTheFirstEightDigits() {
        XCTAssertEqual(Pairing.normalizeCode("1234-5678"), "12345678")
        XCTAssertEqual(Pairing.normalizeCode(" 1234 5678 "), "12345678")
        XCTAssertEqual(Pairing.normalizeCode("Código: 12345678 (5 min)"), "12345678")
        XCTAssertEqual(Pairing.normalizeCode("1234567890"), "12345678")
        XCTAssertEqual(Pairing.normalizeCode("abc"), "")
    }

    func testCodeReadsDigitsFromOtherScriptsAndIgnoresFractions() {
        XCTAssertEqual(Pairing.normalizeCode("١٢٣٤"), "1234")
        XCTAssertEqual(Pairing.normalizeCode("12½34"), "1234")
    }

    func testAddressGetsASchemeAndLosesTheTrailingSlash() {
        XCTAssertEqual(Pairing.baseURL(from: "100.1.2.3:8090")?.absoluteString, "http://100.1.2.3:8090")
        XCTAssertEqual(Pairing.baseURL(from: " http://100.1.2.3:8090/ ")?.absoluteString, "http://100.1.2.3:8090")
        XCTAssertEqual(Pairing.baseURL(from: "https://mac.tail.ts.net")?.absoluteString, "https://mac.tail.ts.net")
    }

    func testAddressRejectsWhatCannotBeAMac() {
        XCTAssertNil(Pairing.baseURL(from: ""))
        XCTAssertNil(Pairing.baseURL(from: "ftp://100.1.2.3"))
        XCTAssertNil(Pairing.baseURL(from: "http://"))
    }
}

final class ErrorMappingTests: XCTestCase {
    func testTransportErrorsReadInSpanishAndStayTransport() {
        let timeout = PulsoAPI.transportFailure(URLError(.timedOut))
        XCTAssertEqual(timeout.kind, .transport)
        XCTAssertTrue(timeout.message.contains("no respondió a tiempo"))
        XCTAssertTrue(PulsoAPI.transportFailure(URLError(.notConnectedToInternet)).message.contains("no tiene conexión"))
        XCTAssertTrue(PulsoAPI.transportFailure(URLError(.cannotFindHost)).message.contains("dirección"))
        XCTAssertTrue(PulsoAPI.transportFailure(URLError(.cannotConnectToHost)).message.contains("Tailscale"))
        XCTAssertTrue(PulsoAPI.transportFailure(CocoaError(.fileNoSuchFile)).message.contains("Tailscale"))
    }

    func testPairingRefusalsAreTranslatedAndKeepTheirCode() {
        let body = Data(#"{"code":"expired_code","message":"That code expired."}"#.utf8)
        let failure = PulsoAPI.failure(status: 401, data: body)
        XCTAssertEqual(failure.kind, .refused(code: "expired_code"))
        XCTAssertTrue(failure.message.contains("venció"))
    }

    func testUnknownRefusalsKeepTheEngineMessage() {
        let body = Data(#"{"code":"nope","message":"engine says no"}"#.utf8)
        XCTAssertEqual(PulsoAPI.failure(status: 400, data: body).message, "engine says no")
    }

    func testUnpairedReadsInSpanish() {
        let body = Data(#"{"code":"unauthorized","message":"This phone is not paired with Pulso."}"#.utf8)
        XCTAssertTrue(PulsoAPI.failure(status: 401, data: body).message.contains("Vuelve a emparejarlo"))
    }
}

final class RetryTests: XCTestCase {
    private let transport = PulsoAPI.Failure(kind: .transport, message: "")

    func testGetIsRetriedOnceAfterATransportFailure() async throws {
        var attempts = 0
        let value = try await PulsoAPI.retrying(method: "GET", pause: .zero) {
            attempts += 1
            if attempts == 1 { throw transport }
            return 42
        }
        XCTAssertEqual(value, 42)
        XCTAssertEqual(attempts, 2)
    }

    func testGetGivesUpAfterTheSecondFailure() async {
        var attempts = 0
        do {
            _ = try await PulsoAPI.retrying(method: "get", pause: .zero) { () async throws -> Int in
                attempts += 1
                throw transport
            }
            XCTFail("expected a failure")
        } catch {
            XCTAssertEqual(attempts, 2)
        }
    }

    func testWritesAreNeverRetried() async {
        var attempts = 0
        _ = try? await PulsoAPI.retrying(method: "POST", pause: .zero) { () async throws -> Int in
            attempts += 1
            throw transport
        }
        XCTAssertEqual(attempts, 1)
    }

    func testAnswersFromTheMacAreNotRetried() async {
        var attempts = 0
        _ = try? await PulsoAPI.retrying(method: "GET", pause: .zero) { () async throws -> Int in
            attempts += 1
            throw PulsoAPI.Failure(kind: .badResponse(status: 500), message: "")
        }
        XCTAssertEqual(attempts, 1)
    }
}
