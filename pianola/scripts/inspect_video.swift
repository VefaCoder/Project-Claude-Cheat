// CI check: proves that AVFoundation (QuickTime) can open and decode an exported video.
// Usage: swift scripts/inspect_video.swift <file.mov>
import AVFoundation
import ImageIO

func fourCC(_ v: FourCharCode) -> String {
  String(bytes: [UInt8((v >> 24) & 255), UInt8((v >> 16) & 255), UInt8((v >> 8) & 255), UInt8(v & 255)], encoding: .ascii) ?? "?"
}

let url = URL(fileURLWithPath: CommandLine.arguments[1])
let asset = AVURLAsset(url: url)
let done = DispatchSemaphore(value: 0)
var failed = false

Task {
  do {
    let duration = try await asset.load(.duration)
    print("duration \(String(format: "%.2f", duration.seconds)) s")
    for track in try await asset.load(.tracks) {
      for desc in try await track.load(.formatDescriptions) {
        let codec = fourCC(CMFormatDescriptionGetMediaSubType(desc))
        if track.mediaType == .video {
          let dim = CMVideoFormatDescriptionGetDimensions(desc)
          let fps = try await track.load(.nominalFrameRate)
          print("video \(codec) \(dim.width)x\(dim.height) \(fps) fps")
        } else if track.mediaType == .audio, let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(desc)?.pointee {
          print("audio \(codec) \(Int(asbd.mSampleRate)) Hz \(asbd.mChannelsPerFrame) ch \(asbd.mBitsPerChannel) bit")
        }
      }
    }
    let gen = AVAssetImageGenerator(asset: asset)
    gen.requestedTimeToleranceBefore = .zero
    gen.requestedTimeToleranceAfter = .zero
    let (image, _) = try await gen.image(at: CMTime(seconds: min(4, duration.seconds / 2), preferredTimescale: 600))
    print("decoded frame \(image.width)x\(image.height)")
    if CommandLine.arguments.count > 2 {
      let out = URL(fileURLWithPath: CommandLine.arguments[2]) as CFURL
      if let dest = CGImageDestinationCreateWithURL(out, "public.png" as CFString, 1, nil) {
        CGImageDestinationAddImage(dest, image, nil)
        CGImageDestinationFinalize(dest)
      }
    }
  } catch {
    print("ERROR \(error)")
    failed = true
  }
  done.signal()
}
done.wait()
exit(failed ? 1 : 0)
