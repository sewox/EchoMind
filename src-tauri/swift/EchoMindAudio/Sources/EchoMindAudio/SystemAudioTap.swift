// System audio capture via a Core Audio process tap (macOS 14.2+).
//
// Taps the mixed output of every other process (meeting apps, browsers) before
// it reaches the output device, so remote participants are captured cleanly
// even with headphones and without a virtual device such as BlackHole.
// EchoMind's own process is excluded so playback of past recordings is not
// captured. Requires NSAudioCaptureUsageDescription; macOS asks once for
// "System Audio Recording".
import AudioToolbox
import CoreAudio
import Foundation

/// Called on Core Audio's IO thread with interleaved Float32 frames.
public typealias EchoMindSysTapCallback = @convention(c) (
    UnsafePointer<Float>?, UInt32, UInt32, Double, UnsafeMutableRawPointer?
) -> Void

private final class TapSession {
    var tapID = AudioObjectID(kAudioObjectUnknown)
    var aggregateID = AudioObjectID(kAudioObjectUnknown)
    var procID: AudioDeviceIOProcID?
}

private let sessionLock = NSLock()
private var session: TapSession?

/// Status codes returned to Rust.
private let kUnsupportedOS: Int32 = -1
private let kAlreadyRunning: Int32 = -2

private func teardown(_ s: TapSession) {
    if let p = s.procID {
        AudioDeviceStop(s.aggregateID, p)
        AudioDeviceDestroyIOProcID(s.aggregateID, p)
    }
    if s.aggregateID != kAudioObjectUnknown {
        AudioHardwareDestroyAggregateDevice(s.aggregateID)
    }
    if #available(macOS 14.2, *), s.tapID != kAudioObjectUnknown {
        AudioHardwareDestroyProcessTap(s.tapID)
    }
}

/// Starts capturing system audio. Returns 0 on success, a negative EchoMind
/// code, or a Core Audio OSStatus.
@_cdecl("echomind_systap_start")
public func echomind_systap_start(
    _ callback: EchoMindSysTapCallback,
    _ context: UnsafeMutableRawPointer?
) -> Int32 {
    guard #available(macOS 14.2, *) else { return kUnsupportedOS }
    sessionLock.lock()
    defer { sessionLock.unlock() }
    if session != nil { return kAlreadyRunning }

    let s = TapSession()
    // Exclude this process so EchoMind playback is not fed back into the tap.
    let selfPid = ProcessInfo.processInfo.processIdentifier
    let description = CATapDescription(stereoGlobalTapButExcludeProcesses: [selfPid])
    description.uuid = UUID()
    description.muteBehavior = .unmuted
    description.isPrivate = true

    var status = AudioHardwareCreateProcessTap(description, &s.tapID)
    if status != noErr { return status }

    var format = AudioStreamBasicDescription()
    var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioTapPropertyFormat,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    status = AudioObjectGetPropertyData(s.tapID, &address, 0, nil, &size, &format)
    if status != noErr { teardown(s); return status }
    let rate = format.mSampleRate

    let aggregate: [String: Any] = [
        kAudioAggregateDeviceNameKey: "EchoMind System Audio",
        kAudioAggregateDeviceUIDKey: UUID().uuidString,
        kAudioAggregateDeviceIsPrivateKey: true,
        kAudioAggregateDeviceIsStackedKey: false,
        kAudioAggregateDeviceTapAutoStartKey: true,
        kAudioAggregateDeviceTapListKey: [
            [kAudioSubTapUIDKey: description.uuid.uuidString,
             kAudioSubTapDriftCompensationKey: true]
        ],
    ]
    status = AudioHardwareCreateAggregateDevice(aggregate as CFDictionary, &s.aggregateID)
    if status != noErr { teardown(s); return status }

    status = AudioDeviceCreateIOProcIDWithBlock(&s.procID, s.aggregateID, nil) {
        _, inputData, _, _, _ in
        let buffers = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: inputData))
        for buffer in buffers {
            guard let data = buffer.mData else { continue }
            let samples = Int(buffer.mDataByteSize) / MemoryLayout<Float>.size
            let bufChannels = max(buffer.mNumberChannels, 1)
            let frames = UInt32(samples) / bufChannels
            callback(data.assumingMemoryBound(to: Float.self), frames, bufChannels, rate, context)
        }
    }
    if status != noErr { teardown(s); return status }

    status = AudioDeviceStart(s.aggregateID, s.procID)
    if status != noErr { teardown(s); return status }

    session = s
    return 0
}

/// Stops capturing. Safe to call when not running.
@_cdecl("echomind_systap_stop")
public func echomind_systap_stop() {
    sessionLock.lock()
    let s = session
    session = nil
    sessionLock.unlock()
    if let s { teardown(s) }
}

/// 1 when this macOS supports process taps (14.2+), else 0.
@_cdecl("echomind_systap_supported")
public func echomind_systap_supported() -> Int32 {
    if #available(macOS 14.2, *) { return 1 }
    return 0
}
