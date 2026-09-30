import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { FirstRunGate } from './auth/FirstRunGate';
import { WorkspaceGate } from './auth/WorkspaceGate';
import { useWorkspaceState } from './auth/useWorkspaceApps';
import { WelcomePage } from './pages/WelcomePage';
import { AppLauncherPage } from './pages/AppLauncherPage';
import { appsFor, hasApp, homeFor, LAUNCHER_PATH } from './lib/apps';
import { can, type Perm } from './lib/access';
import { AccessPage } from './pages/AccessPage';
import { useAuth } from './auth/useAuth';
import { LoginPage } from './pages/LoginPage';
import { SignupPage } from './pages/SignupPage';
import { DashboardLayout } from './pages/DashboardLayout';
import { DashboardPage } from './pages/DashboardPage';
import { EmployeesPage } from './pages/EmployeesPage';
import { EmployeeDetailPage } from './pages/EmployeeDetailPage';
import { AbsencesPage } from './pages/AbsencesPage';
import { SettingsPage } from './pages/SettingsPage';
import { ColoursPage } from './pages/ColoursPage';
import { DayNotesPage } from './pages/DayNotesPage';
import { InventoryStockPage } from './pages/inventory/InventoryStockPage';
import { InventoryCountPage } from './pages/inventory/InventoryCountPage';
import {
  InventoryCountDetailPage,
  InventoryCountsPage,
} from './pages/inventory/InventoryCountsPage';
import { InventoryReceivePage } from './pages/inventory/InventoryReceivePage';
import {
  InventoryReceiptDetailPage,
  InventoryReceiptsPage,
} from './pages/inventory/InventoryReceiptsPage';
import { InventorySuppliersPage } from './pages/inventory/InventorySuppliersPage';
import { StoreSalesPage } from './pages/store/StoreSalesPage';
import { StoreSaleDetailPage } from './pages/store/StoreSaleDetailPage';
import { StoreStatsPage } from './pages/store/StoreStatsPage';
import { StoreMenuPage } from './pages/store/StoreMenuPage';
import { StoreRecipesPage } from './pages/store/StoreRecipesPage';
import { EmployeeLayout } from './pages/employee/EmployeeLayout';
import { MySchedulePage } from './pages/employee/MySchedulePage';
import { EmployeeMenuPage } from './pages/employee/EmployeeMenuPage';
import { AdminProtectedRoute } from './backoffice/AdminProtectedRoute';
import { BackOfficeLayout } from './pages/backoffice/BackOfficeLayout';
import { BackOfficeLoginPage } from './pages/backoffice/BackOfficeLoginPage';
import { BackOfficeOverviewPage } from './pages/backoffice/BackOfficeOverviewPage';
import { BackOfficeCustomersPage } from './pages/backoffice/BackOfficeCustomersPage';
import { BackOfficeCustomerPage } from './pages/backoffice/BackOfficeCustomerPage';

// Four people use this product, and each gets what is theirs:
//
//   manager    everything -- the whole team, cost, payroll, publishing, the
//              inventory and the shop, and who else gets in (/access)
//   employee   their own shifts and hours, and the venue's menu (read only),
//              on a screen of their own (EmployeeLayout); and the inventory
//              and the shop's day-to-day -- count, receive, order, charge,
//              void -- in the same layout as the manager's, less what changes
//              the products, the suppliers, the menu or the recipes
//   shop       the till's tablet: the employee's inventory and shop, and no
//              shifts -- it is not a person (lib/access.ts)
//   operator   /backoffice -- the business itself: customers and metrics
//
// The first three share a session and are told apart by role, and what each
// may do by the permissions the server sends with it (lib/access.ts). The
// operator has a separate login and a separate token scope entirely: a
// manager's credentials open nothing under /backoffice. The server enforces
// every one of these boundaries independently of what is routed here.
//
// And a business has the apps it has: each is switched on for it, one by one
// -- shifts, inventory, the shop -- and a new business starts with the
// template's (backend/app/clients/). Only the routes of the apps it has are
// mounted -- a screen of an app it lacks would only meet the server's 403 --
// so what a manager can reach is exactly what they can use. A business with
// the shifts app gets that app's routes exactly as they always were.

