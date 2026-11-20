// PROOF OF CONCEPT (feature/native-window): the ping log in a window the helper draws itself, so it
// can do what the browser's picture-in-picture window can't: translucent, no title bar, floating
// above every window and full-screen app, position kept. It shows the "icon" ping, the active tab's.
import AppKit

private let mono = NSFont.monospacedSystemFont(ofSize: 12, weight: .regular)
private let monoBold = NSFont.monospacedSystemFont(ofSize: 12, weight: .semibold)
// The palette's dark values (extension/style.css), as on the TV screen.
private func color(_ hex: UInt32) -> NSColor {
    NSColor(srgbRed: CGFloat(hex >> 16 & 0xff) / 255, green: CGFloat(hex >> 8 & 0xff) / 255, blue: CGFloat(hex & 0xff) / 255, alpha: 1)
}
private let colors: [String: NSColor] = ["up": color(0x3ccf55), "down": color(0xff7a7a), "error": color(0xe2c048)]
private let dim = color(0x85858b), text = color(0xdbdbdb)

// Background: see-through while the mouse is elsewhere, nearly solid while it is over the window.
private final class Backdrop: NSView {
    override func viewDidMoveToWindow() {
        wantsLayer = true
        layer?.cornerRadius = 10
        rest()
        addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self))
    }
    private func rest() { layer?.backgroundColor = NSColor.black.withAlphaComponent(0.45).cgColor }
    override func mouseEntered(with event: NSEvent) { layer?.backgroundColor = NSColor.black.withAlphaComponent(0.9).cgColor }
    override func mouseExited(with event: NSEvent) { rest() }
}

final class PingWindow: NSObject {
    static let shared = PingWindow()
    private var panel: NSPanel?
    private let dot = NSView(), host = NSTextField(labelWithString: ""), log = NSTextView()
    private var lines = 0
    var onClose: (() -> Void)?

    var isVisible: Bool { panel?.isVisible ?? false }

    func show() {
        if panel == nil { build() }
        panel?.orderFrontRegardless()
    }

    func hide() { panel?.orderOut(nil) }

    @objc private func close() {
        hide()
        onClose?()
    }

    private func build() {
        let p = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 300, height: 170),
                        styleMask: [.borderless, .nonactivatingPanel, .resizable], backing: .buffered, defer: false)
        p.level = .floating
        p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        p.isOpaque = false
        p.backgroundColor = .clear
        p.hasShadow = true
        p.isMovableByWindowBackground = true
        p.hidesOnDeactivate = false
        p.minSize = NSSize(width: 200, height: 90)

        let back = Backdrop()
        p.contentView = back

        dot.wantsLayer = true
        dot.layer?.cornerRadius = 4
        dot.layer?.backgroundColor = dim.cgColor
        host.font = monoBold
        host.textColor = color(0xe6e6e6)
        host.lineBreakMode = .byTruncatingTail
        let closeButton = NSButton(title: "×", target: self, action: #selector(close))
        closeButton.isBordered = false
        closeButton.font = NSFont.systemFont(ofSize: 14)
        closeButton.contentTintColor = dim

        log.isEditable = false
        log.isSelectable = false
        log.drawsBackground = false
        log.textContainerInset = .zero
        let scroll = NSScrollView()
        scroll.documentView = log
        scroll.drawsBackground = false
        scroll.hasVerticalScroller = false
        log.autoresizingMask = [.width]

        for v in [dot, host, closeButton, scroll] as [NSView] {
            v.translatesAutoresizingMaskIntoConstraints = false
            back.addSubview(v)
        }
        NSLayoutConstraint.activate([
            dot.widthAnchor.constraint(equalToConstant: 8), dot.heightAnchor.constraint(equalToConstant: 8),
            dot.leadingAnchor.constraint(equalTo: back.leadingAnchor, constant: 12),
            dot.centerYAnchor.constraint(equalTo: host.centerYAnchor),
            host.leadingAnchor.constraint(equalTo: dot.trailingAnchor, constant: 8),
            host.topAnchor.constraint(equalTo: back.topAnchor, constant: 10),
            host.trailingAnchor.constraint(lessThanOrEqualTo: closeButton.leadingAnchor, constant: -8),
            closeButton.trailingAnchor.constraint(equalTo: back.trailingAnchor, constant: -10),
            closeButton.centerYAnchor.constraint(equalTo: host.centerYAnchor),
            scroll.topAnchor.constraint(equalTo: host.bottomAnchor, constant: 8),
            scroll.leadingAnchor.constraint(equalTo: back.leadingAnchor, constant: 12),
            scroll.trailingAnchor.constraint(equalTo: back.trailingAnchor, constant: -12),
            scroll.bottomAnchor.constraint(equalTo: back.bottomAnchor, constant: -10),
        ])

        p.setFrameAutosaveName("tab2ping.pingWindow")
        if !p.setFrameUsingName("tab2ping.pingWindow") {   // first time: top right of the main screen
            let screen = NSScreen.main?.visibleFrame ?? .zero
            p.setFrameOrigin(NSPoint(x: screen.maxX - p.frame.width - 20, y: screen.maxY - p.frame.height - 20))
        }
        panel = p
    }

    // One ping result of the active tab's host; a new host gets a "→ host" line first.
    func add(host newHost: String, type: String, ms: Double?, text detail: String?) {
        if panel == nil { build() }
        let state = ["reply": "up", "timeout": "down", "unreachable": "down", "error": "error"][type]
        guard let state else { return }
        if host.stringValue != newHost {
            if !host.stringValue.isEmpty { append([("→ " + newHost, dim)]) }
            host.stringValue = newHost
        }
        dot.layer?.backgroundColor = colors[state]?.cgColor
        let time = DateFormatter.localizedString(from: Date(), dateStyle: .none, timeStyle: .medium)
        let label = state == "up" ? String(format: ms ?? 0 < 10 ? "%.1f ms" : "%.0f ms", ms ?? 0)
            : state == "down" ? "–" : (detail ?? "error")
        append([(time + " ", dim), (label, colors[state] ?? text)])
    }

    private func append(_ parts: [(String, NSColor)]) {
        let line = NSMutableAttributedString()
        for (s, c) in parts { line.append(NSAttributedString(string: s, attributes: [.font: mono, .foregroundColor: c])) }
        line.append(NSAttributedString(string: "\n"))
        let storage = log.textStorage!
        storage.append(line)
        lines += 1
        if lines > 200, let nl = storage.string.firstIndex(of: "\n") {   // keep the last 200 lines
            storage.deleteCharacters(in: NSRange(storage.string.startIndex...nl, in: storage.string))
            lines -= 1
        }
        log.scrollToEndOfDocument(nil)
    }
}
