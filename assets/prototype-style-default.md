# Prototype Style Default
## Component and Layout Library for AI-Generated Wireframes

This file is the fallback design reference used when no screenshot has been uploaded
for any feature in the session. The AI reads this file to establish a consistent,
professional visual language for all generated wireframes.

Authored to the standard of a senior UI/UX practitioner and grounded in
established UX laws. Every decision below has a named rationale.

---

## 1. Design Philosophy

**Principle: Progressive clarity over visual richness.**
Wireframes generated from this library should feel immediately readable. A PM,
designer, or engineer should be able to scan the layout and understand the intent
within 3 seconds.

**UX laws applied throughout:**
- **Law of Proximity** (Gestalt) — related elements are grouped visually. Labels sit within 4px of their fields. Action buttons cluster together at the bottom of the screen.
- **Fitts's Law** — primary CTAs are large, placed at the bottom of the viewport where the thumb reaches naturally, and never buried mid-page.
- **Hick's Law** — no more than 5 navigation items visible at once. Complexity is hidden behind progressive disclosure: accordions, tabs, drawers.
- **Jakob's Law** — default patterns mirror widely-used enterprise SaaS conventions: top nav, left sidebar, card-based content, modal confirmations.
- **Miller's Law** — form sections capped at 5 fields before a visual group break.
- **Law of Common Region** — cards and panels create enclosed regions that signal "these things belong together."
- **Serial Position Effect** — primary CTA always rightmost in a button row. Destructive actions always leftmost or isolated.

---

## 2. Colour Usage

Use the PGT design token names. Do not hardcode hex values.

| Role | Token | When to use in wireframes |
|---|---|---|
| Primary brand | `var(--purple)` | Primary CTAs, active states, selected items, progress fills |
| Secondary action | `var(--blue)` | Links, info states, secondary CTAs |
| Success / done | `var(--green)` | Completed steps, success banners, positive indicators |
| Warning | `var(--amber)` | Validation errors, stale states, caution indicators |
| Destructive | `var(--red)` | Delete actions, error states, critical alerts |
| Page surface | `#FFFFFF` | Main content area background |
| Panel / chrome | `var(--card)` | Sidebars, headers, footers, card backgrounds |
| Borders | `var(--divider)` | All element borders and dividers |
| Primary text | `var(--t1)` | Headings, field values, critical labels |
| Secondary text | `var(--t2)` | Body copy, descriptions |
| Muted text | `var(--t3)` | Hints, placeholders, metadata |
| Disabled text | `var(--t4)` | Disabled field values, inactive labels |

**Colour restraint rule:** A single wireframe should use no more than 3 colour roles.
Brand purple for interaction, green for success, and neutral greys for everything
else is the baseline.

---

## 3. Typography Scale

Font family: DM Sans throughout. DM Serif Display for empty-state headings only.

| Element | Size | Weight | Casing |
|---|---|---|---|
| Screen / page title | 14px | 700 | Title Case |
| Section heading | 13px | 700 | Title Case |
| Card title | 11px | 600 | Title Case |
| Body copy | 11-12px | 400 | Sentence case |
| Field label | 10px | 600 | Title Case |
| Helper text / hint | 9-10px | 400 | Sentence case |
| Badge / tag | 8px | 700 | Title Case |
| Eyebrow label | 9px | 700 | UPPERCASE, letter-spacing 0.5px |

**Minimum size:** 9px. Never go below this in any wireframe element.

---

## 4. Spacing and Layout

### Grid and gutters
- Page margin: 16-24px on all sides
- Card internal padding: 12-16px
- Gap between sibling cards: 10-12px
- Gap between label and its field: 4-6px
- Gap between form field groups: 16px
- Gap between sections: 24px

### Border radius
- Cards and panels: 8px
- Buttons: 6-7px
- Input fields: 5-6px
- Badges and tags: 10-12px (pill shape)
- Small chips: 4px

### Border weight
- Card borders: 1px solid `var(--divider)`
- Input borders: 1px solid `var(--divider)`
- Dividers between sections: 1px solid `var(--divider)`
- Active / focus state: 1.5px solid `var(--purple)`

---

