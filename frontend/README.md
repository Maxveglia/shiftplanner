# ShiftPlanner Frontend

React 18 + TypeScript + Vite + React Router v6 + TanStack Query v5 + Tailwind CSS + axios.

Frontend for **ShiftPlanner** — a multi-tenant, AI-assisted employee scheduling SaaS.
This is the **Phase 0** scaffold: multi-tenant auth, base CRUD (employees, versioned
contracts, shift templates, absences, vacation ledger) and read-only reference data
(labor profiles / compliance rules). No solver and no interactive calendar grid yet —
those arrive in Phase 1/2.

## Prerequisites

- Node.js 18+
- The backend running at `http://localhost:8000` (see `../backend`).

## Setup

```bash
cp .env.example .env   # adjust VITE_API_BASE_URL if needed
npm install
npm run dev            # http://localhost:5173
```

## Build

```bash
npm install
npm run build          # runs `tsc` typecheck + `vite build`
npm run preview        # serve the production build
```

## Environment

| Variable             | Default                 | Description                     |
| -------------------- | ----------------------- | ------------------------------- |
| `VITE_API_BASE_URL`  | `http://localhost:8000` | Backend base URL (no `/api/v1`) |

The axios client appends `/api/v1` automatically.

## Structure

```
src/
  lib/api.ts          axios instance (auth header + 401 handling)
  types.ts            TypeScript mirror of the backend API contract
  auth/               AuthContext, useAuth, ProtectedRoute
  api/                TanStack Query hooks per resource
  components/         small Tailwind UI primitives (Button, Input, ...)
  pages/              route pages + DashboardLayout
  App.tsx             route table
  main.tsx            providers (QueryClient + Router + Auth)
```
