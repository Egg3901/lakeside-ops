import SwiftUI
import Charts
import LakesideCore

struct PulseView: View {
    @EnvironmentObject private var session: AppSession
    @EnvironmentObject private var ops: OpsStore
    @Binding var tab: OpsTab

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                headline
                if !attention.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        SectionLabel(text: "Needs you", count: attention.count)
                        ForEach(attention) { item in
                            Button { tab = item.tab } label: { WorkRow(title: item.title, meta: item.meta, bar: OpsTheme.warn) { Image(systemName: "chevron.right").font(.caption).foregroundStyle(OpsTheme.muted) } }
                                .buttonStyle(.plain)
                            Hairline()
                        }
                    }
                }
                keirSummary
                ServicesPanel(services: ops.services)
                KeirActivityChart(buckets: ops.hub["activity"].array)
                HostPanel(host: ops.host)
                if !ops.alerts.isEmpty { AlertsPanel(alerts: Array(ops.alerts.prefix(6))) }
                if let updated = ops.updated {
                    Text("Updated \(updated.formatted(date: .omitted, time: .shortened))").font(.caption).foregroundStyle(OpsTheme.muted).frame(maxWidth: .infinity)
                }
            }.padding(16)
        }
        .refreshable { await ops.refresh(session) }
        .opsScreen()
        .navigationTitle("Pulse")
    }

    private var headline: some View {
        VStack(alignment: .leading, spacing: 6) {
            let down = ops.servicesDown.count
            Text(attention.isEmpty ? "All quiet." : attention.count == 1 ? "One thing needs you." : "\(attention.count) things need you.")
                .font(.system(size: 30, weight: .bold, design: .rounded)).tracking(-0.8)
            Text(down > 0 ? "\(down) service\(down == 1 ? "" : "s") degraded. Keir is \(keirLine)." : "Every service is up. Keir is \(keirLine).")
                .font(.callout).foregroundStyle(OpsTheme.muted)
            if let error = ops.error { Text(error).font(.caption).foregroundStyle(OpsTheme.warn) }
        }
    }

    private var keirLine: String {
        if ops.hub["paused"].bool { return "paused" }
        let running = Int(ops.kpis["running"].number ?? 0)
        return running > 0 ? "running \(running) task\(running == 1 ? "" : "s")" : "idle"
    }

    private var keirSummary: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionLabel(text: "Keir")
            HStack(spacing: 12) {
                Figure(value: "\(Int(ops.kpis["openTickets"].number ?? 0))", label: "Open tickets")
                Figure(value: "\(Int(ops.kpis["live"].number ?? 0))", label: "Live tasks", tone: OpsTheme.mint)
                Figure(value: "\(Int(ops.kpis["prsOpen"].number ?? 0))", label: ops.redPRs > 0 ? "PRs, \(ops.redPRs) red" : "Open PRs", tone: ops.redPRs > 0 ? OpsTheme.warn : OpsTheme.ink)
                Figure(value: OpsFormat.percent(ops.kpis["successRate24h"].number), label: "Success 24h")
            }
        }
    }

    struct Attention: Identifiable { let id: String; let title: String; let meta: String; let tab: OpsTab }
    private var attention: [Attention] {
        var rows: [Attention] = ops.decisions.map { Attention(id: "d" + $0["id"].string, title: $0["tldr"].string.nonempty ?? $0["question"].string, meta: "Keir decision · \(OpsFormat.ago($0["at"]))", tab: .keir) }
        rows += ops.servicesDown.map { Attention(id: "s" + $0["id"].string, title: "\($0["name"].string) is \($0["current"].string)", meta: "Service · checked \(OpsFormat.ago($0["lastChecked"]))", tab: .pulse) }
        if ops.redPRs > 0 { rows.append(Attention(id: "prs", title: "\(ops.redPRs) Keir PR\(ops.redPRs == 1 ? "" : "s") failing checks", meta: "Desk", tab: .desk)) }
        rows += ops.blocked.prefix(3).map { Attention(id: "k" + $0["id"].string, title: $0["title"].string, meta: "Blocked · \($0["product"].string)", tab: .work) }
        return rows
    }
}

