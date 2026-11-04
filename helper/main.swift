// tab2ping helper: started by the browser via native messaging (one process per connection).
// It runs /sbin/ping for the hosts the extension asks for and opens Terminal with ping.
//
// Messages are JSON, each framed by a 32-bit length in native byte order (Chrome's protocol).
// In:  {"cmd":"hello"}                          -> {"type":"hello","version":"…"}
//      {"cmd":"ping","id":"…","host":"…"}       -> start (or restart) a ping under that id
//      {"cmd":"stop","id":"…"}                  -> end it
//      {"cmd":"terminal","host":"…"}            -> Terminal window running ping
//      {"cmd":"terminal","host":"…","follow":true} -> Terminal window whose ping follows "follow"
//      {"cmd":"follow","host":"…"}              -> that window pings this host from now on
// Out (all with "id" and "host"):
//      {"type":"reply","seq":0,"ms":1.2} | {"type":"timeout"} | {"type":"unreachable"}
//      {"type":"error","text":"…"} | {"type":"ended"} (the ping ended by itself, after its last line)
// "timeout" also comes from the helper itself when ping stays silent for 2 s (ping6 prints no
// timeouts; a slow name lookup prints nothing). Terminal errors come with id "terminal".
// Hosts are checked before use and always passed as a single argument, never through a shell.
import Foundation

let version = "0.2"
let writeQueue = DispatchQueue(label: "write")
// A closed channel shows up as a write error (then shutdown), not as a signal that would kill the
// helper before it ends its pings. Children get the default handling back.
signal(SIGPIPE, SIG_IGN)

func send(_ message: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: message) else { return }
    var length = UInt32(data.count)
    writeQueue.sync {
        do {
            try FileHandle.standardOutput.write(contentsOf: Data(bytes: &length, count: 4))
            try FileHandle.standardOutput.write(contentsOf: data)
        } catch {
            shutdown()   // the browser is gone
        }
    }
}

// A host name or an IPv4/IPv6 address (brackets of a URL's IPv6 host removed), nothing that ping
// or a shell could read as more.
func checkedHost(_ host: Any?) -> String? {
    guard var h = host as? String else { return nil }
    if h.hasPrefix("[") && h.hasSuffix("]") { h = String(h.dropFirst().dropLast()) }
    guard !h.isEmpty, h.count <= 253, !h.hasPrefix("-") else { return nil }
    let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-:")
    return h.unicodeScalars.allSatisfy(allowed.contains) ? h : nil
}

func isIPv6(_ host: String) -> Bool { host.contains(":") }

// --- Ping ---------------------------------------------------------------------------------------

final class Ping {
    let id: String, host: String
    let process = Process()
    var lastNews = Date()   // last reply/timeout/unreachable/error: the watchdog's reference
    var watchdog: DispatchSourceTimer?
    init(id: String, host: String) { self.id = id; self.host = host }
}

var pings: [String: Ping] = [:]
let lock = NSLock()

func current(_ p: Ping) -> Bool {
    lock.lock(); defer { lock.unlock() }
    return pings[p.id] === p
}

// One line of ping's output as a message, or nil for lines without news (header, statistics, ICMP
// dumps, ping6's "wrote … ret=-1" after a send error).
func parse(_ line: String) -> [String: Any]? {
    if line.contains(" bytes from "), let t = line.range(of: "time=") {
        let ms = Double(line[t.upperBound...].prefix { "0123456789.".contains($0) }) ?? 0
        let seq = line.range(of: "icmp_seq=").map { Int(line[$0.upperBound...].prefix { $0.isNumber }) ?? 0 } ?? 0
        return ["type": "reply", "seq": seq, "ms": ms]
    }
    if line.hasPrefix("Request timeout for icmp_seq") { return ["type": "timeout"] }
    // Same state, different words: no ICMP reply path to the host (e.g. a free IP in the LAN).
    if line.contains("Unreachable") || line.contains("No route to host") || line.contains("Host is down") {
        return ["type": "unreachable"]
    }
    if line.hasPrefix("ping6: wrote ") { return nil }
    if line.hasPrefix("ping:") || line.hasPrefix("ping6:") {
        return ["type": "error", "text": String(line.drop { $0 != " " }.dropFirst())]
    }
    return nil
}

