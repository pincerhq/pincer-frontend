# Architecture

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 18.3 |
| Language | TypeScript 5.5 |
| Bundler | Vite + SWC |
| Routing | React Router DOM v6 |
| UI Components | shadcn/ui (Radix UI primitives) |
| Styling | Tailwind CSS 3.4 |
| Forms | React Hook Form + Zod |
| Data Fetching | TanStack React Query v5 |
| Charts | Recharts |
| Flow Diagrams | @xyflow/react |
| Icons | Lucide React |
| Notifications | Sonner |
| Theme | next-themes via custom ThemeContext |

## Directory Structure

```
src/
├── App.tsx                  # Root component — mounts router and query client
├── main.tsx                 # ReactDOM.createRoot entry point
├── index.css                # Global styles, Tailwind base, CSS variables
├── App.css                  # App-level style overrides
│
├── components/
│   ├── ui/                  # shadcn/ui primitives (40+ components)
│   ├── dashboard/           # Dashboard-only components
│   ├── Header.tsx           # Global marketing nav
│   ├── Footer.tsx           # Global footer
│   ├── ProtectedRoute.tsx   # Auth guard wrapper
│   └── ...                  # Other shared dialogs/widgets
│
├── pages/
│   ├── Home.tsx             # Landing page
│   ├── Dashboard.tsx        # Main authenticated dashboard
│   ├── Login.tsx            # Login page
│   ├── solutions/           # 15 solution pages
│   ├── product/             # 5 product feature pages
│   ├── platform/            # 10 platform pages
│   ├── use-cases/           # 6 use-case pages
│   ├── roles/               # 6 role-targeted pages
│   ├── customers/           # 4 customer story pages
│   ├── resources/           # 5 resource pages
│   ├── support/             # 4 support pages
│   └── dev/                 # 3 developer pages
│
├── contexts/
│   └── ThemeContext.tsx      # Light / dark / system theme
│
├── hooks/
│   ├── use-toast.ts          # Toast notification hook
│   └── use-mobile.tsx        # Mobile breakpoint detection
│
└── lib/
    └── utils.ts              # cn() utility (clsx + tailwind-merge)
```

## Application Zones

The app is split into two distinct zones:

### 1. Marketing Site (public)

- Accessible without authentication
- Uses `Header.tsx` + `Footer.tsx` layout
- Covers ~50 pages across solutions, product, platform, resources, support, use-cases, and roles
- Purpose: acquisition, education, conversion

### 2. Dashboard (protected)

- Requires a signed-in Pincer session (`useSession().connected`, see `docs/app/login.md`)
- Uses `AppSidebar.tsx` layout
- Covers core product features: AI Agents, Staff, Teams, Workflows, Integrations, Chat, Tasks, etc.
- Purpose: product functionality

## Data Flow

```
URL change
  → React Router matches route
    → Page component renders
      → Local useState / useQuery for data
        → UI renders with shadcn/ui + Tailwind
```

There is no global Redux/Zustand store. State lives locally in components or in `localStorage` for persistence (auth, theme). TanStack React Query is available for server-state caching but the app currently uses mostly mock/static data.

## Key Conventions

- All imports use the `@/` path alias
- Utility class merging via `cn()` from `@/lib/utils`
- Component variants follow shadcn/ui `cva()` pattern
- Pages are flat functional components — no class components
- Route grouping mirrors the folder structure under `src/pages/`
