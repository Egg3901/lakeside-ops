import SwiftUI
import LakesideCore

struct UsageRing: View {
    let fraction: Double?
    var color: Color = Brand.sky
    var size: CGFloat = 32
    var body: some View {
        ZStack {
            Circle().stroke(Brand.raised, lineWidth: 4)
            if let fraction {
                Circle().trim(from: 0, to: min(1, max(0, fraction)))
                    .stroke(color, style: StrokeStyle(lineWidth: 4, lineCap: .round)).rotationEffect(.degrees(-90))
            } else { Text("?").font(.caption.bold()).foregroundStyle(.secondary) }
        }.frame(width: size, height: size).accessibilityHidden(true)
    }
}

struct UsageButton: View {
    @EnvironmentObject private var session: AppSession
    @State private var expanded = false
    var body: some View {
        let usage = session.profile["usage"]
        let allowance = Allowance(limit: usage["limit"].number, remaining: usage["remaining"].number)
        Button { expanded = true } label: {
            HStack(spacing: 8) {
                UsageRing(fraction: allowance.fractionRemaining, color: allowance.low ? .orange : Brand.sky, size: 24)
                Text(allowance.remaining.map { $0.formatted() } ?? "Usage").font(.caption.bold().monospacedDigit())
            }.padding(.vertical, 6)
        }.accessibilityLabel("Daily allowance").accessibilityValue(allowance.remaining.map { "\($0.formatted()) credits left" } ?? "Unavailable")
        .sheet(isPresented: $expanded) {
            NavigationStack {
                ScrollView { UsagePanel(usage: session.profile["usage"]).padding() }.lakesideScreen()
                    .navigationTitle("Daily allowance").navigationBarTitleDisplayMode(.inline)
                    .toolbar { Button("Done") { expanded = false } }
                    .task { await session.refreshProfile() }
            }.presentationDetents([.medium, .large])
        }
    }
}

struct UsagePanel: View {
    let usage: JSONValue
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack {
                Label("Today's allowance", systemImage: "chart.pie").font(.headline)
                Spacer()
                if !usage["tier"].string.isEmpty { Text(usage["tier"].string).font(.caption.bold()).foregroundStyle(Brand.sky) }
            }
            if usage.object.isEmpty {
                Text("Usage is unavailable. Pull to refresh your account.").font(.callout).foregroundStyle(.secondary)
            } else {
                allowanceRow("Question credits", symbol: "bubble.left", limit: "limit", remaining: "remaining", color: Brand.sky)
                allowanceRow("Live data", symbol: "bolt", limit: "mcpLimit", remaining: "mcpRemaining", color: Brand.mint)
                allowanceRow("Charts and maps", symbol: "chart.xyaxis.line", limit: "vizLimit", remaining: "vizRemaining", color: .purple)
                if let reset = usage["resetAt"].number {
                    Text("Resets \(Date(timeIntervalSince1970: reset / 1000).formatted(date: .abbreviated, time: .shortened))")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Text("Bars show what you have left. Follow-ups can use fractional credits.").font(.caption2).foregroundStyle(.secondary)
            }
        }.brandCard().accessibilityIdentifier("usage-panel")
    }
    private func allowanceRow(_ title: String, symbol: String, limit: String, remaining: String, color: Color) -> some View {
        let allowance = Allowance(limit: usage[limit].number, remaining: usage[remaining].number)
        let detail = allowance.limit == 0 ? "Not included" : allowance.remaining.map { "\($0.formatted()) left" } ?? "Unavailable"
        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label(title, systemImage: symbol).font(.subheadline)
                Spacer()
                Text(detail).font(.subheadline.bold().monospacedDigit())
            }
            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    Capsule().fill(Brand.raised)
                    Capsule().fill(allowance.low ? Color.orange : color)
                        .frame(width: geometry.size.width * (allowance.fractionRemaining ?? 0))
                }
            }.frame(height: 6).accessibilityHidden(true)
            if let total = allowance.limit, total > 0 { Text("of \(total.formatted()) today").font(.caption2).foregroundStyle(.secondary) }
        }.accessibilityElement(children: .combine)
    }
}

struct AgentUsageView: View {
    let usage: JSONValue
    var body: some View {
        if let percent = usage["percent"].number, percent.isFinite {
            let remaining = usage["direction"].string == "remaining"
            let fraction = min(100, max(0, percent)) / 100
            let available = remaining ? fraction : 1 - fraction
            HStack(spacing: 12) {
                UsageRing(fraction: available, color: available <= 0.2 ? .orange : Brand.mint)
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(percent.formatted(.number.precision(.fractionLength(0...1))))% \(remaining ? "remaining" : "used")").font(.subheadline.bold().monospacedDigit())
                    Text(usage["detail"].string.nonempty ?? "Usage").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
            }.accessibilityElement(children: .combine)
        }
    }
}
