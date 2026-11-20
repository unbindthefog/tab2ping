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
// German if macOS is set to German, otherwise English (as the extension does).
private let german = Locale.preferredLanguages.first?.hasPrefix("de") ?? false
// Own settings domain, independent of the executable's file name.
private let settings = UserDefaults(suiteName: "com.unbindthefog.tab2ping") ?? .standard

// Background: what lies behind the window, blurred (the system's frosted glass), under a dark tint.
// The tint's strength is the transparency setting (gear menu); under the mouse it is nearly solid.
private final class Backdrop: NSVisualEffectView {
    private let tint = NSView()
    private var hovering = false
    // 0 = barely see-through, 1 = as clear as it gets; kept between runs.
    var transparency: Double = settings.object(forKey: "transparency") as? Double ?? 0.5 {
        didSet { settings.set(transparency, forKey: "transparency"); update() }
    }

    override func viewDidMoveToWindow() {
        guard window != nil, tint.superview == nil else { return }   // set up once
        material = .hudWindow
        blendingMode = .behindWindow
        state = .active
        // The blur is drawn by the window server: rounded corners need a mask image, not a layer radius.
        maskImage = NSImage(size: NSSize(width: 21, height: 21), flipped: false) { rect in
            NSBezierPath(roundedRect: rect, xRadius: 10, yRadius: 10).fill()
            return true
        }
        maskImage?.capInsets = NSEdgeInsets(top: 10, left: 10, bottom: 10, right: 10)
        maskImage?.resizingMode = .stretch
        wantsLayer = true
        tint.wantsLayer = true
        tint.frame = bounds
        tint.autoresizingMask = [.width, .height]
        addSubview(tint, positioned: .below, relativeTo: nil)
        update()
        addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self))
    }
    private func update() {
        let alpha = hovering ? 0.9 : 0.85 - 0.8 * transparency
        tint.layer?.backgroundColor = NSColor.black.withAlphaComponent(alpha).cgColor
    }
    override func mouseEntered(with event: NSEvent) { hovering = true; update() }
    override func mouseExited(with event: NSEvent) { hovering = false; update() }
}

final class PingWindow: NSObject {
    static let shared = PingWindow()
    private var panel: NSPanel?
    private let dot = NSView(), host = NSTextField(labelWithString: ""), log = NSTextView()
    private let backdrop = Backdrop()
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

        let back = backdrop
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
        let gear = NSButton(image: NSImage(systemSymbolName: "gearshape", accessibilityDescription: german ? "Einstellungen" : "Settings")!,
                            target: self, action: #selector(showSettings(_:)))
        gear.isBordered = false
        gear.contentTintColor = dim

        log.isEditable = false
        log.isSelectable = false
        log.drawsBackground = false
        log.textContainerInset = .zero
        let scroll = NSScrollView()
        scroll.documentView = log
        scroll.drawsBackground = false
        scroll.hasVerticalScroller = false
        log.autoresizingMask = [.width]

        for v in [dot, host, gear, closeButton, scroll] as [NSView] {
            v.translatesAutoresizingMaskIntoConstraints = false
            back.addSubview(v)
        }
        NSLayoutConstraint.activate([
            dot.widthAnchor.constraint(equalToConstant: 8), dot.heightAnchor.constraint(equalToConstant: 8),
            dot.leadingAnchor.constraint(equalTo: back.leadingAnchor, constant: 12),
            dot.centerYAnchor.constraint(equalTo: host.centerYAnchor),
            host.leadingAnchor.constraint(equalTo: dot.trailingAnchor, constant: 8),
            host.topAnchor.constraint(equalTo: back.topAnchor, constant: 10),
            host.trailingAnchor.constraint(lessThanOrEqualTo: gear.leadingAnchor, constant: -8),
            gear.trailingAnchor.constraint(equalTo: closeButton.leadingAnchor, constant: -6),
            gear.centerYAnchor.constraint(equalTo: host.centerYAnchor),
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

    // Gear menu: one slider for the transparency, applied while it moves.
    @objc private func showSettings(_ sender: NSButton) {
        let menu = NSMenu()
        let item = NSMenuItem()
        let box = NSView(frame: NSRect(x: 0, y: 0, width: 200, height: 46))
        let label = NSTextField(labelWithString: german ? "Transparenz" : "Transparency")
        label.font = NSFont.systemFont(ofSize: 11)
        label.textColor = .secondaryLabelColor
        label.frame = NSRect(x: 14, y: 26, width: 172, height: 14)
        let slider = NSSlider(value: backdrop.transparency, minValue: 0, maxValue: 1, target: self, action: #selector(slide(_:)))
        slider.isContinuous = true
        slider.frame = NSRect(x: 12, y: 4, width: 176, height: 20)
        box.addSubview(label)
        box.addSubview(slider)
        item.view = box
        menu.addItem(item)
        menu.popUp(positioning: nil, at: NSPoint(x: 0, y: -4), in: sender)   // just below the gear
    }

    @objc private func slide(_ slider: NSSlider) { backdrop.transparency = slider.doubleValue }

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
