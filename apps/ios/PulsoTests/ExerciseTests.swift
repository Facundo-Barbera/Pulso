import ImageIO
import UIKit
import UniformTypeIdentifiers
import XCTest
@testable import Pulso

final class ExerciseTests: XCTestCase {
    func testDecodesTheContractsExerciseDetail() throws {
        let json = """
        {"id":"press-banca","name":"Press de banca","muscle":"chest","secondary":["shoulders","triceps"],
         "equipment":"barbell","kind":"compound","nameEn":null,
         "primaryMuscles":["chest"],"secondaryMuscles":["front_delts","triceps","side_delts","upper_back","lower_back","rear_delts"],
         "instructions":["Túmbate","Empuja"],"tips":["Junta las escápulas"],
         "media":{"animation":"/api/mobile/training/media/0025.gif","thumbnail":null,"source":"exercisedb","attribution":"ExerciseDB"},
         "videos":[{"youtubeId":"abc_-123","title":"Técnica","channel":"Canal","lang":"es"}],"notes":null}
        """
        let detail = try JSONDecoder().decode(ExerciseDetail.self, from: Data(json.utf8))
        XCTAssertEqual(detail.primaryMuscles, [.chest])
        XCTAssertEqual(detail.secondaryMuscles, [.frontDelts, .triceps, .sideDelts, .upperBack, .lowerBack, .rearDelts])
        XCTAssertEqual(detail.media.animation, "/api/mobile/training/media/0025.gif")
        XCTAssertNil(detail.media.thumbnail)
        XCTAssertEqual(detail.videos.first?.id, "abc_-123")
        XCTAssertNil(detail.notes)
    }

