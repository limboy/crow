// Reads a .crow package (see docs/crow-format.md) for the Quick Look
// extensions. Compiled into both the preview and the thumbnail extension.
import Foundation

struct CrowDocument {
  let url: URL
  /// nil for a pre-3.0 single-file document, which the app converts on open.
  let project: [String: Any]?

  init(url: URL) throws {
    self.url = url
    var isDir: ObjCBool = false
    FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir)
    guard isDir.boolValue else {
      project = nil
      return
    }
    let data = try Data(contentsOf: url.appendingPathComponent("data.json"))
    guard let project = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      throw CocoaError(.fileReadCorruptFile)
    }
    self.project = project
  }

  var title: String { url.deletingPathExtension().lastPathComponent }

  // Current documents have `tables`; older ones put one table's fields,
  // records and views directly on the project.
  var tables: [[String: Any]] {
    guard let project else { return [] }
    if let tables = project["tables"] as? [[String: Any]] { return tables }
    return [["name": title, "fields": project["fields"] ?? [], "records": project["records"] ?? []]]
  }

  var recordCount: Int {
    tables.reduce(0) { $0 + (($1["records"] as? [Any])?.count ?? 0) }
  }

  /// Files in each media folder, labelled for display.
  func mediaCounts() -> [(label: String, count: Int)] {
    [("Images", "images"), ("Audio", "audio"), ("Videos", "video"), ("Attachments", "attachments")].map {
      ($0.0, (try? FileManager.default.contentsOfDirectory(atPath: url.appendingPathComponent($0.1).path))?
        .filter { !$0.hasPrefix(".") }.count ?? 0)
    }
  }

  func totalBytes() -> Int64 {
    var bytes: Int64 = 0
    if let e = FileManager.default.enumerator(at: url, includingPropertiesForKeys: [.fileSizeKey]) {
      for case let f as URL in e {
        bytes += Int64((try? f.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
      }
    }
    return bytes
  }
}
