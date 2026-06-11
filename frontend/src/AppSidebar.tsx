import { useEffect, useState } from "react";
import {
  loadNavExpandedState,
  NAV_MENU_GROUPS,
  pageLabel,
  panelNavGroup,
  saveNavExpandedState,
  type NavExpandedState,
  type NavGroupId,
  type PanelId,
} from "./dashboardLayout";

interface AppSidebarProps {
  activePage: PanelId;
  onNavigate: (page: PanelId) => void;
}

export function AppSidebar({ activePage, onNavigate }: AppSidebarProps) {
  const [expanded, setExpanded] = useState<NavExpandedState>(() => loadNavExpandedState());

  useEffect(() => {
    const group = panelNavGroup(activePage);
    if (!group) return;
    setExpanded((prev) => {
      if (prev[group]) return prev;
      const next = { ...prev, [group]: true };
      saveNavExpandedState(next);
      return next;
    });
  }, [activePage]);

  const toggleGroup = (groupId: NavGroupId) => {
    setExpanded((prev) => {
      const next = { ...prev, [groupId]: !prev[groupId] };
      saveNavExpandedState(next);
      return next;
    });
  };

  return (
    <aside className="app-sidebar">
      <nav className="app-sidebar-nav" aria-label="主导航">
        {NAV_MENU_GROUPS.map((group) => {
          const isOpen = expanded[group.id];
          const groupActive = group.items.includes(activePage);

          return (
            <div
              key={group.id}
              className={`app-nav-group${isOpen ? " is-open" : ""}${groupActive ? " has-active" : ""}`}
            >
              <button
                type="button"
                className="app-nav-group-toggle"
                aria-expanded={isOpen}
                onClick={() => toggleGroup(group.id)}
              >
                <span className="app-nav-group-label">{group.label}</span>
                <span className={`app-nav-chevron${isOpen ? " expanded" : ""}`} aria-hidden>
                  ›
                </span>
              </button>
              {isOpen && (
                <div className="app-nav-subitems">
                  {group.items.map((page) => (
                    <button
                      key={page}
                      type="button"
                      className={`app-nav-item app-nav-subitem${activePage === page ? " active" : ""}`}
                      aria-current={activePage === page ? "page" : undefined}
                      onClick={() => onNavigate(page)}
                    >
                      {pageLabel(page)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
