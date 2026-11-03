// Build: xcrun swiftc -O -parse-as-library capture.swift -o capture
// macOS 15+. All media is written directly into the explicitly selected session.
import AppKit
import AVFoundation
import CoreImage
import ScreenCaptureKit
import UniformTypeIdentifiers
import Darwin

func wallTime() -> String {
    let format = ISO8601DateFormatter()
    format.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return format.string(from: Date())
}

func hostTime() -> Double { CMClockGetTime(CMClockGetHostTimeClock()).seconds }

func finiteJSON(_ value: Any, path: String, warnings: inout [String]) -> Any {
    if let number = value as? NSNumber, !number.doubleValue.isFinite {
        warnings.append("\(path): non-finite native numeric value \(number); serialized as null (unavailable), not zero")
        return NSNull()
    }
    if let object = value as? [String: Any] {
        var result: [String: Any] = [:]
        for (key, item) in object {
            result[key] = finiteJSON(item, path: "\(path).\(key)", warnings: &warnings)
        }
        return result
    }
    if let array = value as? [Any] {
        return array.enumerated().map { index, item in finiteJSON(item, path: "\(path)[\(index)]", warnings: &warnings) }
    }
    return value
}

func jsonData(_ value: Any) throws -> Data {
    var warnings: [String] = []
    var safeValue = finiteJSON(value, path: "$", warnings: &warnings)
    if !warnings.isEmpty, var object = safeValue as? [String: Any] {
        object["serialization_warnings"] = warnings.sorted()
        safeValue = object
    }
    // Foundation can raise an Objective-C exception for NaN rather than a catchable Swift error.
    guard JSONSerialization.isValidJSONObject(safeValue) else {
        throw CaptureError.message("Metadata contains an unsupported JSON value after numeric sanitization")
    }
    return try JSONSerialization.data(withJSONObject: safeValue, options: [.sortedKeys])
}

func atomicJSON(_ value: Any, _ url: URL) throws {
    try jsonData(value).write(to: url, options: .atomic)
}

// O_APPEND keeps each short JSONL record indivisible relative to the wrapper.
func appendJSON(_ value: Any, _ url: URL) throws {
    var data = try jsonData(value)
    data.append(0x0a)
    let fd = open(url.path, O_WRONLY | O_CREAT | O_APPEND, S_IRUSR | S_IWUSR)
    guard fd >= 0 else { throw CaptureError.message("Cannot open \(url.path): \(errno)") }
    defer { close(fd) }
    let count = data.withUnsafeBytes { write(fd, $0.baseAddress, data.count) }
    guard count == data.count else { throw CaptureError.message("Incomplete JSONL write: \(url.path)") }
}

enum CaptureError: Error, CustomStringConvertible {
    case message(String)
    var description: String { switch self { case .message(let message): return message } }
}

struct Options {
    let session: URL
    let type: String
    let id: UInt32
    let interval: Double
    let audio: String

    init(_ arguments: [String]) throws {
        var args: [String: String] = [:]
        var index = 0
        let allowed = Set(["--session", "--target-type", "--target-id", "--interval", "--audio"])
        while index < arguments.count {
            let name = arguments[index]
            guard allowed.contains(name), index + 1 < arguments.count, args[name] == nil else {
                throw CaptureError.message("Invalid or repeated argument: \(name)")
            }
            args[name] = arguments[index + 1]
            index += 2
        }
        guard let path = args["--session"], path.hasPrefix("/"),
              let type = args["--target-type"], ["window", "display"].contains(type),
              let rawID = args["--target-id"], let id = UInt32(rawID), id > 0 else {
            throw CaptureError.message("Required: --session ABS_DIR --target-type window|display --target-id INT")
        }
        let interval = Double(args["--interval"] ?? "0.25") ?? .nan
        guard interval.isFinite, interval > 0 else {
            throw CaptureError.message("--interval must be positive and finite")
        }
        let audio = args["--audio"] ?? "none"
        guard ["microphone", "none"].contains(audio) else {
            throw CaptureError.message("--audio must be microphone or none")
        }
        self.session = URL(fileURLWithPath: path, isDirectory: true).standardizedFileURL
        self.type = type
        self.id = id
        self.interval = interval
        self.audio = audio
    }
}

