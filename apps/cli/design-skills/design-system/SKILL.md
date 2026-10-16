---
name: design-system
description: Build or refine a coherent visual system for an interface, including typography, spacing, color, components, responsive behavior and motion.
---

# Design System

Read the repository instructions and existing UI before changing its visual language. Ask only for a missing decision that blocks useful work. Preserve the owner's brand direction. Use frontend-design for visual exploration alongside this skill.

Define the system before repeating components:
- State the audience, primary task and intended feel in concrete terms. Identify existing assets and constraints, including terminal, web or native rendering.
- Establish semantic color tokens for surfaces, text, focus, selection, status and actions. Distinguish color meaning from decoration. Check contrast in the actual rendered combinations.
- Choose a typography hierarchy with intentional sizes, weights, line heights and readable measure. Reuse the project's fonts. Explain any new dependency before adding it.
- Use a small spacing scale and consistent alignment. Density should match the task; do not pad an operational interface into a marketing page.
- Define components by behavior: default, hover, focus, pressed, disabled, loading, empty, error and success. Include overflow and long labels.
- Motion should communicate state or spatial continuity. Respect reduced motion. Avoid animation that delays a common action.

Implement reusable tokens and focused components, not repeated one-off CSS. Every visible element should communicate state, provide navigation or support an action. Use realistic content and edge cases, never fake live metrics. Render at narrow, ordinary and wide dimensions. Inspect screenshots or the actual application, identify specific problems, fix them, then inspect again. Report what was visually checked and what remains unverified.
