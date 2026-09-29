// Quick Look preview for .crow documents (space bar in Finder, and Finder's
// preview pane). Reads the package's data.json — see docs/crow-format.md — and
// renders an HTML summary: the document's dates and size, then each table's
// fields and first few records.
import Foundation
import QuickLookUI
import UniformTypeIdentifiers

final class PreviewProvider: QLPreviewProvider, QLPreviewingController {
  func providePreview(for request: QLFilePreviewRequest) async throws -> QLPreviewReply {
    let html = try CrowPreview(url: request.fileURL).html()
    return QLPreviewReply(dataOfContentType: .html, contentSize: CGSize(width: 820, height: 640)) { reply in
      reply.stringEncoding = .utf8
      return Data(html.utf8)
    }
  }
}

private let sampleRows = 8
private let sampleColumns = 6

struct CrowPreview {
  let url: URL

  func html() throws -> String {
    let title = url.deletingPathExtension().lastPathComponent
    var isDir: ObjCBool = false
    FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir)
    guard isDir.boolValue else {
      // A pre-3.0 single-file document; the app converts it on open.
      return page(title: title, body: "<p class=note>This is an older single-file Crow document. Open it in Crow to convert it.</p>")
    }

    let data = try Data(contentsOf: url.appendingPathComponent("data.json"))
    guard let project = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      throw CocoaError(.fileReadCorruptFile)
    }
    let tables = Self.tables(of: project, name: title)
    let media = mediaStats()

    var meta: [(String, String)] = []
    let recordCount = tables.reduce(0) { $0 + (($1["records"] as? [Any])?.count ?? 0) }
    meta.append(("Tables", "\(tables.count)"))
    meta.append(("Records", recordCount.formatted()))
    for (label, count) in media.counts where count > 0 { meta.append((label, count.formatted())) }
    meta.append(("Size", ByteCountFormatter.string(fromByteCount: media.bytes, countStyle: .file)))
    if let d = Self.date(project["createdAt"]) { meta.append(("Created", d)) }
    if let d = Self.date(project["updatedAt"]) { meta.append(("Modified", d)) }

    var body = "<dl class=meta>"
    for (k, v) in meta { body += "<div><dt>\(esc(k))</dt><dd>\(esc(v))</dd></div>" }
    body += "</dl>"
    for table in tables { body += tableSection(table, all: tables) }
    return page(title: title, body: body)
  }

  // Current documents have `tables`; older ones put one table's fields,
  // records and views directly on the project.
  static func tables(of project: [String: Any], name: String) -> [[String: Any]] {
    if let tables = project["tables"] as? [[String: Any]] { return tables }
    return [["name": name, "fields": project["fields"] ?? [], "records": project["records"] ?? []]]
  }

  func mediaStats() -> (counts: [(String, Int)], bytes: Int64) {
    let fm = FileManager.default
    var bytes: Int64 = 0
    if let e = fm.enumerator(at: url, includingPropertiesForKeys: [.fileSizeKey]) {
      for case let f as URL in e {
        bytes += Int64((try? f.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
      }
    }
    let counts = [("Images", "images"), ("Audio", "audio"), ("Videos", "video"), ("Attachments", "attachments")].map {
      ($0.0, (try? fm.contentsOfDirectory(atPath: url.appendingPathComponent($0.1).path))?
        .filter { !$0.hasPrefix(".") }.count ?? 0)
    }
    return (counts, bytes)
  }

  func tableSection(_ table: [String: Any], all: [[String: Any]]) -> String {
    let fields = (table["fields"] as? [[String: Any]]) ?? []
    let records = (table["records"] as? [[String: Any]]) ?? []
    let name = table["name"] as? String ?? "Untitled"

    var s = "<section><h2>\(esc(name))<span>\(records.count.formatted()) records · \(fields.count) fields</span></h2>"
    s += "<div class=fields>"
    for f in fields {
      s += "<span class=chip>\(esc(f["name"] as? String ?? ""))<small>\(esc(f["type"] as? String ?? ""))</small></span>"
    }
    s += "</div>"

    let shown = Array(fields.prefix(sampleColumns))
    guard !records.isEmpty, !shown.isEmpty else { return s + "</section>" }
    s += "<table><thead><tr>"
    for f in shown { s += "<th>\(esc(f["name"] as? String ?? ""))</th>" }
    s += "</tr></thead><tbody>"
    for r in records.prefix(sampleRows) {
      let values = r["values"] as? [String: Any] ?? [:]
      s += "<tr>"
      for f in shown { s += "<td>\(cell(values[f["id"] as? String ?? ""], field: f, record: r))</td>" }
      s += "</tr>"
    }
    s += "</tbody></table>"
    if records.count > sampleRows {
      s += "<p class=more>and \((records.count - sampleRows).formatted()) more…</p>"
    }
    return s + "</section>"
  }

  func cell(_ value: Any?, field: [String: Any], record: [String: Any]) -> String {
    let type = field["type"] as? String ?? ""
    let choices = ((field["options"] as? [String: Any])?["choices"] as? [[String: Any]]) ?? []
    func choice(_ id: Any?) -> String {
      guard let c = choices.first(where: { ($0["id"] as? String) == (id as? String) }) else { return "" }
      return "<span class=\"tag \(esc(c["color"] as? String ?? "gray"))\">\(esc(c["name"] as? String ?? ""))</span>"
    }
    switch type {
    case "createdTime": return esc(Self.date(record["createdAt"]) ?? "")
    case "lastModifiedTime": return esc(Self.date(record["updatedAt"] ?? record["createdAt"]) ?? "")
    case "select": return choice(value)
    case "multiSelect": return ((value as? [Any]) ?? []).map(choice).joined(separator: " ")
    case "checkbox": return (value as? Bool) == true ? "✓" : ""
    case "rating": return String(repeating: "★", count: max(0, min(5, (value as? Int) ?? 0)))
    case "number": return (value as? NSNumber).map { esc($0.stringValue) } ?? ""
    case "image": return value is String ? "<span class=media>Image</span>" : ""
    case "audio": return value is String ? "<span class=media>Audio</span>" : ""
    case "video":
      guard let v = value as? [String: Any] else { return "" }
      return "<span class=media>\(esc(v["name"] as? String ?? "Video"))</span>"
    case "attachment":
      return ((value as? [[String: Any]]) ?? []).map { "<span class=media>\(esc($0["name"] as? String ?? "File"))</span>" }.joined(separator: " ")
    case "relation":
      let n = (value as? [Any])?.count ?? 0
      return n == 0 ? "" : "<span class=media>\(n) linked</span>"
    default:
      return esc((value as? String) ?? "")
    }
  }

  static func date(_ value: Any?) -> String? {
    guard let s = value as? String else { return nil }
    let iso = ISO8601DateFormatter()
    iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let d = iso.date(from: s) ?? ISO8601DateFormatter().date(from: s) else { return nil }
    return d.formatted(date: .abbreviated, time: .shortened)
  }

  func page(title: String, body: String) -> String {
    """
    <!doctype html><html><head><meta charset="utf-8"><style>\(css)</style></head>
    <body><header><h1>\(esc(title))</h1><p>Crow Document</p></header>\(body)</body></html>
    """
  }
}

private func esc(_ s: String) -> String {
  s.replacingOccurrences(of: "&", with: "&amp;")
    .replacingOccurrences(of: "<", with: "&lt;")
    .replacingOccurrences(of: ">", with: "&gt;")
    .replacingOccurrences(of: "\"", with: "&quot;")
}

private let css = """
:root { color-scheme: light dark; --fg: #1d1d1f; --muted: #6e6e73; --line: #e5e5ea; --chip: #f2f2f7; --bg: #fff; }
@media (prefers-color-scheme: dark) { :root { --fg: #f5f5f7; --muted: #98989d; --line: #38383a; --chip: #2c2c2e; --bg: #1c1c1e; } }
* { box-sizing: border-box; }
body { margin: 0; padding: 28px 32px; font: 13px -apple-system, system-ui, sans-serif; color: var(--fg); background: var(--bg); }
header h1 { margin: 0; font-size: 22px; font-weight: 600; }
header p { margin: 2px 0 0; color: var(--muted); }
.meta { display: flex; flex-wrap: wrap; gap: 8px 28px; margin: 18px 0 8px; padding: 14px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.meta dt { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
.meta dd { margin: 2px 0 0; font-weight: 500; font-variant-numeric: tabular-nums; }
section { margin-top: 24px; }
h2 { font-size: 15px; font-weight: 600; margin: 0 0 8px; display: flex; align-items: baseline; gap: 10px; }
h2 span { font-size: 12px; font-weight: 400; color: var(--muted); }
.fields { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.chip { background: var(--chip); border-radius: 6px; padding: 3px 8px; }
.chip small { color: var(--muted); margin-left: 6px; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
th { color: var(--muted); font-weight: 500; font-size: 12px; }
.more, .note { color: var(--muted); margin: 8px 0 0; }
.media { color: var(--muted); }
.tag { display: inline-block; border-radius: 4px; padding: 1px 6px; font-size: 12px; background: var(--chip); }
.red { background: #ff3b3026; } .orange { background: #ff950026; } .amber { background: #ffcc0033; }
.green { background: #34c75926; } .teal { background: #30b0c726; } .blue { background: #007aff26; }
.indigo { background: #5856d626; } .purple { background: #af52de26; } .pink { background: #ff2d5526; }
"""
