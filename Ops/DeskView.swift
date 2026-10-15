import SwiftUI
import LakesideCore

/// Keir's support desk: the tickets it holds and the workers doing the work.
struct DeskView: View {
    @EnvironmentObject private var session: AppSession
    @EnvironmentObject private var ops: OpsStore

    private var tickets: [JSONValue] { ops.hub["tickets"].array.filter { $0["status"].string != "closed" } }
    private var workers: [JSONValue] { ops.hub["workers"].array }
    private var recent: [JSONValue] { Array(ops.hub["recent"].array.prefix(8)) }

    var body: some View {
        List {
            Section {
                if tickets.isEmpty { Text("No open tickets.").foregroundStyle(OpsTheme.muted) }
                ForEach(tickets, id: \.["number"].string) { ticket in
                    NavigationLink { TicketDetail(ticket: ticket) } label: {
                        WorkRow(title: ticket["title"].string, meta: ticketMeta(ticket), bar: ticket["decisionPending"].bool ? OpsTheme.warn : ticket["active"]["state"].string == "running" ? OpsTheme.mint : nil)
                    }
                }
            } header: { SectionLabel(text: "Tickets", count: tickets.count) }
            Section {
                if workers.isEmpty { Text("No live workers.").foregroundStyle(OpsTheme.muted) }
                ForEach(workers, id: \.["id"].string) { worker in
                    NavigationLink { WorkerDetail(worker: worker) } label: {
                        WorkRow(title: workerTitle(worker), meta: "\(worker["runner"].string) · \(worker["model"].string)\(worker["effort"].string.isEmpty ? "" : " @\(worker["effort"].string)") · \(OpsFormat.ago(worker["updatedAt"]))", bar: OpsState.color(worker["state"].string)) {
                            StateWord(text: OpsState.word(worker["state"].string), color: OpsState.color(worker["state"].string))
                        }
                    }
                }
            } header: { SectionLabel(text: "Workers", count: workers.count) }
            Section {
                ForEach(recent, id: \.["id"].string) { job in
                    NavigationLink { WorkerDetail(worker: job) } label: { WorkRow(title: workerTitle(job), meta: "\(OpsState.word(job["state"].string)) · \(job["model"].string) · \(OpsFormat.ago(job["updatedAt"]))") }
                }
            } header: { SectionLabel(text: "Recently finished") }
        }
        .listStyle(.plain)
        .refreshable { await ops.refresh(session) }
        .opsScreen()
        .navigationTitle("Desk")
    }

    private func ticketMeta(_ t: JSONValue) -> String {
        var parts = ["#\(t["number"].string)", t["category"].string.capitalized]
        if !t["prs"].array.isEmpty { parts.append("PR " + t["prs"].array.map { "#\($0.string)" }.joined(separator: ", ")) }
        parts.append(OpsFormat.ago(t["createdAt"]))
        return parts.filter { !$0.isEmpty }.joined(separator: " · ")
    }
    private func workerTitle(_ w: JSONValue) -> String {
        let ticket = w["ticket"].number.map { "Ticket \(Int($0))" }
        let kind = w["kind"].string == "command" ? "Owner task" : w["kind"].string.capitalized
        return [ticket ?? kind, w["role"].string == "owner" && ticket != nil ? "owner" : nil].compactMap { $0 }.joined(separator: " · ")
    }
}

private struct TicketDetail: View {
    let ticket: JSONValue
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(ticket["title"].string).font(.title2.weight(.semibold)).tracking(-0.4)
                    Text("Ticket #\(ticket["number"].string) · \(ticket["category"].string.capitalized) · opened \(OpsFormat.ago(ticket["createdAt"]))").font(.caption).foregroundStyle(OpsTheme.muted)
                }
                if !ticket["card"]["status"].string.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        SectionLabel(text: "Where it stands")
                        Text(ticket["card"]["status"].string).font(.body)
                    }
                }
                let items = ticket["card"]["items"].array
                if !items.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        SectionLabel(text: "Fixes")
                        ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                            WorkRow(title: item["name"].string, meta: item["note"].string, bar: item["blocked"].bool ? OpsTheme.warn : nil) { StageChip(stage: item["stage"].string) }
                            Hairline()
                        }
                    }
                }
                if !ticket["prs"].array.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        SectionLabel(text: "Pull requests")
                        ForEach(ticket["prs"].array, id: \.string) { pr in
                            if let url = URL(string: "https://github.com/Egg3901/AHDGame/pull/\(pr.string)") { Link("#\(pr.string)", destination: url).font(.callout.weight(.semibold)) }
                        }
                    }
                }
            }.padding(16).frame(maxWidth: .infinity, alignment: .leading)
        }.opsScreen().navigationTitle("#\(ticket["number"].string)").navigationBarTitleDisplayMode(.inline)
    }
}

/// The release pipeline as Keir reports it to players.
struct StageChip: View {
    let stage: String
    var body: some View {
        let (label, color): (String, Color) = switch stage {
        case "main": ("Live", OpsTheme.mint)
        case "sandbox", "staging": ("Sandbox", OpsTheme.sky)
        case "dev", "development": ("Dev", OpsTheme.sky)
        case "built", "pr": ("Built", OpsTheme.muted)
        default: (stage.capitalized, OpsTheme.muted)
        }
        Text(label).font(.caption.weight(.semibold)).foregroundStyle(color)
            .padding(.horizontal, 7).padding(.vertical, 3).overlay(Capsule().strokeBorder(color.opacity(0.5)))
    }
}

private struct WorkerDetail: View {
    let worker: JSONValue
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack { StateWord(text: OpsState.word(worker["state"].string), color: OpsState.color(worker["state"].string)); Spacer(); Text(OpsFormat.ago(worker["updatedAt"])).font(.caption).foregroundStyle(OpsTheme.muted) }
                Text(worker["summary"].string.nonempty ?? "No summary yet.").font(.body).textSelection(.enabled)
                VStack(alignment: .leading, spacing: 6) {
                    SectionLabel(text: "Run")
                    row("Model", "\(worker["runner"].string) · \(worker["model"].string)")
                    row("Effort", worker["effort"].string)
                    row("Rounds", worker["rounds"].string)
                    row("Engine", worker["via"].string)
                    if worker["wakeAt"].number != nil { row("Wakes", OpsFormat.ago(worker["wakeAt"])) }
                }
            }.padding(16).frame(maxWidth: .infinity, alignment: .leading)
        }.opsScreen().navigationTitle(worker["ticket"].number.map { "Ticket \(Int($0))" } ?? "Task").navigationBarTitleDisplayMode(.inline)
    }
    private func row(_ k: String, _ v: String) -> some View {
        HStack { Text(k).foregroundStyle(OpsTheme.muted); Spacer(); Text(v.nonempty ?? "-").monospacedDigit() }.font(.callout)
    }
}