@available(macOS 15.0, *)
final class Capture: NSObject, SCStreamOutput, SCStreamDelegate, SCRecordingOutputDelegate, @unchecked Sendable {
    let options: Options
    let queue = DispatchQueue(label: "human-playtest.capture")
    let context = CIContext(options: [.cacheIntermediates: false])
    let began = hostTime()
    let beganWall = wallTime()
    var stream: SCStream?
    var recording: SCRecordingOutput?
    var timer: DispatchSourceTimer?
    var frameTimer: DispatchSourceTimer?
    var signals: [DispatchSourceSignal] = []
    var latest: CVPixelBuffer?
    var latestPTS: Double?
    var firstPTS: Double?
    var micFirstPTS: Double?
    var micLastPTS: Double?
    var micSamples = 0
    var receivedVideoSamples = 0
    var recordingStarted = false
    var captureStartPending = false
    var recordingFinished = false
    var recordingFailed = false
    var stopping = false
    var stopComplete = false
    var finalized = false
    var ready = false
    var firstFrameWall: String?
    var readyWall: String?
    var recordingStartHost: Double?
    var frames = 0
    var missed = 0
    var repeated = 0
    var previousSavedPTS: Double?
    var firstSavedHost: Double?
    var lastSavedHost: Double?
    var minSavedInterval: Double?
    var maxSavedInterval: Double?
    var nextFrame: Double?
    var stopReason: String?
    var errors: [String] = []
    var warnings = Set<String>()
    var target: [String: Any] = [:]
    var lastTargetCheck = 0.0
    var lastStatus = 0.0
    var windowLost = false
    var maxSeconds: Double?
    var maxBytes: Int64?
    var bytes: Int64 = 0
    var pngBytes: Int64 = 0
    var initialNestedBytes: Int64 = 0
    var nativeDiagnostics: [String] = []
    var sampleScale: Double?
    var sampleContentScale: Double?
    var stopBegan: Double?

    init(_ options: Options) { self.options = options }
    func url(_ path: String) -> URL { options.session.appendingPathComponent(path) }

    func event(_ type: String, _ detail: [String: Any] = [:]) {
        var event = detail
        event["type"] = type
        event["source"] = "native"
        event["wall_time"] = wallTime()
        event["monotonic_seconds"] = hostTime()
        event["media_seconds"] = firstPTS.map { hostTime() - $0 } ?? NSNull()
        do { try appendJSON(event, url("events.jsonl")) }
        catch { errors.append("Event write failed: \(error)") }
    }

    func summary(_ state: String) -> [String: Any] {
        [
            "schema_version": 1, "state": state, "ready": ready && !stopping,
            "pid": getpid(), "started_at": beganWall, "updated_at": wallTime(),
            "ready_at": readyWall ?? NSNull(), "first_frame_at": firstFrameWall ?? NSNull(),
            "elapsed_seconds": hostTime() - began, "monotonic_seconds": hostTime(),
            "media_seconds": firstPTS.map { hostTime() - $0 } ?? NSNull(),
            "first_video_pts_seconds": firstPTS ?? NSNull(),
            "last_video_pts_seconds": latestPTS ?? NSNull(),
            "recording_callback_monotonic_seconds": recordingStartHost ?? NSNull(),
            "media_time_basis": "Frame media_seconds uses host clock minus first complete video sample PTS. Movie zero correspondence is provisional; inspect finalized movie track ranges and synchronize identifiable content before frame-accurate claims.",
            "recording_started": recordingStarted, "recording_finished": recordingFinished,
            "target": target, "audio_requested": options.audio, "system_audio_enabled": false,
            "microphone_sample_buffers": micSamples,
            "microphone_first_pts_seconds": micFirstPTS ?? NSNull(),
            "microphone_last_pts_seconds": micLastPTS ?? NSNull(),
            "microphone_video_offset_seconds": micFirstPTS.flatMap { mic in firstPTS.map { mic - $0 } } ?? NSNull(),
            "screenshot_interval_seconds": options.interval,
            "frames_written": frames, "frames_missed": missed, "frames_repeated_source": repeated,
            "first_screenshot_monotonic_seconds": firstSavedHost ?? NSNull(),
            "last_screenshot_monotonic_seconds": lastSavedHost ?? NSNull(),
            "achieved_screenshot_hz": frames > 1 ? Double(frames - 1) / (lastSavedHost! - firstSavedHost!) : NSNull(),
            "screenshot_interval_min_seconds": minSavedInterval ?? NSNull(),
            "screenshot_interval_max_seconds": maxSavedInterval ?? NSNull(),
            "screenshot_interval_mean_seconds": frames > 1 ? (lastSavedHost! - firstSavedHost!) / Double(frames - 1) : NSNull(),
            "video_sample_buffers": receivedVideoSamples,
            "session_bytes": bytes, "max_seconds": maxSeconds ?? NSNull(), "max_bytes": maxBytes ?? NSNull(),
            "stop_reason": stopReason ?? NSNull(), "window_lost": windowLost,
            "errors": errors, "native_diagnostics": nativeDiagnostics,
            "movie": "screen.mov", "frame_index": "frames/index.jsonl",
            "storage_accounting": "Live owned-PNG byte accumulator plus current root files (including movie) and frame index; pre-existing nested files counted once. Recursive reconciliation at finalization. Do not add/delete nested session files while recording.",
            "limit_semantics": "Polled every 0.25 seconds; PNG encoding, OS buffering and movie finalization can overshoot caps. Existing session files count toward storage; no automatic deletion."
        ]
    }

