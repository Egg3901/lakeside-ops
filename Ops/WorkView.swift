import SwiftUI
import LakesideCore

/// The product kanban, live lanes only: needs you, in progress, blocked, next.
struct WorkView: View {
    @EnvironmentObject private var session: AppSession
    @EnvironmentObject private var ops: OpsStore
    @State private var lane: Lane = .now
    @State private var product = "all"

    enum Lane: String, CaseIterable, Identifiable {
        case needs = "needs_owner", now, blocked, next
        var id: String { rawValue }
        var title: String { self == .needs ? "Needs you" : self == .now ? "In progress" : self == .blocked ? "Blocked" : "Next" }
    }

    private var products: [String] { Array(Set(Lane.allCases.flatMap { ops.kanban[$0.rawValue].array.map { $0["product"].string } })).filter { !$0.isEmpty }.sorted() }
    private var items: [JSONValue] { ops.kanban[lane.rawValue].array.filter { product == "all" || $0["product"].string == product } }
    private func count(_ lane: Lane) -> Int { Int(ops.kanban["counts"][lane.rawValue].number ?? Double(ops.kanban[lane.rawValue].array.count)) }

    var body: some View {
        List {
            Section {
                ForEach(items, id: \.["id"].string) { item in
                    NavigationLink { WorkItemDetail(item: item) } label: {
                        WorkRow(title: item["title"].string, meta: meta(item), bar: lane == .blocked || item["needs_owner"].bool ? OpsTheme.warn : item["stale"].bool ? OpsTheme.muted : lane == .now ? OpsTheme.mint : nil)
                    }
                }
                if items.isEmpty { Text(lane == .needs ? "Nothing waiting on you." : "Nothing here.").foregroundStyle(OpsTheme.muted) }
            } header: {
                Picker("Lane", selection: $lane) { ForEach(Lane.allCases) { Text("\($0.title) \(count($0))").tag($0) } }
                    .pickerStyle(.segmented).textCase(nil).padding(.bottom, 6)
            }
        }
        .listStyle(.plain)
        .refreshable { await ops.refresh(session) }
        .opsScreen()
        .navigationTitle("Work")
        .toolbar {
            Menu {
                Picker("Product", selection: $product) {
                    Text("All products").tag("all")
                    ForEach(products, id: \.self) { Text($0).tag($0) }
                }
            } label: { Image(systemName: product == "all" ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill") }
                .accessibilityLabel("Filter by product")
        }
    }

    private func meta(_ item: JSONValue) -> String {
        [item["assigned_to"].string.nonempty ?? "Unassigned", item["product"].string, item["impact"].string == "high" ? "High impact" : "", OpsFormat.ago(item["last_progress_at"].string.isEmpty ? item["updated_at"] : item["last_progress_at"])]
            .filter { !$0.isEmpty }.joined(separator: " · ")
    }
}

private struct WorkItemDetail: View {
    let item: JSONValue
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(item["title"].string).font(.title2.weight(.semibold)).tracking(-0.4)
                    Text([item["lane"].string.capitalized, item["kind"].string, item["product"].string, item["assigned_to"].string.nonempty ?? "Unassigned"].filter { !$0.isEmpty }.joined(separator: " · "))
                        .font(.caption).foregroundStyle(OpsTheme.muted)
                }
                if !item["progress_summary"].string.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        SectionLabel(text: "Latest progress")
                        Text(item["progress_summary"].string).font(.body).textSelection(.enabled)
                        Text(OpsFormat.ago(item["last_progress_at"])).font(.caption).foregroundStyle(OpsTheme.muted)
                    }
                }
                if !item["stale_reason"].string.isEmpty {
                    Label(item["stale_reason"].string, systemImage: "clock.badge.exclamationmark").font(.callout).foregroundStyle(OpsTheme.warn)
                }
                if !item["detail"].string.isEmpty {
                    VStack(alignment: .leading, spacing: 8) { SectionLabel(text: "Detail"); Text(item["detail"].string).font(.callout).foregroundStyle(OpsTheme.muted).textSelection(.enabled) }
                }
                HStack(spacing: 16) {
                    if let url = Endpoint.link(item["evidence_url"].string, base: URL(string: "https://github.com")!) { Link("Evidence", destination: url) }
                    if let gh = githubURL { Link("Issue", destination: gh) }
                }.font(.callout.weight(.semibold))
            }.padding(16).frame(maxWidth: .infinity, alignment: .leading)
        }.opsScreen().navigationTitle("").navigationBarTitleDisplayMode(.inline)
    }
    private var githubURL: URL? {
        let ref = item["github"].string
        guard let hash = ref.firstIndex(of: "#") else { return Endpoint.link(ref, base: URL(string: "https://github.com")!) }
        return URL(string: "https://github.com/\(ref[..<hash])/issues/\(ref[ref.index(after: hash)...])")
    }
}
