# Routing

Routing is handled by **React Router v6** and defined in `src/App.tsx`.

## Route Groups

### Public — General

| Path | Page |
|------|------|
| `/` | Home |
| `/home` | Home (alias) |
| `/features` | Features |
| `/about` | About |
| `/pricing` | Pricing |
| `/contact` | Contact |
| `/company` | Company |
| `/careers` | Careers |
| `/how-it-works` | How It Works |
| `/watch-demo` | Watch Demo |
| `/schedule-demo` | Schedule Demo |
| `/login` | Login |
| `/signup` | Sign Up |
| `/get-started` | Get Started |
| `/start-free-trial` | Start Free Trial |

---

### Public — Solutions

| Path | Page |
|------|------|
| `/solutions/sales` | Sales |
| `/solutions/marketing` | Marketing |
| `/solutions/operations` | Operations |
| `/solutions/hr` | HR |
| `/solutions/finance` | Finance |
| `/solutions/support` | Support |
| `/solutions/it` | IT |
| `/solutions/legal` | Legal |
| `/solutions/aria` | Aria (AI Agent) |
| `/solutions/atlas` | Atlas (AI Agent) |
| `/solutions/felix` | Felix (AI Agent) |
| `/solutions/maya` | Maya (AI Agent) |
| `/solutions/nova` | Nova (AI Agent) |
| `/solutions/emma` | Emma (AI Agent) |
| `/solutions/sage` | Sage (AI Agent) |

---

### Public — Product

| Path | Page |
|------|------|
| `/product/ai-assistants` | AI Assistants |
| `/product/agents` | Agents |
| `/product/cross-company-collaboration` | Cross-Company Collaboration |
| `/product/workflow-builder` | Workflow Builder |
| `/product/fine-tuning` | Fine Tuning |

---

### Public — Platform

| Path | Page |
|------|------|
| `/platform/analytics` | Analytics |
| `/platform/integrations` | Integrations |
| `/platform/api` | API |
| `/platform/security` | Security |
| `/platform/agentic-communication` | Agentic Communication |
| `/platform/automation` | Automation |
| `/platform/tasks` | Tasks |
| `/platform/documents` | Documents |
| `/platform/flows` | Flows |

---

### Public — Use Cases

| Path | Page |
|------|------|
| `/use-cases/document-processing` | Document Processing |
| `/use-cases/data-entry` | Data Entry |
| `/use-cases/onboarding` | Onboarding |
| `/use-cases/compliance` | Compliance |
| `/use-cases/reporting` | Reporting |
| `/use-cases/email-management` | Email Management |

---

### Public — Roles

| Path | Page |
|------|------|
| `/roles/ceo` | CEO |
| `/roles/operations-manager` | Operations Manager |
| `/roles/it-director` | IT Director |
| `/roles/finance-teams` | Finance Teams |
| `/roles/hr-professionals` | HR Professionals |
| `/roles/sales-leaders` | Sales Leaders |

---

### Public — Customers & Resources

| Path | Page |
|------|------|
| `/customers/case-studies` | Case Studies |
| `/customers/success-stories` | Success Stories |
| `/customers/testimonials` | Testimonials |
| `/customers/roi-calculator` | ROI Calculator |
| `/resources/blog` | Blog |
| `/resources/implementation-guide` | Implementation Guide |
| `/resources/best-practices` | Best Practices |
| `/resources/training` | Training |
| `/resources/community` | Community |

---

### Public — Support & Developers

| Path | Page |
|------|------|
| `/support/help-center` | Help Center |
| `/support/documentation` | Documentation |
| `/support/contact` | Contact |
| `/support/system-status` | System Status |
| `/dev/playground` | Dev Playground |
| `/dev/api` | Dev API |
| `/dev/docs` | Dev Docs |

---

### Protected — Dashboard (require login)

All routes below are wrapped in `<ProtectedRoute>` and redirect to the login (`/login?returnTo=…`, or `/telephony/login?returnTo=…` for `/telephony*`) when nobody is signed in.

| Path | Page |
|------|------|
| `/dashboard` | Main Dashboard |
| `/chat` | Chat |
| `/tasks` | Tasks |
| `/staff` | Staff |
| `/ai-employees` | AI Employees |
| `/ai-assistants/:id` | AI Assistant Detail |
| `/teams` | Teams |
| `/teams/:id` | Team Detail |
| `/ai-agents` | AI Agents |
| `/workflows` | Workflows |
| `/integrations` | Integrations (dashboard) |
| `/channels` | Channels |
| `/settings` | Settings |
| `/billing` | Billing |
| `/help` | Help |
| `/demos` | Demos |
| `/ai-fine-tuning` | AI Fine Tuning |
| `/dev/playground` | Dev Playground |
| `/dev/api` | Dev API |
| `/dev/docs` | Dev Docs |

---

## Authentication Guard

`src/components/ProtectedRoute.tsx` wraps protected routes. It reads `connected` from the session store (`src/stores/session.ts`) — a signed-in Pincer session — and otherwise redirects to the login with `returnTo` set to the current path. `/signup` is routed only in builds with `SIGNUP_ALLOWED=true`. See `docs/app/login.md`.

```tsx
// Usage in App.tsx
<Route
  path="/dashboard"
  element={
    <ProtectedRoute>
      <Dashboard />
    </ProtectedRoute>
  }
/>
```

## 404 Handling

A catch-all `*` route at the bottom of the router renders a "Not Found" page.