    func status(_ state: String) {
        do { try atomicJSON(summary(state), url("native-status.json")) }
        catch { errors.append("Status write failed: \(error)") }
    }

    func start() async {
        do {
            try FileManager.default.createDirectory(at: options.session, withIntermediateDirectories: true)
            // A session may already contain wrapper metadata, but media is never overwritten.
            for path in ["screen.mov", "frames/index.jsonl", "native-final.json", "native-status.json"] {
                if FileManager.default.fileExists(atPath: url(path).path) {
                    fputs("Refusing existing capture artifact: \(path)\n", stderr)
                    exit(2)
                }
            }
            if let contents = try? FileManager.default.contentsOfDirectory(atPath: url("frames").path), !contents.isEmpty {
                fputs("Refusing nonempty frames directory\n", stderr)
                exit(2)
            }
            try FileManager.default.createDirectory(at: url("frames"), withIntermediateDirectories: true)
            // Nested pre-existing artifacts are immutable during capture. Root metadata remains live.
            let initialChildren = try FileManager.default.contentsOfDirectory(at: options.session, includingPropertiesForKeys: [.isDirectoryKey, .isSymbolicLinkKey])
            for child in initialChildren where child.lastPathComponent != "frames" {
                let values = try child.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
                if values.isDirectory == true, values.isSymbolicLink != true {
                    initialNestedBytes += recursiveBytes(child)
                }
            }
            queue.sync { status("starting"); installTimers() }
            // Preflight avoids initiating unexpected system permission dialogs.
            guard CGPreflightScreenCaptureAccess() else {
                throw CaptureError.message("Screen Recording permission is not granted. Grant it to the invoking app/helper in System Settings, then retry; no capture started.")
            }
            if options.audio == "microphone" {
                guard AVCaptureDevice.authorizationStatus(for: .audio) == .authorized else {
                    throw CaptureError.message("Microphone permission is not granted. Authorize the invoking app/helper before requesting microphone capture; no microphone was opened.")
                }
                guard AVCaptureDevice.default(for: .audio) != nil else {
                    throw CaptureError.message("No default microphone device is available")
                }
            }
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
            let filter: SCContentFilter
            var selected: [String: Any]
            if options.type == "window" {
                guard let window = content.windows.first(where: { $0.windowID == options.id }) else {
                    throw CaptureError.message("Exact window ID \(options.id) no longer exists; target was not broadened")
                }
                guard window.frame.width > 0, window.frame.height > 0 else {
                    throw CaptureError.message("Selected window has empty dimensions")
                }
                filter = SCContentFilter(desktopIndependentWindow: window)
                selected = windowInfo(window)
                selected["host_display_id"] = displayContaining(window.frame)
            } else {
                guard let display = content.displays.first(where: { $0.displayID == options.id }) else {
                    throw CaptureError.message("Exact display ID \(options.id) no longer exists; target was not broadened")
                }
                filter = SCContentFilter(display: display, excludingWindows: [])
                selected = displayInfo(display)
                selected["display_pixel_width"] = CGDisplayPixelsWide(display.displayID)
                selected["display_pixel_height"] = CGDisplayPixelsHigh(display.displayID)
            }
            selected["type"] = options.type
            let config = SCStreamConfiguration()
            let scale = Double(filter.pointPixelScale)
            config.width = max(2, Int(ceil(filter.contentRect.width * scale / 2)) * 2)
            config.height = max(2, Int(ceil(filter.contentRect.height * scale / 2)) * 2)
            config.minimumFrameInterval = CMTime(value: 1, timescale: 30)
            config.queueDepth = 5
            config.pixelFormat = kCVPixelFormatType_32BGRA
            config.showsCursor = true
            config.capturesAudio = false
            config.captureMicrophone = options.audio == "microphone"
            config.ignoreShadowsSingleWindow = true
            config.shouldBeOpaque = true
            selected["capture_width"] = config.width
            selected["capture_height"] = config.height
            selected["point_pixel_scale"] = scale
            let movie = SCRecordingOutputConfiguration()
            movie.outputURL = url("screen.mov")
            guard movie.availableOutputFileTypes.contains(.mov) else {
                throw CaptureError.message("ScreenCaptureKit does not offer QuickTime MOV on this OS")
            }
            movie.outputFileType = .mov
            movie.videoCodecType = .h264
            let output = SCRecordingOutput(configuration: movie, delegate: self)
            let capture = SCStream(filter: filter, configuration: config, delegate: self)
            try capture.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
            if options.audio == "microphone" {
                try capture.addStreamOutput(self, type: .microphone, sampleHandlerQueue: queue)
            }
            try capture.addRecordingOutput(output)
            let proceed = queue.sync { () -> Bool in
                guard !stopping else { return false }
                self.target = selected
                self.stream = capture
                self.recording = output
                self.captureStartPending = true
                status("starting")
                event("target_verified", selected)
                return true
            }
            guard proceed else { return }
            try await capture.startCapture()
            queue.async {
                self.captureStartPending = false
                if self.stopping { self.stopStream() }
            }
        } catch {
            queue.async {
                self.captureStartPending = false
                self.recordingFailed = true
                self.errors.append(String(describing: error))
                if self.stopping { self.stopStream() }
                else { self.stop("startup_error") }
            }
        }
    }