private struct ServicesPanel: View {
    let services: [JSONValue]
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(text: "Services", count: services.count)
            ForEach(services, id: \.["id"].string) { service in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Circle().fill(service["current"].string == "operational" ? OpsTheme.mint : OpsTheme.warn).frame(width: 7, height: 7)
                        Text(service["name"].string).font(.callout.weight(.semibold)).lineLimit(1)
                        Spacer()
                        if let ms = service["latencyMs"].number { Text("\(Int(ms)) ms").font(.caption).foregroundStyle(OpsTheme.muted).monospacedDigit() }
                        Text(String(format: "%.2f%%", service["uptime7d"].number ?? 0)).font(.caption.weight(.medium)).monospacedDigit()
                    }
                    UptimeStrip(days: Array(service["history"].array.suffix(30)))
                }.padding(.vertical, 4).accessibilityElement(children: .combine)
            }
        }
    }
}

/// One bar per day: full mint at 100%, warn below 99%, danger below 95%.
private struct UptimeStrip: View {
    let days: [JSONValue]
    var body: some View {
        HStack(spacing: 2) {
            ForEach(Array(days.enumerated()), id: \.offset) { _, day in
                let pct = day["pct"].number ?? 100
                RoundedRectangle(cornerRadius: 1.5).fill(pct >= 99.5 ? OpsTheme.mint.opacity(0.75) : pct >= 95 ? OpsTheme.warn : OpsTheme.danger)
                    .frame(maxWidth: .infinity).frame(height: 14)
            }
        }.accessibilityHidden(true)
    }
}

private struct KeirActivityChart: View {
    let buckets: [JSONValue]
    private struct Point: Identifiable { let id = UUID(); let at: Date; let provider: String; let count: Double }
    private var points: [Point] {
        buckets.suffix(24).flatMap { b -> [Point] in
            let at = OpsFormat.date(b["at"]) ?? Date()
            return ["claude", "codex", "muse", "agy", "other"].compactMap { p in
                guard let n = b[p].number, n > 0 else { return nil }
                return Point(at: at, provider: p == "agy" ? "Gemini" : p.capitalized, count: n)
            }
        }
    }
    var body: some View {
        if !points.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                SectionLabel(text: "Keir activations, 24h")
                Chart(points) { p in
                    BarMark(x: .value("Hour", p.at, unit: .hour), y: .value("Activations", p.count)).foregroundStyle(by: .value("Model", p.provider))
                }
                .chartForegroundStyleScale(["Claude": OpsTheme.sky, "Codex": OpsTheme.mint, "Muse": OpsTheme.warn, "Gemini": OpsTheme.muted, "Other": OpsTheme.hairline])
                .chartLegend(position: .bottom, alignment: .leading)
                .chartXAxis { AxisMarks(values: .stride(by: .hour, count: 6)) { AxisValueLabel(format: .dateTime.hour()) } }
                .frame(height: 150)
            }
        }
    }
}

private struct HostPanel: View {
    let host: JSONValue
    var body: some View {
        if host != .null {
            VStack(alignment: .leading, spacing: 10) {
                SectionLabel(text: "Box")
                Gauge(label: "CPU", value: (host["cpuUsedPct"].number ?? 0) / 100)
                Gauge(label: "Memory", value: (host["memory"]["usedPct"].number ?? 0) / 100)
                Gauge(label: "Disk", value: (host["disk"]["usedPct"].number ?? 0) / 100)
                Text("Load \(host["load"].array.prefix(3).map { String(format: "%.1f", $0.number ?? 0) }.joined(separator: " · ")) · checks \(Int(host["checks"]["running"].number ?? 0)) running, \(Int(host["checks"]["queued"].number ?? 0)) queued")
                    .font(.caption).foregroundStyle(OpsTheme.muted).monospacedDigit()
            }
        }
    }
    private struct Gauge: View {
        let label: String
        let value: Double
        var body: some View {
            HStack(spacing: 10) {
                Text(label).font(.caption).foregroundStyle(OpsTheme.muted).frame(width: 56, alignment: .leading)
                GeometryReader { g in
                    ZStack(alignment: .leading) {
                        Capsule().fill(OpsTheme.raised)
                        Capsule().fill(value > 0.85 ? OpsTheme.warn : OpsTheme.sky).frame(width: max(4, g.size.width * min(1, value)))
                    }
                }.frame(height: 6)
                Text(OpsFormat.percent(value)).font(.caption.weight(.medium)).monospacedDigit().frame(width: 40, alignment: .trailing)
            }.accessibilityElement(children: .combine)
        }
    }
}

private struct AlertsPanel: View {
    let alerts: [JSONValue]
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            SectionLabel(text: "Recent alerts")
            ForEach(alerts, id: \.["key"].string) { alert in
                WorkRow(title: alert["text"].string, meta: "\(alert["kind"].string.capitalized) · \(OpsFormat.ago(alert["at"]))", bar: alert["kind"].string == "incident" ? OpsTheme.warn : nil)
                Hairline()
            }
        }
    }
}
