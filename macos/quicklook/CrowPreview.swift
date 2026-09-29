// The summary of a .crow document both Quick Look extensions show: its
// counts, size and dates, then each table's fields and first few records.
// The preview renders it as interactive HTML (below); the thumbnail draws the
// same layout natively, since WebKit can't run in a thumbnail extension.
import Foundation

struct CrowPreview {
  /// The page's size in the preview window, and the area the thumbnail shows.
  static let pageSize = CGSize(width: 820, height: 640)
  static let sampleRows = 8
  static let sampleColumns = 6
  /// The preview scrolls, so it shows every field and more records.
  static let previewRows = 200

  enum Cell {
    case text(String)
    /// Stand-ins for values that aren't text: media, links, file names.
    case muted(String)
    /// Select choices, as (name, color).
    case tags([(String, String)])
  }

  struct Table {
    var name: String
    var recordCount: Int
    var fields: [(name: String, type: String)]
    var columns: [String]
    var rows: [[Cell]]
  }

  let title: String
  /// nil for a pre-3.0 single-file document.
  let meta: [(String, String)]?
  let tables: [Table]

  init(url: URL, rows: Int = sampleRows, columns: Int = sampleColumns) throws {
    let doc = try CrowDocument(url: url)
    title = doc.title
    guard let project = doc.project else {
      meta = nil
      tables = []
      return
    }
    var meta: [(String, String)] = []
    meta.append(("Tables", "\(doc.tables.count)"))
    meta.append(("Records", doc.recordCount.formatted()))
    for (label, count) in doc.mediaCounts() where count > 0 { meta.append((label, count.formatted())) }
    meta.append(("Size", ByteCountFormatter.string(fromByteCount: doc.totalBytes(), countStyle: .file)))
    if let d = Self.date(project["createdAt"]) { meta.append(("Created", d)) }
    if let d = Self.date(project["updatedAt"]) { meta.append(("Modified", d)) }
    self.meta = meta
    tables = doc.tables.map { Self.table($0, rows: rows, columns: columns) }
  }

  static func table(_ table: [String: Any], rows: Int, columns: Int) -> Table {
    let fields = (table["fields"] as? [[String: Any]]) ?? []
    let records = (table["records"] as? [[String: Any]]) ?? []
    let shown = fields.prefix(columns)
    return Table(
      name: table["name"] as? String ?? "Untitled",
      recordCount: records.count,
      fields: fields.map { ($0["name"] as? String ?? "", $0["type"] as? String ?? "") },
      columns: shown.map { $0["name"] as? String ?? "" },
      rows: records.prefix(rows).map { r in
        let values = r["values"] as? [String: Any] ?? [:]
        return shown.map { cell(values[$0["id"] as? String ?? ""], field: $0, record: r) }
      }
    )
  }

  static func cell(_ value: Any?, field: [String: Any], record: [String: Any]) -> Cell {
    let type = field["type"] as? String ?? ""
    let choices = ((field["options"] as? [String: Any])?["choices"] as? [[String: Any]]) ?? []
    func choice(_ id: Any?) -> (String, String)? {
      guard let c = choices.first(where: { ($0["id"] as? String) == (id as? String) }) else { return nil }
      return (c["name"] as? String ?? "", c["color"] as? String ?? "gray")
    }
    switch type {
    case "createdTime": return .text(date(record["createdAt"]) ?? "")
    case "lastModifiedTime": return .text(date(record["updatedAt"] ?? record["createdAt"]) ?? "")
    case "select": return .tags(choice(value).map { [$0] } ?? [])
    case "multiSelect": return .tags(((value as? [Any]) ?? []).compactMap(choice))
    case "checkbox": return .text((value as? Bool) == true ? "✓" : "")
    case "rating": return .text(String(repeating: "★", count: max(0, min(5, (value as? Int) ?? 0))))
    case "number": return .text((value as? NSNumber)?.stringValue ?? "")
    case "image": return .muted(value is String ? "Image" : "")
    case "audio": return .muted(value is String ? "Audio" : "")
    case "video":
      guard let v = value as? [String: Any] else { return .text("") }
      return .muted(v["name"] as? String ?? "Video")
    case "attachment":
      return .muted(((value as? [[String: Any]]) ?? []).map { $0["name"] as? String ?? "File" }.joined(separator: ", "))
    case "relation":
      let n = (value as? [Any])?.count ?? 0
      return .muted(n == 0 ? "" : "\(n) linked")
    default:
      return .text((value as? String) ?? "")
    }
  }

