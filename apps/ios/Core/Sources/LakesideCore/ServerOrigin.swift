import Foundation

/// One HTTPS origin per installation. Credentials never select an origin.
public enum ServerOrigin {
    public static func url(_ value: String) throws -> URL {
        guard let c = URLComponents(string: value), c.scheme == "https",
              let host = c.host, !host.isEmpty, c.user == nil, c.password == nil,
              c.query == nil, c.fragment == nil, c.path.isEmpty || c.path == "/",
              let url = c.url else { throw URLError(.badURL) }
        return url
    }
}