func report(_ p: Ping, _ message: [String: Any]) {
    guard current(p) else { return }   // late lines of a ping already stopped or replaced
    var m = message
    m["id"] = p.id
    m["host"] = p.host
    lock.lock(); p.lastNews = Date(); lock.unlock()
    send(m)
}

// Hands over complete lines from a pipe; at its end, closes it and calls done.
func readLines(_ pipe: Pipe, _ onLine: @escaping (String) -> Void, done: @escaping () -> Void) {
    var buffer = Data()
    pipe.fileHandleForReading.readabilityHandler = { handle in
        let chunk = handle.availableData
        if chunk.isEmpty {
            handle.readabilityHandler = nil
            try? handle.close()
            done()
            return
        }
        buffer.append(chunk)
        while let nl = buffer.firstIndex(of: 0x0A) {
            let line = String(decoding: buffer[buffer.startIndex..<nl], as: UTF8.self)
            buffer.removeSubrange(buffer.startIndex...nl)
            onLine(line)
        }
    }
}

func stopPing(_ id: String) {
    lock.lock()
    let p = pings.removeValue(forKey: id)
    lock.unlock()
    guard let p else { return }
    p.watchdog?.cancel()
    if p.process.isRunning { p.process.terminate() }
}

func startPing(id: String, host: String) {
    stopPing(id)
    let p = Ping(id: id, host: host)
    // -n: no reverse lookups (faster lines); one probe per second, the default interval.
    p.process.executableURL = URL(fileURLWithPath: isIPv6(host) ? "/sbin/ping6" : "/sbin/ping")
    p.process.arguments = ["-n", host]
    p.process.standardInput = FileHandle.nullDevice   // the browser's channel stays ours alone
    let stdout = Pipe(), stderr = Pipe()
    p.process.standardOutput = stdout
    p.process.standardError = stderr
    // "ended" only after the process and both pipes are through, so it comes after the last line.
    let finished = DispatchGroup()
    finished.enter(); finished.enter(); finished.enter()
    let onLine = { (line: String) in if let m = parse(line) { report(p, m) } }
    readLines(stdout, onLine, done: { finished.leave() })
    readLines(stderr, onLine, done: { finished.leave() })
    p.process.terminationHandler = { _ in finished.leave() }
    finished.notify(queue: .global()) {
        p.watchdog?.cancel()
        guard current(p) else { return }   // stopped or replaced: no "ended"
        lock.lock(); pings.removeValue(forKey: id); lock.unlock()
        send(["type": "ended", "id": id, "host": host])
    }
    // Silence for 2 s counts as a timeout.
    let timer = DispatchSource.makeTimerSource(queue: .global())
    timer.schedule(deadline: .now() + 1, repeating: 1)
    timer.setEventHandler {
        lock.lock(); let silent = Date().timeIntervalSince(p.lastNews) >= 1.9; lock.unlock()   // timer leeway
        guard silent else { return }
        report(p, ["type": "timeout"])
        lock.lock(); p.lastNews = Date().addingTimeInterval(-1); lock.unlock()   // then one per second
    }
    p.watchdog = timer
    lock.lock(); pings[id] = p; lock.unlock()   // before run: the process may end at once
    do {
        try p.process.run()
        timer.resume()
    } catch {
        lock.lock(); pings.removeValue(forKey: id); lock.unlock()
        timer.resume(); timer.cancel()   // a suspended source must not be released
        for pipe in [stdout, stderr] {
            pipe.fileHandleForReading.readabilityHandler = nil
            try? pipe.fileHandleForReading.close()
            try? pipe.fileHandleForWriting.close()
        }
        send(["type": "error", "id": id, "host": host, "text": error.localizedDescription])
    }
}

// --- Terminal -----------------------------------------------------------------------------------

// Following the tab: Terminal runs follow.sh, which pings the host written in the target file and
// restarts ping when it changes. Host checked here and again in the script.
let support = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/tab2ping")
let followTarget = support.appendingPathComponent("follow-target")
let followScript = support.appendingPathComponent("follow.sh")
let followSource = """
#!/bin/sh
# Written by the tab2ping helper: pings the host in $1 and follows it when it changes.
file=$1; last=; pid=
trap '[ -n "$pid" ] && kill "$pid" 2>/dev/null' EXIT
while :; do
  host=$(cat "$file" 2>/dev/null)
  if [ "$host" != "$last" ]; then
    [ -n "$pid" ] && kill "$pid" 2>/dev/null && wait "$pid" 2>/dev/null
    pid=; last=$host
    case $host in
      ""|-*|*[!A-Za-z0-9.:-]*) ;;
      *:*) echo "→ $host"; ping6 -n "$host" & pid=$! ;;
      *) echo "→ $host"; ping -n "$host" & pid=$! ;;
    esac
  fi
  sleep 0.5
done

"""

