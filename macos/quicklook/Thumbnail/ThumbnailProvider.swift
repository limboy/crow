// Quick Look thumbnail for .crow documents — what Finder shows in its preview
// pane, gallery view and large icon sizes. Draws a card: the app artwork as a
// header, then the document's name and its table, record and media counts.
import AppKit
import QuickLookThumbnailing

final class ThumbnailProvider: QLThumbnailProvider {
  override func provideThumbnail(for request: QLFileThumbnailRequest,
                                 _ handler: @escaping (QLThumbnailReply?, Error?) -> Void) {
    let doc: CrowDocument
    do { doc = try CrowDocument(url: request.fileURL) } catch { return handler(nil, error) }
    let lines = Self.summary(of: doc)
    let side = min(request.maximumSize.width, request.maximumSize.height)
    let size = CGSize(width: side, height: side)
    handler(QLThumbnailReply(contextSize: size, currentContextDrawing: {
      Self.drawCard(size: size, title: doc.title, lines: lines)
      return true
    }), nil)
  }

  static func summary(of doc: CrowDocument) -> [String] {
    guard doc.project != nil else { return ["Open in Crow to convert"] }
    let tables = doc.tables
    var lines = ["\(count(doc.recordCount, "record")) · \(count(tables.count, "table"))"]
    let media = doc.mediaCounts().filter { $0.count > 0 }.map { "\($0.count.formatted()) \($0.label.lowercased())" }
    if !media.isEmpty { lines.append(media.prefix(2).joined(separator: " · ")) }
    let names = tables.compactMap { $0["name"] as? String }
    if !names.isEmpty { lines.append(names.joined(separator: ", ")) }
    return lines
  }

  static func count(_ n: Int, _ noun: String) -> String {
    "\(n.formatted()) \(noun)\(n == 1 ? "" : "s")"
  }

  static let artwork = Bundle.main.image(forResource: "artwork")

  // AppKit coordinates: origin at the bottom left.
  static func drawCard(size: CGSize, title: String, lines: [String]) {
    let s = size.width
    let card = CGRect(origin: .zero, size: size).insetBy(dx: s * 0.02, dy: s * 0.02)
    let shape = NSBezierPath(roundedRect: card, xRadius: s * 0.06, yRadius: s * 0.06)
    NSColor.white.setFill()
    shape.fill()

    // Header: the artwork, aspect-filled and anchored to its top edge.
    let header = CGRect(x: card.minX, y: card.maxY - card.height * 0.44, width: card.width, height: card.height * 0.44)
    NSGraphicsContext.saveGraphicsState()
    shape.addClip()
    NSBezierPath(rect: header).addClip()
    if let art = artwork {
      let scale = header.width / art.size.width
      let h = art.size.height * scale
      art.draw(in: CGRect(x: header.minX, y: header.maxY - h, width: header.width, height: h))
    } else {
      NSColor(red: 0.17, green: 0.58, blue: 0.59, alpha: 1).setFill()
      header.fill()
    }
    NSGraphicsContext.restoreGraphicsState()

    NSColor(white: 0, alpha: 0.12).setStroke()
    shape.lineWidth = max(1, s * 0.004)
    shape.stroke()

    // Body text, top to bottom.
    let pad = s * 0.07
    let width = card.width - pad * 2
    var y = header.minY - pad * 0.8
    func draw(_ text: String, size: CGFloat, weight: NSFont.Weight, color: NSColor, gap: CGFloat) {
      let para = NSMutableParagraphStyle()
      para.lineBreakMode = .byTruncatingTail
      let str = NSAttributedString(string: text, attributes: [
        .font: NSFont.systemFont(ofSize: size, weight: weight),
        .foregroundColor: color,
        .paragraphStyle: para,
      ])
      let h = ceil(size * 1.3)
      guard y - h >= card.minY + pad * 0.5 else { return }
      str.draw(with: CGRect(x: card.minX + pad, y: y - h, width: width, height: h),
               options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine])
      y -= h + gap
    }
    draw(title, size: s * 0.085, weight: .semibold, color: NSColor(white: 0.11, alpha: 1), gap: s * 0.035)
    for (i, line) in lines.enumerated() {
      let last = i == lines.count - 1 && lines.count > 2
      draw(line, size: s * 0.056, weight: .regular,
           color: last ? NSColor(white: 0.55, alpha: 1) : NSColor(white: 0.25, alpha: 1), gap: s * 0.018)
    }
  }
}
