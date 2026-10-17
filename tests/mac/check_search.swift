import PDFKit
import Foundation

let document = PDFDocument(url: URL(fileURLWithPath: CommandLine.arguments[1]))!
let text = CommandLine.arguments[2]
let index = Int(CommandLine.arguments[3])!
let page = document.page(at: index)!
let matches = document.findString(text, withOptions: .caseInsensitive)
let selection = matches.first { $0.pages.contains(where: { document.index(for: $0) == index }) }!
let bounds = selection.bounds(for: page)
assert(!bounds.isEmpty && bounds.intersects(page.bounds(for: .mediaBox)))
assert(selection.string?.localizedCaseInsensitiveContains(text) == true)
print("PASS: PDFKit search and selectable/copyable text", text, "page", index + 1, "bounds", bounds)
