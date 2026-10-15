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
    let push = OpsPushStatus()
}

@MainActor final class OpsRouter: ObservableObject {
    @Published var tab: OpsTab = .keir
}

enum OpsTab: Hashable { case keir, feed, goals, activity, ops }

@MainActor final class OpsPushStatus: ObservableObject {
    @Published var message = "Not registered yet"
    @Published var lastRegistered: Date?
    @Published var error: String?
}

enum OpsPushPrefs {
    static let keys = ["replies", "decisions", "incidents", "feed"]
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

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        Task { @MainActor in OpsServices.shared.push.error = "Apple device registration failed: \(error.localizedDescription)" }
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        let route = notification.request.content.userInfo["route"] as? String
        // A reply to the open Keir thread is already on screen.
        let thread = notification.request.content.userInfo["thread"] as? String ?? "main"
        let onKeir = await MainActor.run { OpsServices.shared.router.tab == .keir && OpsServices.shared.keir.thread == thread && UIApplication.shared.applicationState == .active }
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
            case "keir": services.keir.select(info["thread"] as? String ?? "main"); services.router.tab = .keir
            case "decision": services.router.tab = .activity
            case "alerts": services.router.tab = .ops
            case "feed": services.router.tab = .feed
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
        OpsServices.shared.push.message = granted ? "Registering with Apple" : "Notifications are off in iOS Settings"
        if granted { UIApplication.shared.registerForRemoteNotifications() }
        await update()
    }
    static func answer(_ decision: String, verdict: String, text: String) async {
        let services = OpsServices.shared
        if !services.session.signedIn { await services.session.restore() }
        _ = await services.ops.answer(decision, verdict: verdict, text: text, services.session)
    }
    static func refresh() async { await OpsServices.shared.ops.refresh(OpsServices.shared.session) }
    static func send(_ token: String, session: AppSession? = nil) async {
        // APNs can return before sign-in restoration. Retain the token first.
        UserDefaults.standard.set(token, forKey: "push.token")
        let appSession = session ?? OpsServices.shared.session
        guard appSession.signedIn else { return }
        let status = OpsServices.shared.push
        do {
            _ = try await appSession.post("/api/keir/app/devices", ["token": .string(token), "prefs": OpsPushPrefs.payload])
            status.lastRegistered = Date(); status.message = "Registered with Keir"; status.error = nil
        } catch { status.error = "Device registration will retry: \(error.displayMessage)" }
    }
    /// Re-sends the saved token with the current preferences.
    static func update() async {
        guard let token = UserDefaults.standard.string(forKey: "push.token") else { return }
        await send(token)
    }
}
