// Quick Look preview for .crow documents: the HTML summary from
// CrowPreview.swift in a live web view. It's a view-based preview (not
// data-based) so Finder's preview pane hosts it too, and it stays
// interactive there — tables collapse, scroll sideways and filter.
import Cocoa
import QuickLookUI
import WebKit

final class PreviewViewController: NSViewController, QLPreviewingController {
  private var webView: WKWebView!

  override func loadView() {
    webView = WKWebView(frame: NSRect(origin: .zero, size: CrowPreview.pageSize))
    webView.setValue(false, forKey: "drawsBackground")
    view = webView
    preferredContentSize = CrowPreview.pageSize
  }

  func preparePreviewOfFile(at url: URL, completionHandler handler: @escaping (Error?) -> Void) {
    do {
      let preview = try CrowPreview(url: url, rows: CrowPreview.previewRows, columns: .max)
      webView.loadHTMLString(preview.html(), baseURL: nil)
      handler(nil)
    } catch {
      handler(error)
    }
  }
}
