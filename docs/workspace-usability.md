# Workspace usability design

Automations and Rules become distinct task views. Retain forest #173f32, leaf #597063, paper #f7f9f4, white #ffffff and line #d8e2d8; use amber #865516 for paused/attention. Keep the existing system sans typography for continuity: 36px page title, 22px section title, 16px body. Use monospace only inside optional technical details.

Layout: left-aligned title and explanation, compact sign-in panel, then a primary form next to a live summary; existing work follows in readable rows.

    Automations title         Rules link
    [workspace sign-in / connected state]
    [Project + name + timing] [What will happen]
    [Saved automations / actions]
    [Recent activity / outcomes]

Review: the original repeated three-card technical workflow required users to understand profile IDs and rule IDs. Replace it with one atomic setup operation. Rules get a separate editor with named project checkboxes, and existing rule controls show affected automations. Do not add decorative metrics or a marketing hero. Names and times replace UUIDs; raw payloads remain available only in collapsed details. Preview never executes a task. New automations stay paused; permanent cancellation requires a clear confirmation. Preserve authority checks at the server.

Validation: all 16 automated tests pass, including atomic setup rollback/authority/duplicate-save cases and PostgreSQL persistence. Browser checks in an isolated local workspace verified sign-in, project choices, one-step paused save, retained session between Rules/Automations, rule disable/version increment and Escape dismissal of cancellation. Desktop and 390px phone layout inspected; no horizontal overflow. Production credentials were not entered into the browser test.
