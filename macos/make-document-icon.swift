// Renders build/document.icns: the app artwork (build/icon.png) clipped to the
// macOS icon shape — an 824pt rounded square (superellipse) on a 1024pt
// canvas with a soft drop shadow, matching the Big Sur+ icon grid — so .crow
// documents look like a proper icon in Finder instead of a bare square.
//
//   swift macos/make-document-icon.swift
import AppKit

let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
let source = root.appendingPathComponent("build/icon.png")
let output = root.appendingPathComponent("build/document.icns")

guard let art = NSImage(contentsOf: source)?.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
  fatalError("can't read \(source.path)")
}

// Superellipse (n = 5) approximates Apple's continuous-corner icon shape.
func iconShape(in rect: CGRect) -> CGPath {
  let path = CGMutablePath()
  let a = rect.width / 2, b = rect.height / 2, n = 5.0
  for i in 0...720 {
    let t = Double(i) / 720 * 2 * .pi
    let c = cos(t), s = sin(t)
    let x = a * CGFloat(copysign(pow(abs(c), 2 / n), c))
    let y = b * CGFloat(copysign(pow(abs(s), 2 / n), s))
    let p = CGPoint(x: rect.midX + x, y: rect.midY + y)
    i == 0 ? path.move(to: p) : path.addLine(to: p)
  }
  path.closeSubpath()
  return path
}

func render(size: Int) -> Data {
  let s = CGFloat(size) / 1024
  let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
                      space: CGColorSpace(name: CGColorSpace.sRGB)!,
                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  ctx.interpolationQuality = .high
  let rect = CGRect(x: 100 * s, y: 100 * s, width: 824 * s, height: 824 * s)
  let shape = iconShape(in: rect)

  ctx.saveGState()
  ctx.setShadow(offset: CGSize(width: 0, height: -10 * s), blur: 28 * s,
                color: CGColor(gray: 0, alpha: 0.3))
  ctx.addPath(shape)
  ctx.setFillColor(CGColor(gray: 0, alpha: 1))
  ctx.fillPath()
  ctx.restoreGState()

  ctx.saveGState()
  ctx.addPath(shape)
  ctx.clip()
  ctx.draw(art, in: rect)
  ctx.restoreGState()

  let rep = NSBitmapImageRep(cgImage: ctx.makeImage()!)
  return rep.representation(using: .png, properties: [:])!
}

let iconset = FileManager.default.temporaryDirectory.appendingPathComponent("document.iconset")
try? FileManager.default.removeItem(at: iconset)
try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)
for base in [16, 32, 128, 256, 512] {
  try render(size: base).write(to: iconset.appendingPathComponent("icon_\(base)x\(base).png"))
  try render(size: base * 2).write(to: iconset.appendingPathComponent("icon_\(base)x\(base)@2x.png"))
}

let iconutil = Process()
iconutil.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
iconutil.arguments = ["-c", "icns", iconset.path, "-o", output.path]
try iconutil.run()
iconutil.waitUntilExit()
print(iconutil.terminationStatus == 0 ? "wrote \(output.path)" : "iconutil failed")