    func installTimers() {
        for number in [SIGINT, SIGTERM] {
            signal(number, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: number, queue: queue)
            source.setEventHandler { self.stop(number == SIGTERM ? "sigterm" : "sigint") }
            source.resume()
            signals.append(source)
        }
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now(), repeating: 0.25, leeway: .milliseconds(1))
        timer.setEventHandler { self.tick() }
        timer.resume()
        self.timer = timer
    }

    func pollControl() {
        do {
            let data = try Data(contentsOf: url("control.json"))
            guard let control = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                throw CaptureError.message("control.json must be a JSON object")
            }
            if let reason = control["stop_reason"] as? String, !reason.isEmpty {
                stop(reason)
                return
            }
            if let raw = control["max_seconds"], !(raw is NSNull) {
                guard let value = raw as? NSNumber, CFGetTypeID(value) != CFBooleanGetTypeID(), value.doubleValue.isFinite, value.doubleValue > 0 else { throw CaptureError.message("Invalid max_seconds") }
                maxSeconds = value.doubleValue
            } else { maxSeconds = nil }
            if let raw = control["max_bytes"], !(raw is NSNull) {
                guard let value = raw as? NSNumber, CFGetTypeID(value) != CFBooleanGetTypeID(), value.int64Value > 0,
                      value.doubleValue.rounded(.down) == value.doubleValue,
                      value.compare(NSNumber(value: Int64.max)) != .orderedDescending else { throw CaptureError.message("Invalid max_bytes") }
                maxBytes = value.int64Value
            } else { maxBytes = nil }
        } catch {
            // Atomic wrapper writes prevent transient malformed controls; fail closed if control is lost.
            errors.append("Control read failed: \(error)")
            stop("control_error")
        }
    }

    func recursiveBytes(_ directory: URL) -> Int64 {
        guard let enumerator = FileManager.default.enumerator(at: directory,
            includingPropertiesForKeys: [.fileSizeKey, .isRegularFileKey, .isSymbolicLinkKey]) else { return 0 }
        var total: Int64 = 0
        for case let file as URL in enumerator {
            guard let values = try? file.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey, .isSymbolicLinkKey]) else { continue }
            if values.isSymbolicLink == true { enumerator.skipDescendants(); continue }
            if values.isRegularFile == true { total += Int64(values.fileSize ?? 0) }
        }
        return total
    }

    func fileBytes(_ file: URL) -> Int64 {
        guard let values = try? file.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey, .isSymbolicLinkKey]),
              values.isRegularFile == true, values.isSymbolicLink != true else { return 0 }
        return Int64(values.fileSize ?? 0)
    }

    func sessionBytes() -> Int64 {
        let rootFiles = (try? FileManager.default.contentsOfDirectory(at: options.session, includingPropertiesForKeys: [.fileSizeKey, .isRegularFileKey, .isSymbolicLinkKey])) ?? []
        return initialNestedBytes + pngBytes + fileBytes(url("frames/index.jsonl")) + rootFiles.reduce(0) { $0 + fileBytes($1) }
    }

    func windowSnapshot() -> [String: Any]? {
        let info = CGWindowListCopyWindowInfo(.optionIncludingWindow, options.id) as? [[String: Any]] ?? []
        return info.first { ($0[kCGWindowNumber as String] as? NSNumber)?.uint32Value == options.id &&
            ($0[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == (target["pid"] as? Int32) }
    }

    func displayContaining(_ frame: CGRect) -> UInt32 {
        var display: CGDirectDisplayID = 0
        var count: UInt32 = 0
        CGGetDisplaysWithPoint(CGPoint(x: frame.midX, y: frame.midY), 1, &display, &count)
        return count > 0 ? display : 0
    }

    func checkReady() {
        guard !ready, !stopping, recordingStarted, frames > 0,
              options.audio == "none" || micSamples > 0 else { return }
        ready = true
        readyWall = wallTime()
        event("native_ready")
        status("recording")
    }

    func tick() {
        let now = hostTime()
        if stopping {
            if let stopBegan, now - stopBegan > 20, !finalized {
                errors.append("Timed out waiting for native recording finalization; movie may be incomplete")
                finish()
            }
            return
        }
        pollControl()
        guard !stopping else { return }
        bytes = sessionBytes()
        let elapsed = now - began
        for (kind, ratio) in [("duration", maxSeconds.map { elapsed / $0 }), ("storage", maxBytes.map { Double(bytes) / Double($0) })] {
            if let ratio, ratio >= 0.9, warnings.insert(kind).inserted {
                event("cap_approaching", ["cap": kind, "fraction": ratio, "session_bytes": bytes])
            }
        }
        if let maxSeconds, elapsed >= maxSeconds { stop("duration_cap"); return }
        if let maxBytes, bytes >= maxBytes { stop("storage_cap"); return }
        if !ready, elapsed > 15 {
            errors.append("Readiness timeout: recording_started=\(recordingStarted), frames=\(frames), microphone_buffers=\(micSamples)")
            stop("readiness_timeout")
            return
        }
        if !target.isEmpty, recordingStarted, now - lastTargetCheck >= 1 {
            lastTargetCheck = now
            let exists: Bool
            if options.type == "window" {
                let info = windowSnapshot()
                exists = info != nil
                if let bounds = info?[kCGWindowBounds as String] as? [String: Any],
                   let width = bounds["Width"] as? Double, let height = bounds["Height"] as? Double,
                   let x = bounds["X"] as? Double, let y = bounds["Y"] as? Double {
                    let frame = CGRect(x: x, y: y, width: width, height: height)
                    if width != target["width"] as? Double || height != target["height"] as? Double || displayContaining(frame) != target["host_display_id"] as? UInt32 {
                        event("target_geometry_changed", ["width": width, "height": height, "host_display_id": displayContaining(frame)])
                        stop("target_geometry_changed")
                        return
                    }
                }
            } else {
                exists = CGDisplayIsOnline(options.id) != 0
                if exists && (CGDisplayPixelsWide(options.id) != target["display_pixel_width"] as? Int || CGDisplayPixelsHigh(options.id) != target["display_pixel_height"] as? Int) {
                    event("target_geometry_changed")
                    stop("target_geometry_changed")
                    return
                }
            }
            if !exists { windowLost = true; event("target_lost"); stop("target_lost"); return }
        }
        if now - lastStatus >= 1 {
            lastStatus = now
            status(ready ? "recording" : "starting")
        }
    }

    func screenshotTick() {
        guard !stopping else { return }
        let now = hostTime()
        if let due = nextFrame, now >= due {
            // Count missed slots rather than synthesizing a burst. Saturate for impractically tiny intervals.
            let estimate = max(0, (now - due) / options.interval)
            let skips = estimate < Double(Int.max / 2) ? Int(estimate) : Int.max / 2
            missed = min(Int.max / 2, missed + skips)
            let remainder = (now - due).truncatingRemainder(dividingBy: options.interval)
            nextFrame = now + options.interval - remainder
            saveFrame(scheduled: now - remainder)
        }
    }

    func saveFrame(scheduled: Double) {
        guard !stopping, let buffer = latest, let pts = latestPTS, let origin = firstPTS else { missed += 1; return }
        let now = hostTime()
        let image = CIImage(cvPixelBuffer: buffer)
        guard let cgImage = context.createCGImage(image, from: image.extent) else {
            errors.append("Cannot render screenshot buffer"); stop("frame_error"); return
        }
        let relative = String(format: "frames/%06d.png", frames)
        guard let destination = CGImageDestinationCreateWithURL(url(relative) as CFURL, UTType.png.identifier as CFString, 1, nil) else {
            errors.append("Cannot create PNG destination"); stop("frame_error"); return
        }
        CGImageDestinationAddImage(destination, cgImage, nil)
        guard CGImageDestinationFinalize(destination) else {
            errors.append("PNG write failed"); stop("frame_error"); return
        }
        pngBytes += fileBytes(url(relative))
        do {
            let isRepeated = previousSavedPTS == pts
            try appendJSON([
                "file": relative, "sequence": frames, "media_seconds": now - origin,
                "source_media_seconds": pts - origin, "source_pts_seconds": pts,
                "monotonic_seconds": now, "wall_time": wallTime(),
                "scheduled_monotonic_seconds": scheduled, "scheduler_lateness_seconds": now - scheduled,
                "source_age_seconds": max(0, now - pts), "repeated_source": isRepeated,
                "width": cgImage.width, "height": cgImage.height
            ], url("frames/index.jsonl"))
            if isRepeated { repeated += 1 }
            previousSavedPTS = pts
            if let lastSavedHost {
                let interval = now - lastSavedHost
                minSavedInterval = min(minSavedInterval ?? interval, interval)
                maxSavedInterval = max(maxSavedInterval ?? interval, interval)
            }
            if firstSavedHost == nil { firstSavedHost = now }
            lastSavedHost = now
            frames += 1
            if firstFrameWall == nil { firstFrameWall = wallTime() }
            checkReady()
        } catch { errors.append("Frame index failed: \(error)"); stop("frame_error") }
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard !stopping, sampleBuffer.isValid else { return }
        let pts = sampleBuffer.presentationTimeStamp.seconds
        guard pts.isFinite else { return }
        if type == .microphone {
            guard sampleBuffer.numSamples > 0 else { return }
            if micFirstPTS == nil { micFirstPTS = pts }
            micLastPTS = pts
            micSamples += 1
            checkReady()
        } else if type == .screen {
            guard let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
                  let raw = attachments.first?[.status] as? Int,
                  SCFrameStatus(rawValue: raw) == .complete,
                  let buffer = sampleBuffer.imageBuffer else { return }
            let scale = attachments.first?[.scaleFactor] as? Double
            let contentScale = attachments.first?[.contentScale] as? Double
            if receivedVideoSamples > 0, scale != sampleScale || contentScale != sampleContentScale {
                event("target_geometry_changed", ["sample_scale": scale ?? NSNull(), "content_scale": contentScale ?? NSNull()])
                stop("target_geometry_changed")
                return
            }
            sampleScale = scale
            sampleContentScale = contentScale
            latest = buffer
            latestPTS = pts
            receivedVideoSamples += 1
            if firstPTS == nil {
                firstPTS = pts
                let now = hostTime()
                nextFrame = now + options.interval
                let frameTimer = DispatchSource.makeTimerSource(queue: queue)
                // Keep DispatchTime conversion bounded even for a valid enormous custom interval.
                let wakeInterval = min(86_400, max(0.01, options.interval))
                frameTimer.schedule(deadline: .now() + wakeInterval, repeating: wakeInterval, leeway: .milliseconds(1))
                frameTimer.setEventHandler { self.screenshotTick() }
                frameTimer.resume()
                self.frameTimer = frameTimer
                saveFrame(scheduled: now)
            }
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        queue.async {
            let nativeError = error as NSError
            let targetGone = nativeError.domain == SCStreamErrorDomain && nativeError.code == -3815
                || (self.options.type == "window" && self.windowSnapshot() == nil)
                || (self.options.type == "display" && CGDisplayIsOnline(self.options.id) == 0)
            if targetGone {
                self.windowLost = true
                self.nativeDiagnostics.append("Target disappeared: \(error)")
                self.event("target_lost")
            } else { self.errors.append("Stream stopped: \(error)") }
            self.stop(targetGone ? "target_lost" : "stream_error", streamAlreadyStopped: true)
        }
    }

    func recordingOutputDidStartRecording(_ recordingOutput: SCRecordingOutput) {
        queue.async {
            self.recordingStarted = true
            self.recordingStartHost = hostTime()
            self.event("recording_started")
            self.checkReady()
        }
    }

    func recordingOutput(_ recordingOutput: SCRecordingOutput, didFailWithError error: Error) {
        queue.async {
            self.recordingFailed = true
            self.errors.append("Recording failed: \(error)")
            self.stop("recording_error")
            self.maybeFinish()
        }
    }

    func recordingOutputDidFinishRecording(_ recordingOutput: SCRecordingOutput) {
        queue.async {
            self.recordingFinished = true
            self.event("recording_finalized")
            if !self.stopping {
                // Native finalization can precede the source-lost delegate callback.
                self.queue.asyncAfter(deadline: .now() + 0.1) {
                    guard !self.stopping else { return }
                    let gone = self.options.type == "window" ? self.windowSnapshot() == nil : CGDisplayIsOnline(self.options.id) == 0
                    if gone {
                        self.windowLost = true
                        self.event("target_lost")
                        self.stop("target_lost", streamAlreadyStopped: true)
                    } else { self.stop("recording_ended") }
                }
            }
            self.maybeFinish()
        }
    }

    func stop(_ reason: String, streamAlreadyStopped: Bool = false) {
        if streamAlreadyStopped { stopComplete = true }
        guard !stopping else { maybeFinish(); return }
        stopping = true
        frameTimer?.cancel()
        stopBegan = hostTime()
        stopReason = reason
        event("capture_stopping", ["reason": reason])
        status("stopping")
        if streamAlreadyStopped { maybeFinish(); return }
        if captureStartPending { return }
        stopStream()
    }

    func stopStream() {
        guard let stream else { stopComplete = true; finish(); return }
        stream.stopCapture { error in
            self.queue.async {
                if let error {
                    let nativeError = error as NSError
                    if nativeError.domain == SCStreamErrorDomain, nativeError.code == -3808, self.recordingFinished {
                        self.nativeDiagnostics.append("Stream was already stopped after recording finalized: \(error)")
                    } else { self.errors.append("Stop capture failed: \(error)") }
                }
                self.stopComplete = true
                self.maybeFinish()
            }
        }
    }

    func maybeFinish() {
        if stopComplete && (recordingFinished || recordingFailed) { finish() }
    }

    func finish() {
        guard !finalized else { return }
        finalized = true
        timer?.cancel()
        frameTimer?.cancel()
        bytes = recursiveBytes(options.session)
        let state = errors.isEmpty ? "stopped" : "failed"
        var report = summary(state)
        report["stopped_at"] = wallTime()
        report["ever_ready"] = ready
        report["recording_duration_seconds"] = recording.map { $0.recordedDuration.seconds } ?? NSNull()
        report["recording_duration_source"] = "SCRecordingOutput.recordedDuration; may be unavailable or coarse. Final asset duration is reported separately."
        report["recording_reported_bytes"] = recording.map { $0.recordedFileSize } ?? NSNull()
        report["screenshot_policy"] = "Persist latest complete screen buffer at each requested interval, repeating unchanged/stale source explicitly; missed scheduler slots are counted, not backfilled. Scheduler polls no faster than 0.01s; impossible-cadence missed count saturates at Int.max/2."
        // AVAsset inspection after native finalization describes actual tracks without decoding audio.
        let asset = AVURLAsset(url: url("screen.mov"))
        Task {
            var inspectionErrors: [String] = []
            do {
                let tracks = try await asset.load(.tracks)
                var trackInfo: [[String: Any]] = []
                for track in tracks {
                    let range = try await track.load(.timeRange)
                    trackInfo.append(["type": track.mediaType.rawValue, "start_seconds": range.start.seconds, "duration_seconds": range.duration.seconds])
                }
                report["movie_tracks"] = trackInfo
                report["movie_duration_seconds"] = try await asset.load(.duration).seconds
                report["movie_timing_source"] = "AVURLAsset.duration and AVAssetTrack.timeRange after recording finalization; non-finite native values are null with serialization_warnings."
                if self.options.audio == "microphone", !trackInfo.contains(where: { $0["type"] as? String == AVMediaType.audio.rawValue }) {
                    inspectionErrors.append("Finalized movie has no audio track despite requested microphone")
                }
            } catch {
                report["movie_inspection_error"] = String(describing: error)
                if self.recordingStarted { inspectionErrors.append("Final movie inspection failed: \(error)") }
            }
            self.queue.async {
                self.errors.append(contentsOf: inspectionErrors)
                report["errors"] = self.errors
                report["state"] = self.errors.isEmpty ? "stopped" : "failed"
                report["session_bytes"] = self.recursiveBytes(self.options.session)
                do {
                    try atomicJSON(report, self.url("native-final.json"))
                    try atomicJSON(report, self.url("native-status.json"))
                } catch {
                    fputs("Final metadata write failed: \(error)\n", stderr)
                    exit(1)
                }
                exit(self.errors.isEmpty ? 0 : 1)
            }
        }
    }
}

func windowInfo(_ window: SCWindow) -> [String: Any] {
    ["id": window.windowID, "title": window.title ?? "", "pid": window.owningApplication?.processID ?? 0,
     "application": window.owningApplication?.applicationName ?? "", "bundle_id": window.owningApplication?.bundleIdentifier ?? "",
     "width": Double(window.frame.width), "height": Double(window.frame.height), "x": Double(window.frame.minX), "y": Double(window.frame.minY),
     "on_screen": window.isOnScreen]
}

func displayInfo(_ display: SCDisplay) -> [String: Any] {
    ["id": display.displayID, "width": display.width, "height": display.height,
     "x": display.frame.minX, "y": display.frame.minY]
}

@main
struct Main {
    static var capture: AnyObject?
    static func main() {
        guard #available(macOS 15.0, *) else { fputs("macOS 15 or later is required\n", stderr); exit(2) }
        let args = Array(CommandLine.arguments.dropFirst())
        guard let command = args.first else { fputs("Usage: capture targets | capture run --session ABS_DIR --target-type window|display --target-id INT [--interval .25] [--audio none|microphone]\n", stderr); exit(2) }
        if command == "authorize-microphone", args.count == 1 {
            guard Bundle.main.object(forInfoDictionaryKey: "NSMicrophoneUsageDescription") is String else {
                fputs("Microphone authorization requires compiling with an embedded Info.plist containing NSMicrophoneUsageDescription. Use the skill wrapper build.\n", stderr)
                exit(2)
            }
            AVCaptureDevice.requestAccess(for: .audio) { granted in
                let data = try! jsonData(["permission": "microphone", "granted": granted, "recording_started": false])
                FileHandle.standardOutput.write(data)
                FileHandle.standardOutput.write(Data([10]))
                exit(granted ? 0 : 1)
            }
        } else if command == "authorize-screen", args.count == 1 {
            let granted = CGRequestScreenCaptureAccess()
            let data = try! jsonData(["permission": "screen", "granted": granted, "recording_started": false])
            FileHandle.standardOutput.write(data)
            FileHandle.standardOutput.write(Data([10]))
            exit(granted ? 0 : 1)
        } else if command == "targets", args.count == 1 {
            Task {
                do {
                    guard CGPreflightScreenCaptureAccess() else { throw CaptureError.message("Screen Recording permission is not granted") }
                    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
                    let data = try jsonData(["windows": content.windows.map(windowInfo), "displays": content.displays.map(displayInfo)])
                    FileHandle.standardOutput.write(data)
                    FileHandle.standardOutput.write(Data([10]))
                    exit(0)
                } catch { fputs("\(error)\n", stderr); exit(1) }
            }
        } else if command == "run" {
            do {
                let runner = Capture(try Options(Array(args.dropFirst())))
                capture = runner
                Task { await runner.start() }
            } catch { fputs("\(error)\n", stderr); exit(2) }
        } else { fputs("Unknown command or unexpected arguments\n", stderr); exit(2) }
        dispatchMain()
    }
}
