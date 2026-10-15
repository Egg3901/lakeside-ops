import SwiftUI
import AVFoundation
import LakesideCore

/// Settings reflect the authenticated server, including changes from other clients.
struct KeirControls: View {
    @EnvironmentObject private var session: AppSession
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var keir: KeirStore
    @ObservedObject var voice: KeirVoice
    @AppStorage("keir-voice-id") private var voiceID = "auto"
    @AppStorage("keir-voice-rate") private var rate = 0.92
    @AppStorage("keir-spoken-replies") private var spokenReplies = false
    @AppStorage("keir-live-activities") private var liveActivities = true
    @State private var lane = "investigation"
    private let lanes = ["conversation", "coding", "investigation", "coordination"]
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Label(keir.stopped ? "Keir is stopped" : "Keir is ready", systemImage: keir.stopped ? "stop.circle.fill" : "checkmark.circle")
                    Button(keir.stopped ? "Start Keir" : "Stop all work", role: keir.stopped ? nil : .destructive) {
                        voice.stop()
                        Task { await keir.control(["action": .string(keir.stopped ? "start" : "stop")], session) }
                    }.accessibilityIdentifier("keir-global-control")
                    Text("Stop cancels active work and queued sends across the installation. Start enables new work.")
                        .font(.caption).foregroundStyle(.secondary)
                } header: { Text("Runtime") }
                if keir.controls["supported"].bool {
                    Section {
                        Toggle("YOLO mode", isOn: Binding(get: { keir.yolo }, set: { enabled in
                            Task { await keir.control(["action": .string("configure"), "approvalMode": .string(enabled ? "yolo" : "ask")], session) }
                        })).tint(OpsTheme.warn).accessibilityIdentifier("keir-yolo")
                        Text("Skip approval prompts for supported owner actions in this conversation. Installation permissions still apply. Turning it off revokes its grant.")
                            .font(.caption).foregroundStyle(.secondary)
                    } header: { Text("Approvals · this conversation") }
                    Section {
                        ForEach(lanes, id: \.self) { lane in
                            Picker(lane.capitalized, selection: Binding(get: { keir.controls["routes"][lane].string.nonempty ?? "auto" }, set: { value in
                                Task { await keir.control(["action": .string("configure"), "routes": .object([lane: .string(value)])], session) }
                            })) {
                                ForEach(keir.controls["options"][lane].array, id: \.["id"].string) { route in
                                    Text(route["id"].string == "auto" ? "Installation default" : "\(route["provider"].string) · \(route["label"].string)\(route["effort"].string.isEmpty ? "" : " · \(route["effort"].string)")").tag(route["id"].string)
                                }
                            }.pickerStyle(.navigationLink).accessibilityIdentifier("keir-route-\(lane)")
                            Text("Default: \(keir.controls["defaults"][lane].string)").font(.caption).foregroundStyle(.secondary)
                        }
                        Text("Coordination drives work and delegates to coding and investigation providers. Changes apply at the next activation. Running tasks show the provider actually in use.").font(.caption).foregroundStyle(.secondary)
                    } header: { Text("Providers · this conversation") }
                    Section {
                        Picker("Work type", selection: $lane) { ForEach(lanes, id: \.self) { Text($0.capitalized).tag($0) } }
                        ForEach(keir.controls["catalog"].array, id: \.["id"].string) { skill in
                            Toggle(isOn: Binding(get: { enabled(skill) }, set: { on in toggleSkill(skill, on: on) })) {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(skill["id"].string.replacingOccurrences(of: "-", with: " ").capitalized)
                                    Text("\(skill["source"].string) · \(skill["license"].string)").font(.caption).foregroundStyle(.secondary)
                                }
                            }.disabled(!skill["available"].bool)
                        }
                        Button("Restore default skills") {
                            Task { await keir.control(["action": .string("configure"), "skills": .object([lane: .null])], session) }
                        }
                    } header: { Text("Skills") }
                } else {
                    Text("This server does not support the new controls yet. Update your installation to use them.").foregroundStyle(.secondary)
                }
                Section {
                    Toggle("Speak replies", isOn: $spokenReplies)
                    Picker("Voice", selection: $voiceID) {
                        Text("Best available for my language").tag("auto")
                        ForEach(KeirVoice.availableVoices, id: \.identifier) { v in
                            Text("\(v.name) · \(v.language)\(v.quality == .premium ? " · Premium" : v.quality == .enhanced ? " · Enhanced" : "")").tag(v.identifier)
                        }
                    }
                    Slider(value: $rate, in: 0.7...1.2, step: 0.02) { Text("Speaking speed") }
                    LabeledContent("Speaking speed", value: "\(Int(rate * 100))%")
                    Button(voice.speaking ? "Stop preview" : "Preview voice") {
                        if voice.speaking { voice.stopSpeaking() }
                        else { voice.speak("Hello. I'm Keir. Tell me what you're working on, and we'll take it from there.") }
                    }
                    Text("These settings read text replies using an installed Apple voice. Voice conversations use Microsoft Ava online.").font(.caption).foregroundStyle(.secondary)
                } header: { Text("Read text replies aloud") }
                Section {
                    Toggle("Live Activities", isOn: $liveActivities)
                    Text("Show work status on your Lock Screen and Dynamic Island. Task content stays inside the app.").font(.caption).foregroundStyle(.secondary)
                } header: { Text("At a glance") }
                if let error = keir.error { Text(error).foregroundStyle(OpsTheme.warn).accessibilityIdentifier("keir-control-error") }
            }
            .disabled(keir.controlling)
            .navigationTitle("Keir controls").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task { await keir.loadControls(session) }
        }
    }
    private func enabled(_ skill: JSONValue) -> Bool {
        let selection = keir.controls["skills"][lane]
        if selection != .null { return selection.array.contains(.string(skill["id"].string)) }
        let key = ["conversation": "quick", "coding": "coder", "investigation": "investigator", "coordination": "worker"][lane]!
        return skill["defaults"].array.contains(.string(key))
    }
    private func toggleSkill(_ skill: JSONValue, on: Bool) {
        var ids = keir.controls["catalog"].array.filter { enabled($0) }.map { $0["id"].string }
        ids.removeAll { $0 == skill["id"].string }; if on { ids.append(skill["id"].string) }
        Task { await keir.control(["action": .string("configure"), "skills": .object([lane: .array(ids.map(JSONValue.string))])], session) }
    }
}

