// Quick Look thumbnail for .crow documents — what Finder shows in its preview
// pane, gallery view and large icon sizes. It's the top of the space-bar
// preview's page (CrowPreview.swift), drawn natively to match its CSS: WebKit
// can't start its content process inside a thumbnail extension. Always light,
// since a thumbnail is cached regardless of the current appearance.
import AppKit
import QuickLookThumbnailing

final class ThumbnailProvider: QLThumbnailProvider {
  override func provideThumbnail(for request: QLFileThumbnailRequest,
                                 _ handler: @escaping (QLThumbnailReply?, Error?) -> Void) {
    let preview: CrowPreview
    do { preview = try CrowPreview(url: request.fileURL) } catch { return handler(nil, error) }

    let page = CrowPreview.pageSize
    let scale = min(request.maximumSize.width / page.width, request.maximumSize.height / page.height)
    let size = CGSize(width: floor(page.width * scale), height: floor(page.height * scale))
    handler(QLThumbnailReply(contextSize: size, currentContextDrawing: {
      guard let cg = NSGraphicsContext.current?.cgContext else { return false }
      // Lay out in page points with a top-left origin, like the HTML.
      cg.translateBy(x: 0, y: size.height)
      cg.scaleBy(x: scale, y: -scale)
      NSGraphicsContext.current = NSGraphicsContext(cgContext: cg, flipped: true)
      PageRenderer(preview: preview).draw()
      return true
    }), nil)
  }
}

private let fg = NSColor(srgbRed: 0x1d / 255, green: 0x1d / 255, blue: 0x1f / 255, alpha: 1)
private let muted = NSColor(srgbRed: 0x6e / 255, green: 0x6e / 255, blue: 0x73 / 255, alpha: 1)
private let line = NSColor(srgbRed: 0xe5 / 255, green: 0xe5 / 255, blue: 0xea / 255, alpha: 1)
private let chip = NSColor(srgbRed: 0xf2 / 255, green: 0xf2 / 255, blue: 0xf7 / 255, alpha: 1)

private let tagColors: [String: NSColor] = [
  "red": NSColor(srgbRed: 1, green: 0.23, blue: 0.19, alpha: 0.15),
  "orange": NSColor(srgbRed: 1, green: 0.58, blue: 0, alpha: 0.15),
  "amber": NSColor(srgbRed: 1, green: 0.8, blue: 0, alpha: 0.2),
  "green": NSColor(srgbRed: 0.2, green: 0.78, blue: 0.35, alpha: 0.15),
  "teal": NSColor(srgbRed: 0.19, green: 0.69, blue: 0.78, alpha: 0.15),
  "blue": NSColor(srgbRed: 0, green: 0.48, blue: 1, alpha: 0.15),
  "indigo": NSColor(srgbRed: 0.35, green: 0.34, blue: 0.84, alpha: 0.15),
  "purple": NSColor(srgbRed: 0.69, green: 0.32, blue: 0.87, alpha: 0.15),
  "pink": NSColor(srgbRed: 1, green: 0.18, blue: 0.33, alpha: 0.15),
]

private struct PageRenderer {
  let preview: CrowPreview
  let page = CrowPreview.pageSize
  let left: CGFloat = 32
  var width: CGFloat { page.width - left * 2 }

  func draw() {
    NSColor.white.setFill()
    CGRect(origin: .zero, size: page).fill()

    var y: CGFloat = 28
    y += text(preview.title, x: left, y: y, size: 22, weight: .semibold) + 2
    y += text("Crow Document", x: left, y: y, size: 13, color: muted)

    if let meta = preview.meta {
      y += 18
      rule(y)
      y = metaRow(meta, top: y + 14) + 14
      rule(y)
      y += 8
    } else {
      y += 8 + text(CrowPreview.legacyNote, x: left, y: y + 8, size: 13, color: muted)
    }

    for table in preview.tables where y < page.height {
      y = section(table, top: y + 24)
    }
  }

