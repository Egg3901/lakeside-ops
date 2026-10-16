---
name: ux-design
description: Design task flows, navigation, information architecture, forms, onboarding and recovery for real user workflows.
---

# Ux Design

Start from the user's goal and the context in which it happens. Read existing screens and domain terminology. Describe the primary task as an observable outcome, then map the shortest complete path from entry to that outcome.

For each flow:
1. Identify what the user knows, what they must decide and what the system can infer reliably. Avoid unnecessary setup and permission interruptions.
2. Put the next useful action close to the information needed to choose it. Use concrete labels and consistent domain names. Avoid controls that merely explain how to do work elsewhere.
3. Define state transitions explicitly: idle, loading, partial, waiting, success, failed, cancelled and uncertain. Explain what happens when a response is lost or the app restarts.
4. Preserve user input and work when navigating, retrying or reconnecting. Never erase a draft to populate a shortcut. Prevent accidental duplicate submissions.
5. Distinguish reversible edits from external effects. Show a reviewable result before a consequential action when approval is required. Do not add invented approval gates.
6. Design useful empty and error states with the next recovery action. A spinner without a bounded failure path is incomplete.

Use progressive disclosure for infrequent detail. Validate keyboard paths and screen-reader labels where supported. Exercise one complete realistic task and one interruption/recovery path in the running product. Record evidence and remaining limitations; a polished screenshot alone does not validate the flow.
