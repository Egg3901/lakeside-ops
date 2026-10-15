import ActivityKit
import WidgetKit
import SwiftUI

@main struct KeirWidgets: WidgetBundle {
    var body: some Widget { KeirWorkActivity(); KeirLauncher() }
}

struct KeirWorkActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: KeirActivityAttributes.self) { context in
            HStack(spacing: 14) {
                Image(systemName: context.state.stopped ? "stop.circle.fill" : "ellipsis.bubble.fill")
                    .font(.largeTitle).foregroundStyle(context.state.stopped ? .orange : .cyan)
                VStack(alignment: .leading, spacing: 4) {
                    Text("Keir").font(.headline)
                    Text(context.isStale ? "Open Keir to refresh" : context.state.count == 0 ? "No active work" : context.state.status).font(.subheadline)
                }
                Spacer()
                if context.state.count > 0 { Text("\(context.state.count)").font(.title2.monospacedDigit()) }
            }.padding().activityBackgroundTint(.black.opacity(0.9)).activitySystemActionForegroundColor(.white)
                .widgetURL(URL(string: "lakesideops://keir"))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) { Label("Keir", systemImage: "ellipsis.bubble.fill").foregroundStyle(.cyan) }
                DynamicIslandExpandedRegion(.trailing) { Text("\(context.state.count)").monospacedDigit() }
                DynamicIslandExpandedRegion(.bottom) { Text(context.isStale ? "Open Keir to refresh" : context.state.count == 0 ? "No active work" : context.state.status).font(.callout).padding(.top, 4) }
            } compactLeading: {
                Image(systemName: context.state.stopped ? "stop.fill" : context.state.status.localizedCaseInsensitiveContains("needs") ? "hand.raised.fill" : "ellipsis").foregroundStyle(context.state.stopped ? .orange : .cyan)
            } compactTrailing: {
                Text("\(context.state.count)").monospacedDigit()
            } minimal: {
                Image(systemName: context.state.stopped ? "stop.fill" : context.state.status.localizedCaseInsensitiveContains("needs") ? "hand.raised.fill" : "ellipsis").foregroundStyle(.cyan)
            }.widgetURL(URL(string: "lakesideops://keir"))
        }
    }
}

struct KeirLauncher: Widget {
    struct Entry: TimelineEntry { var date: Date }
    struct Provider: TimelineProvider {
        func placeholder(in context: Context) -> Entry { Entry(date: .now) }
        func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) { completion(Entry(date: .now)) }
        func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) { completion(Timeline(entries: [Entry(date: .now)], policy: .never)) }
    }
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "KeirLauncher", provider: Provider()) { _ in
            VStack(alignment: .leading, spacing: 10) {
                Label("Keir", systemImage: "ellipsis.bubble.fill").font(.headline).foregroundStyle(.cyan)
                Text("Your workspace,\none tap away.").font(.callout)
                HStack(spacing: 18) {
                    Link(destination: URL(string: "lakesideops://keir?view=voice")!) { Image(systemName: "mic.fill").accessibilityLabel("Talk to Keir") }
                    Link(destination: URL(string: "lakesideops://keir?view=activity")!) { Image(systemName: "list.bullet").accessibilityLabel("Open activity") }
                    Link(destination: URL(string: "lakesideops://keir?view=controls")!) { Image(systemName: "slider.horizontal.3").accessibilityLabel("Open Keir controls") }
                }
            }.containerBackground(.fill.tertiary, for: .widget).widgetURL(URL(string: "lakesideops://keir"))
        }.configurationDisplayName("Keir").description("Talk to Keir, check activity or open controls.").supportedFamilies([.systemSmall])
    }
}