  /// Draws one line, truncated to `maxWidth`, and returns its height.
  @discardableResult
  func text(_ s: String, x: CGFloat, y: CGFloat, size: CGFloat, weight: NSFont.Weight = .regular,
            color: NSColor = fg, maxWidth: CGFloat? = nil, kern: CGFloat = 0) -> CGFloat {
    let para = NSMutableParagraphStyle()
    para.lineBreakMode = .byTruncatingTail
    let str = NSAttributedString(string: s, attributes: [
      .font: NSFont.systemFont(ofSize: size, weight: weight), .foregroundColor: color,
      .paragraphStyle: para, .kern: kern,
    ])
    let h = ceil(size * 1.25)
    str.draw(with: CGRect(x: x, y: y, width: maxWidth ?? (left + width - x), height: h),
             options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine])
    return h
  }

  func measure(_ s: String, size: CGFloat, weight: NSFont.Weight = .regular, kern: CGFloat = 0) -> CGFloat {
    ceil(NSAttributedString(string: s, attributes: [.font: NSFont.systemFont(ofSize: size, weight: weight), .kern: kern]).size().width)
  }

  func rule(_ y: CGFloat) {
    line.setFill()
    CGRect(x: left, y: y, width: width, height: 1).fill()
  }

  func pill(_ rect: CGRect, radius: CGFloat, color: NSColor) {
    color.setFill()
    NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius).fill()
  }

  /// The label/value pairs, flowing left to right and wrapping. Returns the bottom.
  func metaRow(_ meta: [(String, String)], top: CGFloat) -> CGFloat {
    var x = left, y = top
    let itemHeight: CGFloat = 14 + 2 + 17
    for (k, v) in meta {
      let label = k.uppercased()
      let w = max(measure(label, size: 11, kern: 0.44), measure(v, size: 13, weight: .medium))
      if x > left, x + w > left + width { x = left; y += itemHeight + 8 }
      text(label, x: x, y: y, size: 11, color: muted, maxWidth: w + 2, kern: 0.44)
      text(v, x: x, y: y + 16, size: 13, weight: .medium, maxWidth: w + 2)
      x += w + 28
    }
    return y + itemHeight
  }

  /// A table's heading, field chips and sample rows. Returns the bottom.
  func section(_ t: CrowPreview.Table, top: CGFloat) -> CGFloat {
    var y = top
    let nameWidth = min(measure(t.name, size: 15, weight: .semibold), width * 0.6)
    text(t.name, x: left, y: y, size: 15, weight: .semibold, maxWidth: nameWidth + 1)
    text("\(t.recordCount.formatted()) records · \(t.fields.count) fields", x: left + nameWidth + 10, y: y + 3, size: 12, color: muted)
    y += 19 + 8

    // Field chips, wrapping.
    var x = left
    let chipHeight: CGFloat = 16 + 6
    for f in t.fields {
      let nw = measure(f.name, size: 13), tw = measure(f.type, size: 10.8)
      let w = 8 + nw + 6 + tw + 8
      if x > left, x + w > left + width { x = left; y += chipHeight + 6 }
      pill(CGRect(x: x, y: y, width: w, height: chipHeight), radius: 6, color: chip)
      text(f.name, x: x + 8, y: y + 3, size: 13, maxWidth: nw + 1)
      text(f.type, x: x + 8 + nw + 6, y: y + 5, size: 10.8, color: muted, maxWidth: tw + 1)
      x += w + 6
    }
    if !t.fields.isEmpty { y += chipHeight }
    y += 12

    // Sample rows: equal-width columns, like `table-layout: fixed`.
    guard !t.rows.isEmpty, !t.columns.isEmpty else { return y }
    let colWidth = width / CGFloat(t.columns.count)
    for (i, c) in t.columns.enumerated() {
      text(c, x: left + CGFloat(i) * colWidth + 8, y: y + 6, size: 12, weight: .medium, color: muted, maxWidth: colWidth - 16)
    }
    y += 6 + 15 + 6
    rule(y - 1)
    for row in t.rows where y < page.height {
      for (i, cell) in row.enumerated() {
        draw(cell, x: left + CGFloat(i) * colWidth + 8, y: y + 6, maxWidth: colWidth - 16)
      }
      y += 6 + 17 + 6
      rule(y - 1)
    }
    if t.recordCount > t.rows.count {
      y += 8 + text("and \((t.recordCount - t.rows.count).formatted()) more…", x: left, y: y + 8, size: 13, color: muted)
    }
    return y
  }

  func draw(_ cell: CrowPreview.Cell, x: CGFloat, y: CGFloat, maxWidth: CGFloat) {
    switch cell {
    case .text(let s): text(s, x: x, y: y, size: 13, maxWidth: maxWidth)
    case .muted(let s): text(s, x: x, y: y, size: 13, color: muted, maxWidth: maxWidth)
    case .tags(let tags):
      var tx = x
      for (name, color) in tags {
        let w = min(measure(name, size: 12) + 12, x + maxWidth - tx)
        guard w > 12 else { break }
        pill(CGRect(x: tx, y: y, width: w, height: 17), radius: 4, color: tagColors[color] ?? chip)
        text(name, x: tx + 6, y: y + 1.5, size: 12, maxWidth: w - 12)
        tx += w + 4
      }
    }
  }
}