## 5. Layout Patterns

### 5.1 Full-page app shell
```
[Top navigation bar — 48px tall, navy background]
[Left sidebar — 240-280px, card background, collapsible]
[Main content area — flex-1, white background, scrollable]
```
Use for: dashboards, canvases, settings pages, list-detail views.

**Jakob's Law:** Mirrors Figma, Linear, Notion, and most enterprise SaaS.
Users arrive with a mental model already formed.

### 5.2 Centered content page
```
[Top navigation bar — 48px]
[Centered content column — max-width 640px, auto horizontal margins]
```
Use for: onboarding flows, empty states, single-focus task screens,
confirmation pages, error pages.

**Fitts's Law + Hick's Law:** Narrow column reduces eye travel distance and
eliminates visual noise. One clear task per screen.

### 5.3 Split panel
```
[Top navigation bar — 48px]
[Left panel — 360px, scrollable list]  [Right panel — flex-1, detail view]
```
Use for: list-detail screens, settings with sub-sections,
inbox-style interfaces, record editors.

### 5.4 Modal overlay
```
[Dimmed backdrop — rgba(0,0,0,0.4)]
[Centered modal card — max-width 480px, border-radius 10px, white]
  [Modal header — title + close button]
  [Modal body — scrollable if content overflows]
  [Modal footer — sticky, action buttons right-aligned]
```
Use for: confirmations, form dialogs, add/edit actions, alerts.

**Law of Common Region:** Modal card creates a hard visual boundary.
Everything inside belongs to the modal task. Backdrop signals context switch.

---

## 6. Component Library

