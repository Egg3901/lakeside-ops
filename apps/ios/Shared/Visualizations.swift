import SwiftUI
import Charts
import SwiftDraw
import LakesideCore

struct NativeVisualization: View {
    let language: String
    let source: String
    var body: some View {
        if language == "ahd-map" { GameMapView(source: source) }
        else { MermaidView(source: source) }
    }
}

struct MermaidView: View {
    let source: String
    @State private var expanded = false
    private var diagram: Diagram { Diagram(source) }
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack { Label(diagram.title, systemImage: "chart.xyaxis.line").font(.headline); Spacer(); Button { expanded = true } label: { Image(systemName: "arrow.up.left.and.arrow.down.right") }.accessibilityLabel("Expand visualization") }
            chart.frame(minHeight: diagram.kind == "flow" ? 0 : 220)
            dataTable
        }.brandCard().accessibilityIdentifier("native-visualization")
            .sheet(isPresented: $expanded) {
                NavigationStack {
                    ScrollView([.horizontal, .vertical]) { VStack(alignment: .leading, spacing: 20) { chart.frame(width: 700).frame(minHeight: 420); dataTable }.padding(24) }.lakesideScreen()
                        .navigationTitle(diagram.title).navigationBarTitleDisplayMode(.inline)
                        .toolbar { Button("Done") { expanded = false } }
                }
            }
    }
    @ViewBuilder private var chart: some View {
        if diagram.kind == "pie", let series = diagram.series.first, !series.values.isEmpty {
            Chart(Array(series.values.enumerated()), id: \.offset) { index, value in
                SectorMark(angle: .value("Value", value), innerRadius: .ratio(0.5), angularInset: 2)
                    .foregroundStyle(by: .value("Category", diagram.labels[index]))
            }.chartLegend(position: .bottom, alignment: .leading)
        } else if diagram.kind == "xy", !diagram.series.isEmpty {
            Chart {
                ForEach(Array(diagram.series.enumerated()), id: \.offset) { seriesIndex, series in
                    ForEach(Array(series.values.enumerated()), id: \.offset) { index, value in
                        if series.kind == "line" {
                            LineMark(x: .value("Category", diagram.labels[index]), y: .value(diagram.axis, value))
                                .foregroundStyle(by: .value("Series", "Series \(seriesIndex + 1)"))
                            PointMark(x: .value("Category", diagram.labels[index]), y: .value(diagram.axis, value))
                                .foregroundStyle(by: .value("Series", "Series \(seriesIndex + 1)"))
                        } else {
                            BarMark(x: .value("Category", diagram.labels[index]), y: .value(diagram.axis, value))
                                .foregroundStyle(by: .value("Series", "Series \(seriesIndex + 1)"))
                                .position(by: .value("Series", "Series \(seriesIndex + 1)"))
                        }
                    }
                }
            }.chartYAxisLabel(diagram.axis).chartLegend(diagram.series.count > 1 ? .visible : .hidden)
        } else if diagram.kind == "flow" {
            VStack(alignment: .leading, spacing: 14) {
                ForEach(Array(diagram.edges.enumerated()), id: \.offset) { _, edge in
                    VStack(spacing: 8) {
                        Text(edge.from).font(.callout.weight(.medium)).padding(12).frame(maxWidth: .infinity).background(Brand.raised, in: RoundedRectangle(cornerRadius: 12))
                        HStack { Image(systemName: "arrow.down"); if !edge.label.isEmpty { Text(edge.label) } }.font(.caption).foregroundStyle(Brand.mint)
                        Text(edge.to).font(.callout.weight(.medium)).padding(12).frame(maxWidth: .infinity).background(Brand.sky.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
                    }.accessibilityElement(children: .combine)
                }
            }
        } else {
            VStack(alignment: .leading, spacing: 10) {
                Text("This diagram format is not supported yet.").font(.callout).foregroundStyle(.secondary)
                DisclosureGroup("View diagram source") { Text(source).font(.system(.caption, design: .monospaced)).textSelection(.enabled) }
            }
        }
    }
    @ViewBuilder private var dataTable: some View {
        if !diagram.labels.isEmpty && !diagram.series.isEmpty && diagram.kind != "unsupported" {
            DisclosureGroup("Values") {
                VStack(spacing: 10) {
                    ForEach(Array(diagram.labels.enumerated()), id: \.offset) { index, label in
                        HStack(alignment: .top) {
                            Text(label); Spacer()
                            VStack(alignment: .trailing) {
                                ForEach(Array(diagram.series.enumerated()), id: \.offset) { number, series in
                                    if index < series.values.count { Text((diagram.series.count > 1 ? "\(number + 1): " : "") + series.values[index].formatted()).monospacedDigit() }
                                }
                            }
                        }.font(.caption)
                    }
                }.padding(.top, 12)
            }.font(.caption)
        }
    }
}