struct KeirTaskProviders: View {
    @EnvironmentObject private var session: AppSession
    @Environment(\.dismiss) private var dismiss
    let task: JSONValue
    @State private var controls: JSONValue = .null
    @State private var routes: [String: JSONValue] = [:]
    @State private var busy = false
    @State private var error: String?
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    ForEach(["conversation", "coding", "investigation", "coordination"], id: \.self) { lane in
                        Picker(lane.capitalized, selection: Binding(get: { routes[lane]?.string ?? "inherit" }, set: { value in
                            busy = true
                            Task {
                                do {
                                    _ = try await session.post("/api/keir/app/controls", ["action": .string("configure"), "thread": task["thread"], "taskId": task["id"], "routes": .object([lane: .string(value)])])
                                    routes[lane] = .string(value); error = nil
                                } catch { self.error = error.displayMessage }
                                busy = false
                            }
                        })) {
                            Text("Inherit conversation").tag("inherit")
                            ForEach(controls["options"][lane].array, id: \.["id"].string) { route in
                                Text(route["id"].string == "auto" ? "Installation default" : "\(route["provider"].string) · \(route["label"].string)").tag(route["id"].string)
                            }
                        }
                    }
                    Text("Overrides apply to future activations of this task and its delegated work.").font(.caption).foregroundStyle(.secondary)
                } header: { Text("Task providers") }
                if let error { Text(error).foregroundStyle(OpsTheme.warn) }
            }.disabled(busy || controls == .null).navigationTitle("Task providers").navigationBarTitleDisplayMode(.inline)
                .toolbar { Button("Done") { dismiss() } }
                .task {
                    routes = task["overrides"]["routes"].object
                    do { controls = try await session.get("/api/keir/app/controls", query: ["thread": task["thread"].string]) }
                    catch { self.error = error.displayMessage }
                }
        }
    }
}
