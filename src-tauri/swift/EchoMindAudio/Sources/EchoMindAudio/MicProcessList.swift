// Lists processes that currently hold microphone input (macOS 14.2+).
//
// Uses Core Audio process objects (`kAudioHardwarePropertyProcessObjectList`,
// `kAudioProcessPropertyIsRunningInput`, `kAudioProcessPropertyPID`,
// `kAudioProcessPropertyBundleID`). Reading these properties queries
// coreaudiod's public state and does not require a new TCC permission prompt
// (unlike capturing another process's audio via a process tap).
import AppKit
import CoreAudio
import Foundation

private let kUnsupportedOS: Int32 = -1

private func readUInt32(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> UInt32? {
    var address = AudioObjectPropertyAddress(
        mSelector: selector,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    var value: UInt32 = 0
    var size = UInt32(MemoryLayout<UInt32>.size)
    guard AudioObjectGetPropertyData(object, &address, 0, nil, &size, &value) == noErr else {
        return nil
    }
    return value
}

private func readPID(_ object: AudioObjectID) -> pid_t? {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioProcessPropertyPID,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    var value: pid_t = 0
    var size = UInt32(MemoryLayout<pid_t>.size)
    guard AudioObjectGetPropertyData(object, &address, 0, nil, &size, &value) == noErr else {
        return nil
    }
    return value
}

private func readBundleID(_ object: AudioObjectID) -> String? {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioProcessPropertyBundleID,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    var value: Unmanaged<CFString>?
    var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
    guard AudioObjectGetPropertyData(object, &address, 0, nil, &size, &value) == noErr else {
        return nil
    }
    return value?.takeRetainedValue() as String?
}

private func localizedName(forBundleID bundleID: String, pid: pid_t) -> String {
    if let app = NSRunningApplication(processIdentifier: pid),
       let name = app.localizedName, !name.isEmpty {
        return name
    }
    if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID),
       let bundle = Bundle(url: url),
       let name = bundle.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String,
       !name.isEmpty {
        return name
    }
    if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID),
       let bundle = Bundle(url: url),
       let name = bundle.object(forInfoDictionaryKey: "CFBundleName") as? String,
       !name.isEmpty {
        return name
    }
    // Last path component of the bundle id (e.g. "Zoom" from us.zoom.xos).
    if let last = bundleID.split(separator: ".").last, !last.isEmpty {
        return String(last)
    }
    return bundleID
}

/// 1 when process-object mic listing is available (macOS 14.2+), else 0.
@_cdecl("echomind_mic_proc_supported")
public func echomind_mic_proc_supported() -> Int32 {
    if #available(macOS 14.2, *) { return 1 }
    return 0
}

/// Returns a heap-allocated JSON array of mic-holding processes:
/// `[{"pid":123,"bundle_id":"…","display_name":"…"}, …]`.
/// Caller must free with `echomind_mic_proc_free`. Returns null when
/// unsupported or on serialization failure; empty array `[]` when none.
@_cdecl("echomind_mic_proc_snapshot")
public func echomind_mic_proc_snapshot() -> UnsafeMutablePointer<CChar>? {
    guard #available(macOS 14.2, *) else { return nil }

    var address = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyProcessObjectList,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    var size: UInt32 = 0
    let sys = AudioObjectID(kAudioObjectSystemObject)
    guard AudioObjectGetPropertyDataSize(sys, &address, 0, nil, &size) == noErr, size > 0 else {
        return strdup("[]")
    }
    var objects = [AudioObjectID](
        repeating: 0,
        count: Int(size) / MemoryLayout<AudioObjectID>.size)
    guard AudioObjectGetPropertyData(sys, &address, 0, nil, &size, &objects) == noErr else {
        return strdup("[]")
    }

    let selfPID = ProcessInfo.processInfo.processIdentifier
    var rows: [[String: Any]] = []
    for obj in objects {
        guard readUInt32(obj, kAudioProcessPropertyIsRunningInput) == 1 else { continue }
        guard let pid = readPID(obj), pid != selfPID else { continue }
        let bundleID = readBundleID(obj) ?? ""
        let name = bundleID.isEmpty
            ? "pid:\(pid)"
            : localizedName(forBundleID: bundleID, pid: pid)
        rows.append([
            "pid": Int(pid),
            "bundle_id": bundleID,
            "display_name": name,
        ])
    }

    guard let data = try? JSONSerialization.data(withJSONObject: rows),
          let json = String(data: data, encoding: .utf8) else {
        return strdup("[]")
    }
    return strdup(json)
}

/// Frees a string returned by `echomind_mic_proc_snapshot`.
@_cdecl("echomind_mic_proc_free")
public func echomind_mic_proc_free(_ ptr: UnsafeMutablePointer<CChar>?) {
    if let ptr { free(ptr) }
}

/// Same availability as `echomind_mic_proc_supported` (kept for symmetry with
/// the system-tap bridge). Returns -1 when unsupported so callers can tell
/// "API missing" from "supported but empty".
@_cdecl("echomind_mic_proc_probe")
public func echomind_mic_proc_probe() -> Int32 {
    if #available(macOS 14.2, *) { return 0 }
    return kUnsupportedOS
}
