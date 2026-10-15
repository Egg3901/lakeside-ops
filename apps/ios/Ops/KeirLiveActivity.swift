import ActivityKit
import UIKit
import LakesideCore

@MainActor final class KeirLiveActivity {
    static let shared = KeirLiveActivity()
    private var tokenTask: Task<Void, Never>?
    private var lastUpdate = Date.distantPast
    private var lastState: KeirActivityAttributes.ContentState?
    func sync(_ snapshot: JSONValue, session: AppSession) async {
#if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--uitest-fixtures") { return }
#endif
        let enabled = UserDefaults.standard.object(forKey: "keir-live-activities") as? Bool ?? true
        let activities = Activity<KeirActivityAttributes>.activities
        guard session.signedIn, enabled, ActivityAuthorizationInfo().areActivitiesEnabled else {
            for activity in activities { await activity.end(nil, dismissalPolicy: .immediate) }
            lastState = nil; tokenTask?.cancel(); return
        }
        guard snapshot != .null else { return }
        let count = Int(snapshot["count"].number ?? 0)
        let state = KeirActivityAttributes.ContentState(status: snapshot["status"].string, count: count, updatedAt: snapshot["updatedAt"].number ?? 0, stopped: snapshot["stopped"].bool)
        let content = ActivityContent(state: state, staleDate: Date().addingTimeInterval(90))
        if count == 0 || state.stopped {
            for activity in activities { await activity.end(content, dismissalPolicy: .after(Date().addingTimeInterval(30))) }
            lastState = nil; tokenTask?.cancel(); return
        }
        let server = Surface.ops.base.absoluteString
        for other in activities where other.attributes.server != server { await other.end(nil, dismissalPolicy: .immediate) }
        if let activity = activities.first(where: { $0.attributes.server == server }) {
            if lastState != state || Date().timeIntervalSince(lastUpdate) > 60 { await activity.update(content); lastState = state; lastUpdate = Date() }
            observeToken(activity, session)
        } else if UIApplication.shared.applicationState == .active {
            do {
                let activity = try Activity.request(attributes: KeirActivityAttributes(server: server), content: content, pushType: .token)
                lastState = state; observeToken(activity, session)
            } catch { /* Activity authorization is optional; work continues in the app. */ }
        }
    }
    private var observedID: String?
    private func observeToken(_ activity: Activity<KeirActivityAttributes>, _ session: AppSession) {
        guard observedID != activity.id else { return }
        observedID = activity.id; tokenTask?.cancel()
        tokenTask = Task { @MainActor in
            for await data in activity.pushTokenUpdates {
                guard !Task.isCancelled, session.signedIn, activity.attributes.server == Surface.ops.base.absoluteString else { return }
                let token = data.map { String(format: "%02x", $0) }.joined()
                _ = try? await session.post("/api/keir/app/activities", ["token": .string(token), "activityId": .string(activity.id)])
            }
        }
    }
}
