---
name: design-review
description: Review a rendered interface for visual quality, usefulness, usability, accessibility and consistency, then fix concrete defects.
---

# Design Review

Read the owner's design direction and existing design system. Open the running interface or inspect real rendered captures before judging it. Source code alone cannot establish layout quality. If rendering is unavailable, state that limit and review only what can be established.

Review in this order:
1. Task success: can a user complete the primary workflow? Find dead controls, missing state, lost input, misleading success and broken recovery.
2. Information hierarchy: identify the first visual focal point and intended next action. Remove competing decoration, redundant labels and panels with no job.
3. Composition: inspect alignment, spacing rhythm, readable text measure, density, clipping, contrast and typography. Keep the established visual language.
4. Interaction: inspect keyboard focus, selection, disabled and loading states, modal behavior, navigation and interruption recovery.
5. Adaptation: inspect narrow and wide layouts, long realistic content, empty results, errors and reduced motion where applicable.

For each finding, give the location, visible problem, impact and a specific correction. Separate observed defects from preferences. Fix the highest-impact problems first within the authorized scope. Do not rewrite an entire interface to satisfy a personal aesthetic.

Render again after fixes and compare the same task and dimensions. Validate controls as well as appearance. Report the actual viewport sizes and interactions checked, and include a capture when useful. Never describe an unimplemented mockup as shipped functionality.
