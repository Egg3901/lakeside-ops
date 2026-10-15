import SwiftUI
import UserNotifications
import LakesideCore

/// One owner session for the whole app, shared with notification actions that
/// run while the app is in the background.
@MainActor final class OpsServices {
    static let shared = OpsServices()
    let session = AppSession(.ops)
    let ops = OpsStore()
    let keir = KeirStore()
    let router = OpsRouter()
}

@MainActor final class OpsRouter: ObservableObject {
    @Published var tab: OpsTab = .keir
}

enum OpsTab: Hashable { case keir, pulse, desk, work }

enum OpsPushPrefs {
    static let keys = ["replies", "decisions", "incidents"]
    static func value(_ key: String) -> Bool { UserDefaults.standard.object(forKey: "push.\(key)") as? Bool ?? true }
    static func set(_ key: String, _ on: Bool) { UserDefaults.standard.set(on, forKey: "push.\(key)") }
    static var payload: JSONValue { .object(Dictionary(uniqueKeysWithValues: keys.map { ($0, JSONValue.bool(value($0))) })) }
}

final class OpsAppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    static let decisionCategory = "KEIR_DECISION"

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        // Approve needs Face ID: it carries the owner's authority.
        let approve = UNNotificationAction(identifier: "approve", title: "Approve", options: [.authenticationRequired])
        let reject = UNNotificationAction(identifier: "reject", title: "Reject", options: [.authenticationRequired, .destructive])
        let reply = UNTextInputNotificationAction(identifier: "explain", title: "Reply", options: [.authenticationRequired], textInputButtonTitle: "Send", textInputPlaceholder: "Ask Keir why, or what to change")
        center.setNotificationCategories([UNNotificationCategory(identifier: Self.decisionCategory, actions: [approve, reject, reply], intentIdentifiers: [], options: [])])
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        Task { @MainActor in await OpsPushRegistration.send(token) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {}

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        let route = notification.request.content.userInfo["route"] as? String
        // A reply to the open Keir thread is already on screen.
        let onKeir = await MainActor.run { OpsServices.shared.router.tab == .keir && UIApplication.shared.applicationState == .active }
        if route == "keir" && onKeir { return [] }
        Task { await OpsPushRegistration.refresh() }
        return [.banner, .list, .sound]
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let info = response.notification.request.content.userInfo
        let route = info["route"] as? String
        let decision = info["decision"] as? String
        let action = response.actionIdentifier
        await MainActor.run {
            let services = OpsServices.shared
            switch route {
            case "decision", "keir": services.router.tab = .keir
            case "alerts": services.router.tab = .pulse
            default: break
            }
        }
        if let decision, ["approve", "reject", "explain"].contains(action) {
            let text = (response as? UNTextInputNotificationResponse)?.userText ?? ""
            await OpsPushRegistration.answer(decision, verdict: action, text: text)
        }
    }
}

@MainActor enum OpsPushRegistration {
    static func request() async {
#if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--uitest-fixtures") { return }
#endif
        let center = UNUserNotificationCenter.current()
        let granted = (try? await center.requestAuthorization(options: [.alert, .badge, .sound])) ?? false
        if granted { UIApplication.shared.registerForRemoteNotifications() }
    }
    static func answer(_ decision: String, verdict: String, text: String) async {
        let services = OpsServices.shared
        _ = await services.ops.answer(decision, verdict: verdict, text: text, services.session)
    }
    static func refresh() async { await OpsServices.shared.ops.refresh(OpsServices.shared.session) }
    static func send(_ token: String) async {
        let session = OpsServices.shared.session
        guard session.signedIn else { return }
        UserDefaults.standard.set(token, forKey: "push.token")
        _ = try? await session.post("/api/keir/app/devices", ["token": .string(token), "prefs": OpsPushPrefs.payload])
    }
    /// Re-sends the saved token with the current preferences.
    static func update() async {
        guard let token = UserDefaults.standard.string(forKey: "push.token") else { await request(); return }
        await send(token)
    }
}
