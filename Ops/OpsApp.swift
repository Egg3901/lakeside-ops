import SwiftUI
import UserNotifications

@main struct LakesideOpsApp: App {
    @UIApplicationDelegateAdaptor(OpsAppDelegate.self) private var delegate
    var body: some Scene {
        WindowGroup {
            SessionGate(session: OpsServices.shared.session) { OpsRoot() }
                .environmentObject(OpsServices.shared.ops)
                .environmentObject(OpsServices.shared.router)
                .modifier(LakesideStyle())
        }
    }
}

struct OpsRoot: View {
    @EnvironmentObject private var session: AppSession
    @EnvironmentObject private var ops: OpsStore
    @EnvironmentObject private var router: OpsRouter
    @Environment(\.scenePhase) private var scenePhase
    @State private var settings = false

    var body: some View {
        TabView(selection: $router.tab) {
            NavigationStack { KeirView(keir: OpsServices.shared.keir).toolbar { settingsButton } }
                .tabItem { Label("Keir", systemImage: "bubble.left.and.text.bubble.right") }.tag(OpsTab.keir)
                .badge(ops.decisions.count)
            NavigationStack { PulseView(tab: $router.tab).toolbar { settingsButton } }
                .tabItem { Label("Pulse", systemImage: "waveform.path.ecg") }.tag(OpsTab.pulse)
                .badge(ops.servicesDown.count + ops.redPRs)
            NavigationStack { DeskView().toolbar { settingsButton } }
                .tabItem { Label("Desk", systemImage: "tray.full") }.tag(OpsTab.desk)
            NavigationStack { WorkView().toolbar { ToolbarItem(placement: .topBarLeading) { settingsButton } } }
                .tabItem { Label("Work", systemImage: "rectangle.split.3x1") }.tag(OpsTab.work)
        }
        .tint(OpsTheme.sky)
        .toolbarBackground(OpsTheme.background, for: .tabBar).toolbarBackground(.visible, for: .tabBar)
        .sheet(isPresented: $settings) { OpsSettings() }
        .task { await OpsPushRegistration.request() }
        .task(id: scenePhase == .active) {
            // Refresh while open: every 30 seconds in the foreground, never in the background.
            while scenePhase == .active && !Task.isCancelled {
                await ops.refresh(session)
                do { try await Task.sleep(for: .seconds(30)) } catch { return }
            }
        }
    }

    private var settingsButton: some View {
        Button { settings = true } label: { Image(systemName: "gearshape") }.accessibilityLabel("Settings")
    }
}

struct OpsSettings: View {
    @EnvironmentObject private var session: AppSession
    @Environment(\.dismiss) private var dismiss
    @AppStorage("appearance") private var appearance = "dark"
    @State private var prefs = Dictionary(uniqueKeysWithValues: OpsPushPrefs.keys.map { ($0, OpsPushPrefs.value($0)) })
    @State private var status: UNAuthorizationStatus = .notDetermined

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    toggle("replies", "Keir replies", "When Keir answers you in the app.")
                    toggle("decisions", "Decisions", "Time-sensitive. Approve or reject from the notification.")
                    toggle("incidents", "Watchkeeper incidents", "Quiet delivery. Turn failures and stalled work.")
                    if status == .denied {
                        Button("Turn on notifications in Settings") { if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) } }
                    }
                } header: { Text("Notifications") }
                Section("Appearance") {
                    Picker("Theme", selection: $appearance) { Text("Dark").tag("dark"); Text("Light").tag("light"); Text("System").tag("system") }
                }
                Section {
                    LabeledContent("Signed in as", value: session.profile["email"].string.hasPrefix("discord_") ? "Owner" : session.profile["email"].string)
                    Button("Sign out", role: .destructive) { Task { await session.signOut(); dismiss() } }
                }
            }
            .scrollContentBackground(.hidden).background(OpsTheme.background)
            .navigationTitle("Settings").navigationBarTitleDisplayMode(.inline)
            .toolbar { Button("Done") { dismiss() } }
            .task { status = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus }
        }
    }

    private func toggle(_ key: String, _ title: String, _ detail: String) -> some View {
        Toggle(isOn: Binding(get: { prefs[key] ?? true }, set: { on in
            prefs[key] = on; OpsPushPrefs.set(key, on); Task { await OpsPushRegistration.update() }
        })) {
            VStack(alignment: .leading, spacing: 2) { Text(title); Text(detail).font(.caption).foregroundStyle(OpsTheme.muted) }
        }
    }
}