struct GameMapView: View {
    let source: String
    @EnvironmentObject private var session: AppSession
    @State private var image: UIImage?
    @State private var error: String?
    @State private var expanded = false
    private var spec: JSONValue { (try? JSONValue.parse(source)) ?? .null }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(spec["title"].string.nonempty ?? "Game map", systemImage: "map").font(.headline)
            if let image {
                Button { expanded = true } label: { Image(uiImage: image).resizable().scaledToFit() }.accessibilityLabel("Expand game map")
                Text("Tap to explore. Pinch to zoom.").font(.caption).foregroundStyle(.secondary)
            } else if let error { Text(error).font(.callout).foregroundStyle(.secondary); Button("Retry") { Task { await load() } } }
            else { ProgressView("Drawing map…").frame(maxWidth: .infinity).padding() }
            DisclosureGroup("Map values") {
                ForEach(Array(spec["regions"].array.enumerated()), id: \.offset) { _, row in
                    HStack { Text(row.first("label", "id")); Spacer(); Text(row["value"].string + " " + spec["unit"].string).monospacedDigit() }.font(.caption).padding(.vertical, 4)
                }
            }.font(.caption)
        }.brandCard().task(id: source) { await load() }
            .sheet(isPresented: $expanded) {
                NavigationStack {
                    if let image { ZoomableMap(image: image).ignoresSafeArea(edges: .bottom).navigationTitle("Game map").navigationBarTitleDisplayMode(.inline).toolbar { Button("Done") { expanded = false } } }
                }
            }
    }
    private func load() async {
        image = nil; error = nil
        do {
            guard spec != .null else { throw AppFailure(message: "This map has an invalid specification.") }
            let data = try await session.renderMap(spec)
            try Task.checkCancellation()
            // The service owns geometry; SwiftDraw renders it locally without a browser.
            guard let rendered = UIImage(svgData: data) else { throw AppFailure(message: "This map could not be drawn.") }
            image = rendered
        } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    }
}

private struct ZoomableMap: UIViewRepresentable {
    let image: UIImage
    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeUIView(context: Context) -> UIScrollView {
        let scroll = UIScrollView(); scroll.delegate = context.coordinator
        scroll.minimumZoomScale = 1; scroll.maximumZoomScale = 6; scroll.backgroundColor = .black
        let view = UIImageView(image: image); view.contentMode = .scaleAspectFit
        context.coordinator.image = view; scroll.addSubview(view)
        return scroll
    }
    func updateUIView(_ view: UIScrollView, context: Context) {
        DispatchQueue.main.async {
            guard view.zoomScale == 1 else { return }
            context.coordinator.image?.frame = view.bounds
            view.contentSize = view.bounds.size
        }
    }
    final class Coordinator: NSObject, UIScrollViewDelegate {
        var image: UIImageView?
        func viewForZooming(in scrollView: UIScrollView) -> UIView? { image }
    }
}
