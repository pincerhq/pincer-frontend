# Components

## Structure

```
src/components/
├── ui/               # shadcn/ui primitives
├── dashboard/        # Dashboard-specific components
└── *.tsx             # Shared app-level components
```

---

## Shared App Components

| Component | File | Description |
|-----------|------|-------------|
| Header | `Header.tsx` | Global marketing navigation with mega-menus |
| Footer | `Footer.tsx` | Site-wide footer with link columns |
| ProtectedRoute | `ProtectedRoute.tsx` | Auth guard — redirects to `/login` if not authenticated |
| ThemeSelector | `ThemeSelector.tsx` | Toggle between light / dark / system themes |
| PricingCalculator | `PricingCalculator.tsx` | Interactive pricing calculator widget |
| CreateAssistantDialog | `CreateAssistantDialog.tsx` | Modal for creating a new AI assistant |
| CreateTeamDialog | `CreateTeamDialog.tsx` | Modal for creating a new team |
| ImportEmployeesDialog | `ImportEmployeesDialog.tsx` | Modal for bulk importing employees |
| AddEmployeeDialog | `AddEmployeeDialog.tsx` | Modal for adding an individual employee |

---

## Dashboard Components (`components/dashboard/`)

| Component | Description |
|-----------|-------------|
| `AppSidebar.tsx` | Main sidebar navigation for the authenticated dashboard |
| `AgentsNavbar.tsx` | Top navbar within the Agents section |
| `AIEmployeeConnections.tsx` | Graph/network view of AI agent relationships |
| `EnhancedActivityLog.tsx` | Detailed, filterable activity feed |
| `MetricCard.tsx` | Single KPI metric display card |
| `ActivityItem.tsx` | Individual row in an activity feed |
| `DashboardHeader.tsx` | Top bar of the main dashboard |

---

## UI Primitives (`components/ui/`)

All components are from **shadcn/ui** built on Radix UI. They accept Tailwind class overrides via the `className` prop and support the `cn()` utility.

### Layout
| Component | Usage |
|-----------|-------|
| `card` | Container with header/content/footer sections |
| `separator` | Horizontal or vertical divider |
| `scroll-area` | Scrollable region with custom scrollbar |
| `resizable` | Drag-to-resize panel layouts |
| `sidebar` | Collapsible sidebar scaffold |
| `aspect-ratio` | Enforce fixed aspect ratio on children |

### Typography & Display
| Component | Usage |
|-----------|-------|
| `badge` | Colored label/tag |
| `avatar` | User avatar with image + fallback initials |
| `skeleton` | Loading placeholder |
| `progress` | Linear progress bar |

### Navigation
| Component | Usage |
|-----------|-------|
| `navigation-menu` | Multi-level mega-menu |
| `breadcrumb` | Breadcrumb trail |
| `tabs` | Tabbed content panels |
| `pagination` | Page-navigation controls |
| `menubar` | Horizontal menu bar |

### Inputs & Forms
| Component | Usage |
|-----------|-------|
| `button` | Primary, outline, ghost, secondary variants |
| `input` | Text input |
| `textarea` | Multi-line text input |
| `select` | Dropdown select |
| `checkbox` | Checkbox with label |
| `radio-group` | Radio button group |
| `switch` | Toggle switch |
| `slider` | Range slider |
| `toggle` | Pressed/unpressed toggle button |
| `toggle-group` | Group of toggles (single/multi select) |
| `form` | React Hook Form wrapper components |
| `label` | Accessible form label |
| `input-otp` | One-time password input |
| `calendar` | Date picker calendar |
| `date-picker` | Date picker with popover |

### Overlays & Dialogs
| Component | Usage |
|-----------|-------|
| `dialog` | Modal dialog |
| `drawer` | Slide-in drawer panel |
| `sheet` | Side sheet overlay |
| `alert-dialog` | Confirmation dialog |
| `popover` | Floating popover |
| `tooltip` | Hover tooltip |
| `hover-card` | Rich hover preview card |
| `command` | Command palette / search |
| `context-menu` | Right-click context menu |
| `dropdown-menu` | Dropdown action menu |

### Feedback
| Component | Usage |
|-----------|-------|
| `alert` | Inline status alert (info, warning, error) |
| `toast` | Transient notification (via Sonner) |
| `sonner` | Toast provider component |

### Data Display
| Component | Usage |
|-----------|-------|
| `table` | Styled HTML table |
| `chart` | Recharts wrapper with theming |
| `carousel` | Embla-based image/content carousel |
| `collapsible` | Expand/collapse section |
| `accordion` | Accordion disclosure |

---

## Adding a New shadcn/ui Component

```bash
bunx --bun shadcn@latest add <component-name>
```

This adds the component source to `src/components/ui/` where it can be customized directly.

---

## Utility

```ts
// src/lib/utils.ts
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

Use `cn()` to conditionally merge Tailwind classes without conflicts:

```tsx
<div className={cn("base-class", isActive && "active-class", className)} />
```