/** A page behind a permission: without it, the app's home instead. */
function guarded(allow: (perm: Perm) => boolean, perm: Perm, home: string, page: ReactNode) {
  return allow(perm) ? page : <Navigate to={home} replace />;
}

/**
 * The inventory's pages, for whoever may see its stock (`inventory.view`):
 * the manager's and everybody else's are the same pages, which leave out
 * what the account may not do (products, suppliers, deleting a record).
 */
function inventoryRoutes(allow: (perm: Perm) => boolean) {
  const home = '/inventory';
  return (
    <>
      <Route path="/inventory" element={<InventoryStockPage />} />
      {/* Inside the layout like the rest of the app, so stepping into it and
          out is a page changing, not the whole screen being swapped (Max,
          27-sep-2026). On a phone, where it is done next to a truck, the
          sidebar steps aside for it (DashboardLayout). */}
      <Route
        path="/inventory/receive"
        element={guarded(allow, 'inventory.receive', home, <InventoryReceivePage />)}
      />
      <Route
        path="/inventory/count"
        element={guarded(allow, 'inventory.count', home, <InventoryCountPage />)}
      />
      <Route path="/inventory/counts" element={<InventoryCountsPage />} />
      <Route path="/inventory/counts/:id" element={<InventoryCountDetailPage />} />
      <Route path="/inventory/receipts" element={<InventoryReceiptsPage />} />
      <Route path="/inventory/receipts/:id" element={<InventoryReceiptDetailPage />} />
      <Route path="/inventory/suppliers" element={<InventorySuppliersPage />} />
    </>
  );
}

/**
 * The shop's pages, for whoever may see its menu (`menu.view`, its home):
 * the sales, what they add up to, the menu, and what each product of it
 * takes from the inventory. Each as the account may use it -- the menu is
 * only a till without `menu.edit`, the recipes only to read.
 */
function storeRoutes(allow: (perm: Perm) => boolean) {
  const home = '/store/menu';
  return (
    <>
      <Route path="/store" element={guarded(allow, 'store.sales.view', home, <StoreSalesPage />)} />
      <Route
        path="/store/sales/:id"
        element={guarded(allow, 'store.sales.view', home, <StoreSaleDetailPage />)}
      />
      <Route path="/store/stats" element={guarded(allow, 'store.stats', home, <StoreStatsPage />)} />
      <Route path="/store/menu" element={<StoreMenuPage />} />
      <Route
        path="/store/recipes"
        element={guarded(allow, 'store.recipes.view', home, <StoreRecipesPage />)}
      />
    </>
  );
}

