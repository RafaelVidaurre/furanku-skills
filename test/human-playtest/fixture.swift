// Owned, silent, nonactivating test window. Does not read any user application.
// xcrun swiftc fixture.swift -o fixture; fixture [--seconds 20] [--output /tmp/fixture.json]
import AppKit

final class FixtureView: NSView {
    var tick = 0
    override func draw(_ dirtyRect: NSRect) {
        NSColor(calibratedRed: 0.08, green: 0.12, blue: 0.20, alpha: 1).setFill()
        bounds.fill()
        NSColor(calibratedRed: 0.2, green: 0.8, blue: 0.7, alpha: 1).setFill()
        NSBezierPath(rect: NSRect(x: 20 + (tick * 7) % 450, y: 65, width: 50, height: 50)).fill()
        let title = "HUMAN PLAYTEST • SYNTHETIC FIXTURE\nSilent owned window • tick \(tick)"
        (title as NSString).draw(at: NSPoint(x: 20, y: 170), withAttributes: [
            .foregroundColor: NSColor.white,
            .font: NSFont.monospacedSystemFont(ofSize: 18, weight: .medium)
        ])
    }
}

let arguments = Array(CommandLine.arguments.dropFirst())
func argument(_ name: String) -> String? {
    guard let index = arguments.firstIndex(of: name), index + 1 < arguments.count else { return nil }
    return arguments[index + 1]
}
let duration = min(120, max(1, Double(argument("--seconds") ?? "20") ?? 20))
let freezeAfter = Double(argument("--freeze-after") ?? "")
let resizeAfter = Double(argument("--resize-after") ?? "")
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let frontBefore = NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0
let panel = NSPanel(contentRect: NSRect(x: 80, y: 80, width: 560, height: 260),
                    styleMask: [.titled, .nonactivatingPanel], backing: .buffered, defer: false)
panel.title = "Human Playtest Synthetic Fixture"
panel.hidesOnDeactivate = false
panel.becomesKeyOnlyIfNeeded = true
panel.isFloatingPanel = false
panel.isReleasedWhenClosed = false
let view = FixtureView(frame: panel.contentView!.bounds)
panel.contentView = view
panel.orderFrontRegardless()
let info: [String: Any] = ["pid": getpid(), "window_id": panel.windowNumber,
                         "title": panel.title, "frontmost_pid_before": frontBefore,
                         "frontmost_pid_after": NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0,
                         "audio": "none", "duration_seconds": duration]
let data = try JSONSerialization.data(withJSONObject: info, options: [.sortedKeys])
if let output = argument("--output") { try data.write(to: URL(fileURLWithPath: output), options: .atomic) }
FileHandle.standardOutput.write(data)
FileHandle.standardOutput.write(Data([10]))
let animation = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { _ in
    if let freezeAfter, Double(view.tick) / 10 >= freezeAfter { return }
    view.tick += 1
    view.needsDisplay = true
}
if let resizeAfter {
    Timer.scheduledTimer(withTimeInterval: max(0.1, resizeAfter), repeats: false) { _ in
        panel.setContentSize(NSSize(width: 600, height: 300))
    }
}
Timer.scheduledTimer(withTimeInterval: duration, repeats: false) { _ in
    animation.invalidate()
    panel.close()
    app.terminate(nil)
}
app.run()