func setFollow(_ host: String) {
    try? FileManager.default.createDirectory(at: support, withIntermediateDirectories: true)
    try? Data(host.utf8).write(to: followTarget, options: .atomic)
}

// Every word of the command goes in as an argument of the script and is quoted there ("quoted form of").
func openTerminal(_ command: [String]) {
    let script = [
        "on run argv",
        "set cmd to \"\"",
        "repeat with a in argv",
        "set cmd to cmd & quoted form of (a as text) & \" \"",
        "end repeat",
        "tell application \"Terminal\"",
        "do script cmd",
        "activate",
        "end tell",
        "end run",
    ]
    let host = command.last ?? ""
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
    p.arguments = script.flatMap { ["-e", $0] } + command
    p.standardInput = FileHandle.nullDevice
    p.standardOutput = FileHandle.nullDevice   // a script result must never reach the browser's channel
    let stderr = Pipe()
    p.standardError = stderr
    p.terminationHandler = { proc in
        let text = String(decoding: stderr.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
        try? stderr.fileHandleForReading.close()
        if proc.terminationStatus != 0 {
            send(["type": "error", "id": "terminal", "host": host, "text": text.trimmingCharacters(in: .whitespacesAndNewlines)])
        }
    }
    do { try p.run() } catch { send(["type": "error", "id": "terminal", "host": host, "text": error.localizedDescription]) }
}

// --- Messages from the browser ------------------------------------------------------------------

// Connection gone: no ping may outlive it (ping6 stays silent towards a dead host, so it would never
// notice the closed pipe by itself).
func shutdown() -> Never {
    lock.lock()   // held until exit: a second caller waits here instead of exiting early
    pings.values.forEach { $0.watchdog?.cancel(); if $0.process.isRunning { $0.process.terminate() } }
    exit(0)
}

func handle(_ msg: [String: Any]) {
    let id = msg["id"] as? String ?? "main"
    switch msg["cmd"] as? String {
    case "hello":
        send(["type": "hello", "version": version])
    case "ping":
        guard id != "terminal" else { return send(["type": "error", "id": id, "text": "reserved id"]) }
        guard let host = checkedHost(msg["host"]) else { return send(["type": "error", "id": id, "text": "invalid host"]) }
        startPing(id: id, host: host)
    case "stop":
        stopPing(id)
    case "terminal":
        guard let host = checkedHost(msg["host"]) else { return send(["type": "error", "id": "terminal", "text": "invalid host"]) }
        if msg["follow"] as? Bool == true {
            setFollow(host)
            try? Data(followSource.utf8).write(to: followScript, options: .atomic)
            openTerminal(["/bin/sh", followScript.path, followTarget.path])
        } else {
            openTerminal([isIPv6(host) ? "ping6" : "ping", host])
        }
    case "follow":
        if let host = checkedHost(msg["host"]) { setFollow(host) }
    default:
        send(["type": "error", "id": id, "text": "unknown command"])
    }
}

func readExactly(_ count: Int) -> Data? {
    var data = Data()
    while data.count < count {
        guard let chunk = try? FileHandle.standardInput.read(upToCount: count - data.count), !chunk.isEmpty else {
            return nil   // the browser closed the connection
        }
        data.append(chunk)
    }
    return data
}

DispatchQueue.global().async {
    while true {
        // One pool per message: the loop never ends, so without it nothing it creates (pipes,
        // processes, buffers) would ever be released.
        let more: Bool = autoreleasepool {
            guard let header = readExactly(4) else { return false }
            let length = header.withUnsafeBytes { Int($0.loadUnaligned(as: UInt32.self)) }
            guard length > 0, length < 1 << 20, let body = readExactly(length) else { return false }
            if let msg = try? JSONSerialization.jsonObject(with: body) as? [String: Any] { handle(msg) }
            return true
        }
        if !more { break }
    }
    shutdown()
}
dispatchMain()
