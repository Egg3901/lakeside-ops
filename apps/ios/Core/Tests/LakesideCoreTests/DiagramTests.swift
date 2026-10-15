import XCTest
@testable import LakesideCore

final class DiagramTests: XCTestCase {
    func testServerChartPreservesLabelsValuesAndUnits() {
        let chart = Diagram("xychart-beta\n title \"GDP growth\"\n x-axis [\"US, total\",\"UK\"]\n y-axis \"Percent\" -2 --> 5\n bar [-1.5, 4]")
        XCTAssertEqual(chart.kind, "xy"); XCTAssertEqual(chart.axis, "Percent")
        XCTAssertEqual(chart.labels, ["US, total", "UK"]); XCTAssertEqual(chart.series.first?.values, [-1.5, 4])
    }
    func testPieAndLabeledRelationship() {
        XCTAssertEqual(Diagram("pie showData title \"Output\"\n\"Iron\" : 12.5\n\"Steel\" : 5").series.first?.values, [12.5, 5])
        let graph = Diagram("flowchart LR\nA[Demand] -->|raises| B[Price]")
        XCTAssertEqual(graph.edges.first?.from, "Demand"); XCTAssertEqual(graph.edges.first?.to, "Price"); XCTAssertEqual(graph.edges.first?.label, "raises")
    }
    func testChainedFlowAndSequenceRetainEveryRelationship() {
        let flow = Diagram("flowchart LR\nA[Demand] --> B[Price] --> C[Supply]")
        XCTAssertEqual(flow.edges.count, 2)
        XCTAssertEqual(flow.edges.last?.from, "Price")
        XCTAssertEqual(flow.edges.last?.to, "Supply")
        let sequence = Diagram("sequenceDiagram\nparticipant A as Player\nparticipant B as Game\nA->>B: Submit action")
        XCTAssertEqual(sequence.edges.first?.from, "Player")
        XCTAssertEqual(sequence.edges.first?.label, "Submit action")
    }
    func testMismatchedSeriesIsNotSilentlyReinterpreted() {
        XCTAssertEqual(Diagram("xychart-beta\nx-axis [\"A\",\"B\"]\nbar [1]").kind, "unsupported")
    }
}