export function App() {
  const { user, isAuthenticated } = useAuth();
  const { apps, permissions, permissionsPending } = useWorkspaceState();
  const role = user?.role;
  const isManager = isAuthenticated && role === 'manager';
  const isEmployee = isAuthenticated && role === 'employee';
  const allow = (perm: Perm) => can(permissions, perm);
  const shifts = hasApp(apps, 'shifts');
  // The inventory and the shop, each only for whoever may open it. The
  // manager's are the business's, as they always were.
  const inventory = hasApp(apps, 'inventory') && (isManager || allow('inventory.view'));
  const store = hasApp(apps, 'store') && (isManager || allow('menu.view'));
  // The apps this account has, and where `/` leads it: for a business with
  // the shifts app, the manager's dashboard and an employee's own shifts, as
  // before; for a shop account, the first of its apps, or the launcher.
  const mine = appsFor(role, apps, permissions).map((app) => app.key);
  // Anything not routed goes where `/` leads.
  const fallback = isAuthenticated && apps ? homeFor(mine) : '/';
  // The employee's own screen: their shifts, and the venue's menu (read
  // only), in a layout of their own. A shop account has neither.
  const ownScreen = isEmployee && (shifts || store);

  return (
    <Routes>
      {/* Public. Signing up creates an ORGANISATION and its manager; employees
          never sign up -- they exist because a manager added them, and get a
          login when that manager grants one. Neither does a shop account:
          the manager makes it, on /access. */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />

      {/* Customer app: manager, employee or shop, decided by the role on the
          token, and made of the apps the business has (WorkspaceGate holds it
          all until that is known). */}
      <Route element={<ProtectedRoute />}>
        <Route element={<WorkspaceGate />}>
          {apps === undefined || permissionsPending ? (
            // Not known yet -- the apps, or what this account may do -- so
            // the gate is showing its wait and nothing under it renders.
            // Every path is held here meanwhile: without this, a reload of
            // /employees would match nothing, fall to the fallback below and
            // be sent to `/` before the answer came. It wins over that
            // fallback by coming first: React Router ranks two `*` routes
            // that are not siblings equally, and keeps the order they are
            // written in.
            <Route path="*" element={null} />
          ) : !isManager ? (
            <>
              {/* Their apps side by side, as the manager's: where a sign-in
                  with more than one lands, and the logo leads. With none, it
                  says the workspace is being set up. No first run: that is
                  the manager's. */}
              <Route path={LAUNCHER_PATH} element={<AppLauncherPage />} />
              {ownScreen && (
                <Route element={<EmployeeLayout />}>
                  {shifts && <Route path="/" element={<MySchedulePage />} />}
                  {/* The venue's menu, read only: the manager writes it in
                      the shop (/store/menu). */}
                  {store && <Route path="/menu" element={<EmployeeMenuPage />} />}
                </Route>
              )}
              {(inventory || store) && (
                <Route element={<DashboardLayout />}>
                  {inventory && inventoryRoutes(allow)}
                  {store && storeRoutes(allow)}
                </Route>
              )}
              {/* `/` is an employee's own shifts. Without them -- a shop
                  account, or a business without the shifts app -- it opens
                  the first app there is, or the launcher. */}
              {!(isEmployee && shifts) && <Route path="/" element={<Navigate to={fallback} replace />} />}
            </>
          ) : (
            <Route element={<FirstRunGate />}>
              {/* Before the dashboard, and outside its layout: a new account is
                  asked about its business on a screen with nothing else on it. */}
              {shifts && <Route path="/welcome" element={<WelcomePage />} />}
              {/* Where a sign-in lands: the apps side by side, full screen and
                  outside the layout -- no sidebar, because no app is open yet.
                  Inside the gate, so a brand-new account still meets the
                  welcome first. Always there, even with no app on: it is where
                  a business with none is told so. */}
              <Route path={LAUNCHER_PATH} element={<AppLauncherPage />} />
              {/* Where the menu was before it moved from the inventory to the
                  shop: an old bookmark follows it there. Only where there is
                  a shop to follow it into; without one it is any unknown path. */}
              {store && <Route path="/inventory/menu" element={<Navigate to="/store/menu" replace />} />}
              <Route element={<DashboardLayout />}>
                {shifts && (
                  <>
                    <Route path="/" element={<DashboardPage />} />
                    <Route path="/employees" element={<EmployeesPage />} />
                    <Route path="/employees/:id" element={<EmployeeDetailPage />} />
                    <Route path="/absences" element={<AbsencesPage />} />
                    <Route path="/notes" element={<DayNotesPage />} />
                    <Route path="/colours" element={<ColoursPage />} />
                    <Route path="/settings" element={<SettingsPage />} />
                  </>
                )}
                {/* The second app in the workspace, switched to from the logo. */}
                {inventory && inventoryRoutes(allow)}
                {/* The third: the sales, what they add up to, the menu, and
                    what each product of it takes from the inventory. */}
                {store && storeRoutes(allow)}
                {/* Who can sign in, and as what: a page of no app, reached
                    from the sidebar of every one (lib/nav.ts). */}
                {allow('access.manage') && <Route path="/access" element={<AccessPage />} />}
              </Route>
              {/* `/` is the shifts app's dashboard. Without that app it opens
                  the first app there is, or the launcher if there is none. */}
              {!shifts && <Route path="/" element={<Navigate to={homeFor(apps)} replace />} />}
            </Route>
          )}
        </Route>
      </Route>

      {/* Back office -- the platform operator, not a customer. Its own login,
          its own session and its own token scope; a manager's credentials open
          nothing here. */}
      <Route path="/backoffice/login" element={<BackOfficeLoginPage />} />
      <Route element={<AdminProtectedRoute />}>
        <Route element={<BackOfficeLayout />}>
          <Route path="/backoffice" element={<BackOfficeOverviewPage />} />
          <Route
            path="/backoffice/customers"
            element={<BackOfficeCustomersPage />}
          />
          <Route
            path="/backoffice/customers/:orgId"
            element={<BackOfficeCustomerPage />}
          />
        </Route>
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to={fallback} replace />} />
    </Routes>
  );
}