  static func date(_ value: Any?) -> String? {
    guard let s = value as? String else { return nil }
    let iso = ISO8601DateFormatter()
    iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let d = iso.date(from: s) ?? ISO8601DateFormatter().date(from: s) else { return nil }
    return d.formatted(date: .abbreviated, time: .shortened)
  }

  static let legacyNote = "This is an older single-file Crow document. Open it in Crow to convert it."

  // MARK: HTML

  func html() -> String {
    var body = ""
    if let meta {
      body += "<dl class=meta>"
      for (k, v) in meta { body += "<div><dt>\(esc(k))</dt><dd>\(esc(v))</dd></div>" }
      body += "</dl>"
    } else {
      body += "<p class=note>\(esc(Self.legacyNote))</p>"
    }
    if tables.contains(where: { !$0.rows.isEmpty }) {
      body += "<input id=filter type=search placeholder=\"Filter records\" autocomplete=off>"
    }
    for t in tables {
      body += "<details open><summary><h2>\(esc(t.name))<span>\(t.recordCount.formatted()) records · \(t.fields.count) fields</span></h2></summary>"
      body += "<div class=fields>"
      for f in t.fields { body += "<span class=chip>\(esc(f.name))<small>\(esc(f.type))</small></span>" }
      body += "</div>"
      if !t.rows.isEmpty, !t.columns.isEmpty {
        body += "<div class=scroll><table><thead><tr>" + t.columns.map { "<th>\(esc($0))</th>" }.joined() + "</tr></thead><tbody>"
        for row in t.rows { body += "<tr>" + row.map { "<td>\(html($0))</td>" }.joined() + "</tr>" }
        body += "</tbody></table></div><p class=\"more none\" hidden>No matching records.</p>"
      }
      if t.recordCount > t.rows.count {
        body += "<p class=more>and \((t.recordCount - t.rows.count).formatted()) more…</p>"
      }
      body += "</details>"
    }
    return """
    <!doctype html><html><head><meta charset="utf-8"><style>\(css)</style></head>
    <body><header><h1>\(esc(title))</h1><p>Crow Document</p></header>\(body)<script>\(script)</script></body></html>
    """
  }

  private func html(_ cell: Cell) -> String {
    switch cell {
    case .text(let s): return esc(s)
    case .muted(let s): return "<span class=media>\(esc(s))</span>"
    case .tags(let tags): return tags.map { "<span class=\"tag \(esc($0.1))\">\(esc($0.0))</span>" }.joined(separator: " ")
    }
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
#filter { width: 100%; margin: 16px 0 0; padding: 6px 10px; font: inherit; color: var(--fg); background: var(--chip); border: 1px solid var(--line); border-radius: 7px; outline: none; }
#filter:focus { border-color: #007aff; }
details { margin-top: 24px; }
summary { list-style: none; cursor: default; }
summary::-webkit-details-marker { display: none; }
summary h2::before { content: "›"; display: inline-block; width: 10px; color: var(--muted); transition: transform .15s; }
details[open] summary h2::before { transform: rotate(90deg); }
h2 { font-size: 15px; font-weight: 600; margin: 0 0 8px; display: flex; align-items: baseline; gap: 10px; }
h2 span { font-size: 12px; font-weight: 400; color: var(--muted); }
.fields { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.chip { background: var(--chip); border-radius: 6px; padding: 3px 8px; }
.chip small { color: var(--muted); margin-left: 6px; }
.scroll { overflow: auto; max-height: 420px; }
table { min-width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 240px; }
th { color: var(--muted); font-weight: 500; font-size: 12px; position: sticky; top: 0; background: var(--bg); }
tbody tr:hover { background: var(--chip); }
.more, .note { color: var(--muted); margin: 8px 0 0; }
.media { color: var(--muted); }
.tag { display: inline-block; border-radius: 4px; padding: 1px 6px; font-size: 12px; background: var(--chip); }
.red { background: #ff3b3026; } .orange { background: #ff950026; } .amber { background: #ffcc0033; }
.green { background: #34c75926; } .teal { background: #30b0c726; } .blue { background: #007aff26; }
.indigo { background: #5856d626; } .purple { background: #af52de26; } .pink { background: #ff2d5526; }
"""

// Filters every table's rows by the search box.
private let script = """
const filter = document.getElementById('filter');
filter?.addEventListener('input', () => {
  const q = filter.value.trim().toLowerCase();
  for (const table of document.querySelectorAll('table')) {
    let shown = 0;
    for (const row of table.tBodies[0].rows) {
      const match = !q || row.textContent.toLowerCase().includes(q);
      row.hidden = !match;
      if (match) shown++;
    }
    table.parentElement.nextElementSibling.hidden = shown > 0;
  }
});
"""
