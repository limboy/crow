// Quick Look preview for .crow documents (space bar in Finder): the HTML
// summary from CrowPreview.swift.
import Foundation
import QuickLookUI
import UniformTypeIdentifiers

final class PreviewProvider: QLPreviewProvider, QLPreviewingController {
  func providePreview(for request: QLFilePreviewRequest) async throws -> QLPreviewReply {
    let html = try CrowPreview(url: request.fileURL).html()
    return QLPreviewReply(dataOfContentType: .html, contentSize: CrowPreview.pageSize) { reply in
      reply.stringEncoding = .utf8
      return Data(html.utf8)
    }
  }
}
