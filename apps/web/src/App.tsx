import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import { BrowserBanner } from "./components/BrowserBanner.tsx";
import { useApp } from "./context.tsx";
import { GroupsPage } from "./pages/GroupsPage.tsx";
import { SavedPage } from "./pages/SavedPage.tsx";
import { SearchPage } from "./pages/SearchPage.tsx";

export function App() {
  const { serverDown, refreshMeta } = useApp();
  const location = useLocation();
  const onSearch = location.pathname === "/" || location.pathname.startsWith("/search");
  return (
    <div className="app">
      <header className="topbar">
        <NavLink to="/" className="brand" aria-label="FlightBuzz home">
          <span className="logo" aria-hidden>
            ✈
          </span>
          Flight<span>Buzz</span>
        </NavLink>
        <nav>
          <NavLink to="/" end className={onSearch ? "active" : ""}>
            Search
          </NavLink>
          <NavLink to="/saved">Saved</NavLink>
          <NavLink to="/groups">Groups</NavLink>
        </nav>
      </header>
      {serverDown && (
        <div className="banner error server-down">
          Server not reachable — start it with <code>npm run dev</code>.{" "}
          <button type="button" className="link-btn" onClick={() => void refreshMeta()}>
            Retry
          </button>
        </div>
      )}
      <BrowserBanner />
      <main>
        <Routes>
          <Route path="/saved" element={<SavedPage />} />
          <Route path="/groups" element={<GroupsPage />} />
          {/* One route for "/" and "/search/..." so the form keeps its state as the URL changes. */}
          <Route path="*" element={<SearchPage />} />
        </Routes>
      </main>
    </div>
  );
}