### 6.1 Navigation bar (top)
- Height: 48px
- Background: `var(--navy)` (#003087)
- Logo / product name: left, 13px white, font-weight 700
- Primary navigation links: centre, 12px white, font-weight 500
- User avatar + settings: right, 32px circular avatar
- Border-bottom: none (navy provides sufficient visual separation)

### 6.2 Left sidebar navigation
- Width: 240-280px
- Background: `var(--card)`
- Border-right: 1px solid `var(--divider)`
- Section headers: 9px, uppercase, letter-spacing 0.5px, `var(--t3)`, padding 12px 14px 4px
- Nav items: 11px, `var(--t2)`, padding 7px 14px, border-radius 5px
- Active nav item: background `var(--purple-pale)`, color `var(--purple)`, font-weight 600
- Hover: background #F0F2F8
- Icons: 14px, left of label, 8px gap

### 6.3 Cards

**Standard content card:**
- Background: #FFFFFF
- Border: 1px solid `var(--divider)`
- Border-radius: 8px
- Padding: 14-16px
- Hover (if clickable): border-color `var(--purple-light)`, box-shadow 0 2px 8px rgba(0,0,0,0.06)

**Metric / stat card:**
- Background: `var(--card)`
- Border: 1px solid `var(--divider)`
- Border-radius: 8px
- Padding: 12px 14px
- Eyebrow label: 9px uppercase muted
- Value: 20px, font-weight 700, `var(--t1)`
- Delta badge (optional): 8px, green/red background

**Status card (info / warning / error):**
- Background: pale tint of the status colour
- Border-left: 3px solid status colour (no border-radius on left side)
- Padding: 10px 14px
- Icon: 14px status colour, left of text

### 6.4 Buttons

**Primary CTA:**
- Background: `var(--purple)`
- Color: #FFFFFF
- Font: 12px, font-weight 700
- Padding: 10px 18px
- Border-radius: 7px
- Hover: background `var(--purple-deep)`
- Disabled: opacity 0.45, cursor not-allowed

**Secondary / ghost:**
- Background: transparent
- Border: 1px solid `var(--divider)`
- Color: `var(--t2)`
- Font: 11-12px, font-weight 500
- Padding: 8px 14px
- Border-radius: 6px
- Hover: border-color `var(--purple)`, color `var(--purple)`

**Destructive:**
- Background: transparent
- Border: 1px solid `var(--red)`
- Color: `var(--red)`
- Font: 11px, font-weight 600
- Hover: background #FCE8E8

**Icon button:**
- Size: 28-32px square
- Border: 1px solid `var(--divider)`
- Border-radius: 5px
- Background: `var(--card)`
- Icon: 13-14px, `var(--t3)`
- Hover: border-color `var(--purple)`, icon color `var(--purple)`

**Button row layout:**
- Serial Position Effect: primary CTA rightmost, always
- Destructive action: leftmost or isolated with visual gap
- Max 3 buttons in a single row before stacking vertically on mobile

### 6.5 Form fields

**Text input:**
- Height: 34-36px
- Border: 1px solid `var(--divider)`
- Border-radius: 6px
- Padding: 0 10px
- Font: 12px, `var(--t1)`
- Placeholder: `var(--label)`
- Focus: border-color `var(--purple)`, box-shadow 0 0 0 3px rgba(95,30,190,0.10)
- Error: border-color `var(--red)`, background #FFF8F8
- Disabled: background `var(--card)`, color `var(--t4)`

**Textarea:**
- Min-height: 72px
- Same border and focus rules as text input
- Resize: vertical only

**Select / dropdown:**
- Same height and border as text input
- Arrow icon: right-aligned, 10px, `var(--t3)`

**Field label:**
- 10px, font-weight 600, `var(--t2)`, Title Case
- Margin-bottom: 4px
- Required asterisk: `var(--red)`, margin-left 2px

**Helper / hint text:**
- 9-10px, `var(--t3)`, margin-top 3px, sentence case

**Inline validation message:**
- 9-10px, `var(--red)` for errors, `var(--amber)` for warnings
- Prefixed with icon: ti-alert-circle (error) or ti-alert-triangle (warning)
- Appears immediately below the field, never above

**Form group rule (Miller's Law):**
- Max 5 fields per visual group before a divider or new section heading
- Group label: 11px, font-weight 700, border-bottom 1px solid `var(--divider)`,
  padding-bottom 6px, margin-bottom 10px

### 6.6 Data tables

- Header row: background `var(--card)`, 10px uppercase 700 letter-spacing 0.5px `var(--t3)`, height 34px
- Body rows: background #FFFFFF, height 40px, border-bottom 1px solid `var(--divider)`
- Hover row: background #F7F8FC
- Selected row: background `var(--purple-pale)`, border-left 2px solid `var(--purple)`
- Cell text: 11px, `var(--t2)`
- Cell padding: 0 12px
- Action column: always rightmost, icon buttons only, visible on row hover

**Serial Position Effect:** Most important column leftmost. Status / action
column rightmost.

### 6.7 Badges and tags

**Status badge:**
- Border-radius: 10px (pill)
- Padding: 2px 8px
- Font: 8px, font-weight 700
- Colour variants: green (success), amber (warning), red (error), blue (info),
  purple (active), grey (neutral)
- Background: pale tint. Text: dark shade of same colour family.

**Feature / label tag:**
- Border-radius: 4px
- Padding: 2px 6px
- Font: 8.5px, font-weight 600
- Background: `var(--card)`
- Border: 1px solid `var(--divider)`
- Color: `var(--t2)`

### 6.8 Progress and step indicators

**Linear progress bar:**
- Track height: 6px, background `var(--divider)`, border-radius 3px
- Fill: `var(--purple)`, border-radius 3px
- Percentage label: 10px, `var(--t3)`, right-aligned above or below bar

**Step indicator (wizard):**
- Node size: 24px circle
- Completed: background `var(--green)`, white checkmark icon
- Active: background `var(--purple)`, white step number, font-weight 700
- Pending: background #FFFFFF, border 1.5px solid `var(--divider)`, `var(--t4)` step number
- Connector line: 2px, completed segment `var(--green)`, pending `var(--divider)`
- Step label: 9px below node, active label `var(--purple)` font-weight 700, others `var(--t3)`

**Law of Proximity:** Step labels sit within 4px of their node. Connector lines
are visually thinner than nodes so the eye groups label to node first.

### 6.9 Empty states

- Icon: 40-48px, in a `var(--purple-pale)` rounded square (border-radius 10px)
- Title: 14px, font-weight 700, DM Serif Display, `var(--t1)`, margin-top 12px
- Description: 12px, `var(--t3)`, max-width 320px, text-align center, line-height 1.5
- Primary CTA: max-width 240px, centred, margin-top 16px
- Layout: centred horizontally and vertically within the available panel

### 6.10 Modals and drawers

**Modal:**
- Max-width: 480px
- Border-radius: 10px
- Background: #FFFFFF
- Header: 48px height, border-bottom 1px solid `var(--divider)`, title 13px 700, close button top-right
- Body: padding 16px, scrollable when content overflows
- Footer: 52px, sticky bottom, border-top 1px solid `var(--divider)`,
  background `var(--card)`, buttons right-aligned

**Right drawer / slide-in panel:**
- Width: 320-400px
- Slides in from right over the main content area
- Header: same spec as modal header
- Body: flex-1, overflow-y auto, padding 14px 16px
- Footer: sticky bottom, same spec as modal footer

**Jakob's Law + Law of Common Region:** Modal footer is always sticky. The user
should never need to scroll to reach the confirm action. This matches every major
SaaS convention users already know.

### 6.11 Notifications and toasts

**Toast notification:**
- Position: bottom-right, 16px from edges
- Min-width: 240px, max-width 360px
- Border-radius: 8px
- Background: `var(--t1)` (near-black) for neutral; tinted for status variants
- Text: 11px, white, sentence case
- Icon: left, 14px
- Auto-dismiss: 3-4 seconds
- Stacking: newest on top, max 3 visible simultaneously

**Inline banner:**
- Full-width within its container
- Border-left: 3px solid status colour (no radius on left edge)
- Padding: 8px 12px
- Dismissible: X icon right-aligned

---

## 7. Screen Layout Defaults by Feature Type

When the AI cannot determine a specific layout from story content, fall back
to the most appropriate pattern below based on feature category keywords.

| Feature type keywords | Default layout | Primary component |
|---|---|---|
| List, browse, search, filter, explore | Split panel (5.3) | Data table or card list |
| Create, add, onboard, setup, wizard | Centered content (5.2) | Step indicator + form |
| Dashboard, overview, summary, analytics | Full app shell (5.1) | Metric cards + chart placeholders |
| Settings, preferences, configuration | Full app shell (5.1) | Left nav + form sections |
| Detail, view, profile, record | Split panel (5.3) | Record card + action panel |
| Confirm, approve, review, sign off | Modal overlay (5.4) | Summary card + CTA row |
| Upload, import, attach | Modal overlay (5.4) | Upload zone + file list |
| Notification, alert, message | Centered content (5.2) | Status card + CTA |

---

## 8. Non-UI Feature Handling

If story content contains predominantly backend, infrastructure, data, or
system-level language and no clear user-facing interaction can be inferred,
do not attempt to generate a screen layout.

**Keywords that signal non-UI:** process, ingest, sync, batch, trigger, pipeline,
queue, schema, transform, migrate, index, cache, retry, webhook, event, job,
cron, worker, compute, throughput, latency, payload.

In this case, generate the Design Brief only (no wireframe), describing:
- The system boundary this feature operates within
- The data inputs and outputs
- Any admin or monitoring UI a human operator might need
- Suggested adjacent UI touchpoints (e.g. a status indicator in a dashboard)

---

## 9. Accessibility Defaults

Every generated wireframe must account for these by default:

- **Colour contrast:** Text on coloured backgrounds must meet WCAG AA (4.5:1 ratio).
  Use dark text on pale backgrounds, white text on dark or saturated backgrounds.
- **Focus indicators:** All interactive elements show a visible focus ring.
  Default: 2px solid `var(--purple)`, 2px offset.
- **Touch targets:** Minimum 44x44px for all interactive elements on mobile layouts.
- **Error states:** Never rely on colour alone. Always pair with an icon and text message.
- **Form labels:** Every field has a visible label. Placeholder text is not a label.
- **Loading states:** Every AI-triggered or async action shows a loading indicator.
  Never leave the user with a frozen UI and no feedback.

---

*This file is read by the prototype generation prompt builder in `scripts/prompts.js`
and injected as the style reference context when no session screenshots exist.
Update this file to change the default visual language for all generated prototypes.*