    func testDecodesPerformanceWithAndWithoutRecords() throws {
        let empty = try JSONDecoder().decode(ExercisePerformance.self, from: Data(#"{"exerciseId":"x","maxWeight":null,"bestE1rm":null,"maxVolume":null,"history":[]}"#.utf8))
        XCTAssertNil(empty.maxWeight)
        XCTAssertTrue(empty.history.isEmpty)

        let full = try JSONDecoder().decode(ExercisePerformance.self, from: Data("""
        {"exerciseId":"x","maxWeight":{"kg":100,"reps":5,"at":1700000000000},"bestE1rm":{"kg":116.7,"at":1700000000000},
         "maxVolume":{"kg":2400,"at":1690000000000},"history":[{"at":1690000000000,"topWeightKg":95,"e1rm":110.8,"volumeKg":2400}]}
        """.utf8))
        XCTAssertEqual(full.maxWeight?.reps, 5)
        XCTAssertEqual(full.history.first?.day, Date(timeIntervalSince1970: 1_690_000_000))
    }

    func testMuscleRawValuesMatchTheContract() {
        XCTAssertEqual(Muscle.allCases.count, 20)
        XCTAssertEqual(Muscle.frontDelts.rawValue, "front_delts")
        XCTAssertEqual(Muscle.upperBack.rawValue, "upper_back")
        XCTAssertEqual(Muscle.lowerBack.rawValue, "lower_back")
        for muscle in Muscle.allCases { XCTAssertFalse(muscle.label.isEmpty) }
    }

    func testEveryMuscleIsDrawnOnTheBodyMap() {
        for muscle in Muscle.allCases {
            let views = BodyMapData.views(of: muscle)
            XCTAssertTrue(views.front || views.back, "\(muscle) has no region")
        }
        XCTAssertEqual(BodyMapData.views(of: .chest).front, true)
        XCTAssertEqual(BodyMapData.views(of: .lats).back, true)
        XCTAssertTrue(BodyMapData.views(of: .sideDelts) == (true, true))
    }

    func testBodyPolygonsAreClosedShapesInsideTheBox() {
        for polygon in BodyMapData.front + BodyMapData.back {
            XCTAssertEqual(polygon.points.count % 2, 0)
            XCTAssertGreaterThanOrEqual(polygon.points.count, 6)
            for (i, value) in polygon.points.enumerated() {
                XCTAssertTrue((0...(i % 2 == 0 ? BodyMapData.size.width : BodyMapData.size.height)).contains(value), "\(String(describing: polygon.muscle)) point out of the box")
            }
        }
    }

    func testMediaURLsResolveAgainstTheEngineAndCarryTheBearer() throws {
        let api = PulsoAPI(base: URL(string: "http://100.64.0.2:8090")!, token: "t0k")
        XCTAssertEqual(api.mediaURL("/api/mobile/training/media/0025.gif?v=2")?.absoluteString, "http://100.64.0.2:8090/api/mobile/training/media/0025.gif?v=2")
        XCTAssertEqual(api.mediaURL("https://cdn.example/x.gif")?.absoluteString, "https://cdn.example/x.gif")
        let slashed = PulsoAPI(base: URL(string: "http://mac.local:8090/")!, token: nil)
        XCTAssertEqual(slashed.mediaURL("api/mobile/training/media/a.gif")?.absoluteString, "http://mac.local:8090/api/mobile/training/media/a.gif")
        XCTAssertEqual(api.mediaRequest("/api/mobile/training/media/a.gif")?.value(forHTTPHeaderField: "authorization"), "Bearer t0k")
    }

    func testGIFFramesKeepTheirTimingAndShortDelaysAreClamped() throws {
        let data = try Self.gif(delays: [0.1, 0.3, 0])
        let source = try XCTUnwrap(CGImageSourceCreateWithData(data as CFData, nil))
        XCTAssertEqual(AnimatedImage.frameDelays(source).map { ($0 * 100).rounded() / 100 }, [0.1, 0.3, 0.1])

        let image = try XCTUnwrap(AnimatedImage.decode(data))
        XCTAssertEqual(image.images?.count, 3)
        XCTAssertEqual(image.duration, 0.5, accuracy: 0.01)
        XCTAssertEqual(AnimatedImage.delay(nil), 0.1)
        XCTAssertEqual(AnimatedImage.delay(0.01), 0.1)
        XCTAssertEqual(AnimatedImage.delay(0.04), 0.04)
    }

    func testAStillImageDecodesWithoutAnimation() throws {
        let image = try XCTUnwrap(AnimatedImage.decode(try Self.gif(delays: [0.1])))
        XCTAssertNil(image.images)
    }

    func testYouTubeEmbedUsesTheAppOriginAndAReferrerPolicy() {
        let html = YouTubePlayer.html(videoId: "rT7DgCr-3pg")
        XCTAssertTrue(html.contains("https://www.youtube.com/embed/rT7DgCr-3pg?playsinline=1"))
        XCTAssertTrue(html.contains("referrerpolicy=\"strict-origin-when-cross-origin\""))
        XCTAssertTrue(html.contains("origin=https%3A%2F%2F"))
        XCTAssertTrue(YouTubePlayer.origin.hasPrefix("https://"))
    }

    /// A tiny GIF with one 4 × 4 frame per delay.
    private static func gif(delays: [Double]) throws -> Data {
        let data = NSMutableData()
        let destination = try XCTUnwrap(CGImageDestinationCreateWithData(data, UTType.gif.identifier as CFString, delays.count, nil))
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: 4, height: 4))
        for (i, delay) in delays.enumerated() {
            let frame = renderer.image { context in
                UIColor(white: CGFloat(i) / CGFloat(max(1, delays.count)), alpha: 1).setFill()
                context.fill(CGRect(x: 0, y: 0, width: 4, height: 4))
            }
            let properties = [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFDelayTime: delay, kCGImagePropertyGIFUnclampedDelayTime: delay]] as CFDictionary
            CGImageDestinationAddImage(destination, try XCTUnwrap(frame.cgImage), properties)
        }
        XCTAssertTrue(CGImageDestinationFinalize(destination))
        return data as Data
    }
}
