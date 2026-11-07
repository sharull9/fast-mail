import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Keyboard, Users, Palette, Mail, Database } from "lucide-react";
import { HotkeysProvider } from "@tanstack/react-hotkeys";
import { AppearanceSettings } from "@/components/settings/appearance";
import { ShortcutSettings } from "@/components/settings/shortcuts";
import { AccountSettings } from "@/components/settings/accounts";
import { ContactsSettings } from "@/components/settings/contacts";
import { MailDataSettings } from "@/components/settings/mail-data";
import { usePreferences } from "@/components/preferences-provider";

const sections = [
  { id: "appearance", name: "Appearance", icon: Palette, component: AppearanceSettings },
  { id: "shortcuts", name: "Keyboard shortcuts", icon: Keyboard, component: ShortcutSettings },
  { id: "accounts", name: "Accounts", icon: Mail, component: AccountSettings },
  { id: "contacts", name: "Contacts", icon: Users, component: ContactsSettings },
  { id: "mail-data", name: "Mail data", icon: Database, component: MailDataSettings },
];
export const Route = createFileRoute("/settings")({
  validateSearch: (search: Record<string, unknown>) => ({
    section:
      typeof search.section === "string" && sections.some((item) => item.id === search.section)
        ? search.section
        : "appearance",
  }),
  component: Settings,
});
function Settings() {
  const { section } = Route.useSearch();
  const active = sections.find((item) => item.id === section) ?? sections[0];
  const Content = active.component;
  const { error, recovered } = usePreferences();
  return (
    <HotkeysProvider scope="settings" exclusive={{ allow: [] }}>
      <div className="settings-page">
        <header className="settings-header">
          <Link to="/mail/$labelId" params={{ labelId: "INBOX" }} className="settings-back">
            <ArrowLeft className="size-4" />
            Back to mail
          </Link>
          <h1>Settings</h1>
          <p>Make Mailfast work the way you do.</p>
        </header>
        <div className="settings-layout">
          <nav className="settings-nav" aria-label="Settings sections">
            {sections.map(({ id, name, icon: Icon }) => (
              <Link
                key={id}
                to="/settings"
                search={{ section: id }}
                className={section === id ? "settings-nav-active" : ""}
                aria-current={section === id ? "page" : undefined}
              >
                <Icon className="size-4" />
                {name}
              </Link>
            ))}
          </nav>
          <section className="settings-content" aria-labelledby="settings-section-heading">
            <h2 id="settings-section-heading">{active.name}</h2>
            {error && (
              <p role="alert" className="mb-5 text-sm text-destructive">
                {error}
              </p>
            )}
            {recovered && (
              <p role="status" className="mb-5 text-sm text-muted-foreground">
                Some saved preferences were invalid. Valid entries were kept and the rest use defaults.
              </p>
            )}
            <Content />
          </section>
        </div>
      </div>
    </HotkeysProvider>
  );
}
