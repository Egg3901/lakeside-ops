---
name: accessible-design
description: Implement and review keyboard access, focus, semantics, contrast, responsive text, reduced motion and accessible error handling.
---

# Accessible Design

Inspect the actual platform and available accessibility APIs before promising compliance. Use current authoritative platform or accessibility documentation when a precise standard is required. Do not claim certification from a quick audit.

Check the complete task path:
- Every essential control works without a mouse. Focus is visible, follows a logical order and returns to the triggering control after a dialog closes. Prevent focus from landing behind modal content.
- Prefer semantic native elements. Inputs have persistent labels, instructions and associated errors. Buttons have action names; icon-only controls need accessible names.
- Status and errors are communicated with text and semantics, not color alone. Avoid noisy repeated announcements during streaming.
- Text remains readable with zoom, larger system fonts and narrow layouts. Long names and translations do not hide essential actions. Content can reflow or scroll without losing the task.
- Check text, control and focus contrast in the rendered theme, including disabled and selected states. Do not assume a color token is sufficient in every pairing.
- Respect reduced motion and avoid flashing. Avoid timing-dependent interactions unless users can pause or recover.
- Terminal interfaces need keyboard equivalents for mouse targets, useful plain-text fallback output and resilience to small windows. Explain limitations of terminal assistive technology support honestly.

Use automated checks when supported and relevant, then manually exercise keyboard traversal, dialogs, validation errors and one complete primary task. Document concrete failures with location and reproduction. Fix severe blockers before cosmetic refinements. Report tools and manual checks used; keep untested claims out of the result.
